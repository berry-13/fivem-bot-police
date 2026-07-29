'use strict';

const { ChannelType, PermissionFlagsBits, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const ticketConfig = require('../config/tickets');

// Discord pagina la cronologia a 100 messaggi per volta. Senza un tetto un
// canale molto lungo significa centinaia di chiamate in fila con chi chiude il
// ticket che aspetta e l'intera trascrizione in memoria.
const PAGE_SIZE = 100;
const MAX_TRANSCRIPT_MESSAGES = 5000;

// Discord taglia i nomi dei canali a 100 caratteri: restiamo sotto e teniamo
// intera la parte con la categoria, semmai accorciando il nome utente.
const CHANNEL_NAME_MAX = 90;
const CHANNEL_PREFIX = 'ticket';

const CLOSE_DELAY_MS = 5000;

function slugify(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Il nome porta la categoria perche' si capisca di cosa parla un ticket senza
 * doverlo aprire: "ticket-richiesta-esame-mario-rossi".
 */
function buildTicketChannelName(category, username) {
  const testa = [CHANNEL_PREFIX, slugify(category?.value)].filter(Boolean).join('-');
  const utente = slugify(username) || 'utente';

  const spazioRimasto = CHANNEL_NAME_MAX - testa.length - 1;
  if (spazioRimasto <= 0) return testa.slice(0, CHANNEL_NAME_MAX);

  return `${testa}-${utente.slice(0, spazioRimasto)}`.replace(/-+$/, '');
}

/**
 * I comandi di chiusura si fidano di questo controllo, quindi il canale di log
 * va escluso a mano: si chiama "ticket-logs" e senza questa riga un !close
 * dato li' dentro cancellerebbe l'archivio di tutti i ticket.
 */
function isTicketChannel(channel) {
  const name = channel?.name;
  if (typeof name !== 'string') return false;
  if (name === ticketConfig.logChannelName) return false;
  return name.startsWith(`${CHANNEL_PREFIX}-`);
}

/** Staff = chi gestisce i canali, oppure chi ha uno dei ruoli in config/tickets.js. */
function isTicketStaff(member) {
  if (!member) return false;
  if (member.permissions?.has?.(PermissionFlagsBits.ManageChannels)) return true;

  const ruoliStaff = new Set(ticketConfig.categories.flatMap(c => c.roles));
  const ruoliMembro = member.roles?.cache;
  if (!ruoliMembro) return false;

  return ruoliMembro.some(role => ruoliStaff.has(role.name));
}

async function fetchAllMessages(channel) {
  const allMessages = [];
  let lastId;

  while (allMessages.length < MAX_TRANSCRIPT_MESSAGES) {
    const options = { limit: PAGE_SIZE };
    if (lastId) options.before = lastId;

    const messages = await channel.messages.fetch(options);
    if (messages.size === 0) break;

    allMessages.push(...messages.values());

    const oldest = messages.last();
    // Se l'id piu' vecchio non avanza la pagina dopo sarebbe identica a questa:
    // meglio uscire che girare nel while all'infinito.
    if (!oldest || oldest.id === lastId) break;
    lastId = oldest.id;

    if (messages.size < PAGE_SIZE) break;
  }

  return allMessages;
}

function buildTranscript(messages) {
  return messages
    .slice()
    .reverse()
    .map(m => {
      const time = new Date(m.createdTimestamp).toLocaleString('it-IT');
      return `[${time}] ${m.author.tag}: ${m.content}`;
    })
    .join('\n');
}

async function resolveLogChannel(guild) {
  const esistente = guild.channels.cache.find(
    c => c.name === ticketConfig.logChannelName && c.type === ChannelType.GuildText
  );
  if (esistente) return esistente;

  try {
    return await guild.channels.create({
      name: ticketConfig.logChannelName,
      type: ChannelType.GuildText,
      permissionOverwrites: [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }],
    });
  } catch (error) {
    console.error('Impossibile creare il canale ticket-logs:', error);
    return null;
  }
}

/**
 * Archivia il ticket nel canale di log. Torna true solo se il file e' arrivato
 * davvero a destinazione: chi chiama lo dice all'utente invece di promettergli
 * un archivio che non esiste. Un invio fallito non deve impedire la chiusura.
 */
async function archiveTicket(channel, { guild, closedBy }) {
  const messages = await fetchAllMessages(channel);
  const transcript = buildTranscript(messages);

  const buffer = Buffer.from(transcript || 'Nessun messaggio.', 'utf-8');
  const attachment = new AttachmentBuilder(buffer, { name: `${channel.name}.txt` });

  const logChannel = await resolveLogChannel(guild);
  if (!logChannel) return false;

  const logEmbed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle('📁 Ticket chiuso')
    .addFields(
      { name: 'Canale', value: `#${channel.name}`, inline: true },
      { name: 'Chiuso da', value: `${closedBy.tag}`, inline: true }
    )
    .setTimestamp();

  try {
    await logChannel.send({ embeds: [logEmbed], files: [attachment] });
    return true;
  } catch (error) {
    console.error('Impossibile inviare la trascrizione nel canale di log:', error);
    return false;
  }
}

function closingMessage(trascrizioneSalvata) {
  const secondi = CLOSE_DELAY_MS / 1000;
  return trascrizioneSalvata
    ? `🔒 Ticket in chiusura tra ${secondi} secondi... la trascrizione è stata salvata.`
    : `🔒 Ticket in chiusura tra ${secondi} secondi... non sono riuscito a salvare la trascrizione.`;
}

function scheduleTicketDeletion(channel) {
  setTimeout(() => {
    channel.delete().catch(console.error);
  }, CLOSE_DELAY_MS);
}

module.exports = {
  CLOSE_DELAY_MS,
  MAX_TRANSCRIPT_MESSAGES,
  archiveTicket,
  buildTicketChannelName,
  buildTranscript,
  closingMessage,
  fetchAllMessages,
  isTicketChannel,
  isTicketStaff,
  scheduleTicketDeletion,
};
