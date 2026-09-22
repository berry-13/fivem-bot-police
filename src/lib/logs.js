'use strict';

const {
  AuditLogEvent,
  AuditLogOptionsType,
  ChannelType,
  PermissionFlagsBits,
  PermissionsBitField,
  Role,
  TimestampStyles,
  time,
} = require('discord.js');
const logConfig = require('../config/logs');
const store = require('./logs-store');
const { citazione, creaScheda, tronca } = require('./log-card');

const TIPI = logConfig.tipi.map(t => t.value);

const COLORI = {
  eliminato: 0xed4245,
  modificato: 0xfee75c,
  entrato: 0x57f287,
  uscito: 0xe67e22,
  info: 0x5865f2,
  sanzione: 0x992d22,
  revoca: 0x3ba55d,
  avviso: 0xf1c40f,
};

// Un singolo campo (ruoli, allegati, prima/dopo) non si mangia tutta la scheda.
const LIMITE_CAMPO = 1000;
// Le righe dei cambi di audit log: stanno nel budget di testo della scheda.
const LIMITE_CAMBI = 3000;

// Permessi minimi del bot su un canale di log per poterci scrivere embed e file.
const PERMESSI_CANALE_LOG = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
];

// Un canale di log cancellato a mano genererebbe un warning a ogni evento:
// ne scriviamo uno ogni dieci minuti per canale.
const INTERVALLO_WARNING_MS = 10 * 60 * 1000;
const ultimiWarning = new Map();

function warnThrottled(chiave, messaggio) {
  const adesso = Date.now();
  const ultimo = ultimiWarning.get(chiave);
  if (ultimo && adesso - ultimo < INTERVALLO_WARNING_MS) return;
  ultimiWarning.set(chiave, adesso);
  console.warn(messaggio);
}

function tagUtente(user) {
  if (!user) return 'sconosciuto';
  return user.tag ?? user.username ?? user.id;
}

function avatarDi(user) {
  if (typeof user?.displayAvatarURL !== 'function') return undefined;
  return user.displayAvatarURL({ size: 128 });
}

function dataConRelativo(data) {
  return `${time(data, TimestampStyles.ShortDateTime)} (${time(data, TimestampStyles.RelativeTime)})`;
}

/* ------------------------------------------------------------------------ */
/* Canali di log                                                             */
/* ------------------------------------------------------------------------ */

function isTipoValido(tipo) {
  return TIPI.includes(tipo);
}

function isEnabled(guildId, tipo) {
  return Boolean(store.getChannelId(guildId, tipo));
}

/**
 * I canali di log non vanno mai loggati: un messaggio eliminato in log-messaggi
 * produrrebbe un log in log-messaggi, e cosi' via.
 */
function isIgnoredChannel(guildId, channelId) {
  if (!channelId) return false;
  if (logConfig.canaliIgnorati.includes(channelId)) return true;
  return Object.values(store.getChannels(guildId)).includes(channelId);
}

async function resolveLogChannel(guild, tipo) {
  const channelId = store.getChannelId(guild.id, tipo);
  if (!channelId) return null;

  let channel = guild.channels.cache.get(channelId);
  if (!channel) {
    try {
      channel = await guild.channels.fetch(channelId);
    } catch {
      channel = null;
    }
  }

  if (!channel?.isTextBased?.()) {
    warnThrottled(
      `${guild.id}:${tipo}:missing`,
      `Canale di log "${tipo}" (${channelId}) non trovato in ${guild.name}. ` +
        'Rilancia /setup-log crea oppure /setup-log imposta.',
    );
    return null;
  }
  return channel;
}

/**
 * Manda un log nel canale del tipo indicato. Non lancia mai: un log perso e'
 * un warning, non un evento del gateway che fa cadere il bot.
 */
async function sendLog(guild, tipo, payload) {
  if (!guild || !isEnabled(guild.id, tipo)) return false;

  const channel = await resolveLogChannel(guild, tipo);
  if (!channel) return false;

  try {
    // Nessun ping dai log: mention di utenti e ruoli restano solo visuali.
    await channel.send({ allowedMentions: { parse: [] }, ...payload });
    return true;
  } catch (error) {
    warnThrottled(
      `${guild.id}:${tipo}:send`,
      `Log "${tipo}" non inviato in #${channel.name} (${guild.name}): ${error.message}`,
    );
    return false;
  }
}

/** Esegue un logger senza mai propagare errori al gestore dell'evento. */
async function safely(etichetta, fn) {
  try {
    await fn();
  } catch (error) {
    console.error(`Errore nel log "${etichetta}":`, error);
  }
}

function missingPermissions(channel, member) {
  const permessi = channel.permissionsFor?.(member);
  if (!permessi) return PERMESSI_CANALE_LOG.map(nomePermesso);
  return permessi.missing(PERMESSI_CANALE_LOG);
}

function nomePermesso(bit) {
  return new PermissionsBitField(bit).toArray()[0] ?? String(bit);
}

/* ------------------------------------------------------------------------ */
/* Setup                                                                     */
/* ------------------------------------------------------------------------ */

/**
 * Crea (o riusa) una categoria privata con un canale per tipo di log e salva
 * gli id. Rilanciarlo e' sicuro: i canali gia' configurati ed esistenti non
 * vengono toccati, quelli cancellati a mano vengono ricreati.
 */
async function createLogChannels(guild, { staffRole } = {}) {
  const me = guild.members.me;
  const mancanti = me?.permissions?.missing([
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.ManageRoles,
  ]) ?? ['ManageChannels', 'ManageRoles'];
  if (mancanti.length > 0) {
    const error = new Error(`Permessi mancanti al bot: ${mancanti.join(', ')}`);
    error.code = 'LOG_MISSING_PERMISSIONS';
    throw error;
  }

  // Solo il bot scrive. Lo staff (se indicato) legge; gli amministratori vedono
  // comunque tutto per via del permesso Amministratore.
  const permissionOverwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: me.id,
      allow: [...PERMESSI_CANALE_LOG, PermissionFlagsBits.ReadMessageHistory],
    },
  ];
  if (staffRole) {
    permissionOverwrites.push({
      id: staffRole.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
      deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions],
    });
  }

  let categoria = guild.channels.cache.find(
    c => c.type === ChannelType.GuildCategory && c.name === logConfig.categoria,
  );
  if (!categoria) {
    categoria = await guild.channels.create({
      name: logConfig.categoria,
      type: ChannelType.GuildCategory,
      permissionOverwrites,
      reason: 'Setup canali di log',
    });
  }

  const creati = [];
  const riusati = [];

  for (const tipo of logConfig.tipi) {
    const configurato = store.getChannelId(guild.id, tipo.value);
    let channel = configurato ? guild.channels.cache.get(configurato) : null;

    if (!channel) {
      channel = guild.channels.cache.find(
        c => c.parentId === categoria.id && c.name === tipo.canale && c.type === ChannelType.GuildText,
      );
    }

    if (channel) {
      riusati.push({ tipo, channel });
    } else {
      channel = await guild.channels.create({
        name: tipo.canale,
        type: ChannelType.GuildText,
        parent: categoria.id,
        topic: `Log automatici: ${tipo.descrizione.toLowerCase()}.`,
        permissionOverwrites,
        reason: 'Setup canali di log',
      });
      creati.push({ tipo, channel });
    }

    store.setChannel(guild.id, tipo.value, channel.id);
  }

  return { categoria, creati, riusati };
}

/* ------------------------------------------------------------------------ */
/* Messaggi                                                                  */
/* ------------------------------------------------------------------------ */

function descriviAllegati(message) {
  const allegati = message.attachments ? [...message.attachments.values()] : [];
  if (allegati.length === 0) return null;
  return allegati
    .map(a => {
      const kb = a.size ? ` (${Math.ceil(a.size / 1024)} KB)` : '';
      return `[${a.name}](${a.url})${kb}`;
    })
    .join('\n');
}

function deveIgnorareMessaggio(message) {
  if (!message.guild) return true;
  if (message.system) return true;
  if (logConfig.ignoraBot && message.author?.bot) return true;
  if (message.webhookId) return true;
  return isIgnoredChannel(message.guild.id, message.channelId);
}

// Discord raggruppa nella stessa voce di audit log le eliminazioni dello stesso
// moderatore sullo stesso autore nello stesso canale, incrementando "count".
// Per capire se la voce riguarda *questa* eliminazione ricordiamo il count di
// ogni voce gia' vista: se e' nuova e recente, o se il count e' salito, e' lei.
const conteggiEliminazioni = new Map();
const MAX_VOCI_RICORDATE = 500;
const FINESTRA_VOCE_NUOVA_MS = 10_000;

const attendi = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Chi ha eliminato il messaggio, se non e' stato l'autore. Best effort: senza
 * il permesso Visualizzare il registro o con eliminazioni simultanee torna null.
 */
async function findMessageDeleter(message, { attesaMs = 1000 } = {}) {
  const guild = message.guild;
  const authorId = message.author?.id;
  if (!guild || !authorId) return null;
  if (!guild.members.me?.permissions?.has(PermissionFlagsBits.ViewAuditLog)) return null;

  // La voce di audit log arriva poco dopo l'evento del gateway.
  if (attesaMs > 0) await attendi(attesaMs);

  let logs;
  try {
    logs = await guild.fetchAuditLogs({ type: AuditLogEvent.MessageDelete, limit: 10 });
  } catch {
    return null;
  }

  let trovato = null;
  for (const entry of logs.entries.values()) {
    const count = entry.extra?.count ?? 1;
    const precedente = conteggiEliminazioni.get(entry.id);
    conteggiEliminazioni.set(entry.id, count);

    if (trovato) continue;
    if (entry.targetId !== authorId) continue;
    if (entry.extra?.channel?.id !== message.channelId) continue;

    const nuova = precedente === undefined && Date.now() - entry.createdTimestamp < FINESTRA_VOCE_NUOVA_MS;
    const cresciuta = precedente !== undefined && count > precedente;
    if (nuova || cresciuta) trovato = entry.executor ?? { id: entry.executorId };
  }

  while (conteggiEliminazioni.size > MAX_VOCI_RICORDATE) {
    conteggiEliminazioni.delete(conteggiEliminazioni.keys().next().value);
  }

  return trovato;
}

function linkCanale(guildId, channelId) {
  return `https://discord.com/channels/${guildId}/${channelId}`;
}

function buildMessageDeleteCard(message, deleter) {
  const author = message.author;
  const daModeratore = deleter && deleter.id !== author?.id;

  let corpo;
  let cita = false;
  if (message.partial) {
    corpo = '*Contenuto non disponibile: il messaggio non era in cache.*';
  } else if (message.content) {
    corpo = message.content;
    cita = true;
  } else {
    corpo = '*Nessun testo.*';
  }

  return creaScheda({
    colore: COLORI.eliminato,
    titolo: daModeratore ? 'Messaggio eliminato da un moderatore' : 'Messaggio eliminato',
    sottotitolo: author ? `${tagUtente(author)} in <#${message.channelId}>` : `in <#${message.channelId}>`,
    immagine: avatarDi(author),
    corpo,
    cita,
    campi: [
      { nome: 'Autore', valore: author ? `<@${author.id}>` : 'Sconosciuto' },
      { nome: 'Canale', valore: `<#${message.channelId}>` },
      {
        nome: 'Inviato',
        valore: message.createdAt && !message.partial ? time(message.createdAt, TimestampStyles.RelativeTime) : null,
      },
      { nome: 'Eliminato da', valore: daModeratore ? `<@${deleter.id}>` : null },
      { nome: 'Allegati', valore: descriviAllegati(message) },
    ],
    piede: [author && `Utente ${author.id}`, `Messaggio ${message.id}`],
    pulsanti: [{ label: 'Apri il canale', url: linkCanale(message.guild.id, message.channelId) }],
  });
}

async function logMessageDelete(message, opzioni) {
  if (deveIgnorareMessaggio(message)) return;
  if (!isEnabled(message.guild.id, 'messaggi')) return;

  const deleter = await findMessageDeleter(message, opzioni);
  await sendLog(message.guild, 'messaggi', buildMessageDeleteCard(message, deleter));
}

function buildMessageUpdateCard(oldMessage, newMessage) {
  const prima = oldMessage.partial
    ? '*Non disponibile: il messaggio non era in cache.*'
    : citazione(tronca(oldMessage.content || 'Nessun testo.', LIMITE_CAMPO));
  const dopo = citazione(tronca(newMessage.content || 'Nessun testo.', LIMITE_CAMPO));

  return creaScheda({
    colore: COLORI.modificato,
    titolo: 'Messaggio modificato',
    sottotitolo: `${tagUtente(newMessage.author)} in <#${newMessage.channelId}>`,
    immagine: avatarDi(newMessage.author),
    campi: [
      { nome: 'Prima', valore: prima },
      { nome: 'Dopo', valore: dopo },
      { nome: 'Autore', valore: `<@${newMessage.author.id}>` },
      { nome: 'Canale', valore: `<#${newMessage.channelId}>` },
    ],
    piede: [`Utente ${newMessage.author.id}`, `Messaggio ${newMessage.id}`],
    quando: newMessage.editedAt ?? new Date(),
    pulsanti: [{ label: 'Vai al messaggio', url: newMessage.url }],
  });
}

async function logMessageUpdate(oldMessage, newMessage) {
  if (!newMessage.guild || !isEnabled(newMessage.guild.id, 'messaggi')) return;

  let aggiornato = newMessage;
  if (aggiornato.partial) {
    try {
      aggiornato = await aggiornato.fetch();
    } catch {
      return;
    }
  }

  if (deveIgnorareMessaggio(aggiornato)) return;
  // L'anteprima di un link aggiorna il messaggio senza che l'autore l'abbia
  // toccato: senza editedTimestamp non e' una modifica.
  if (!aggiornato.editedTimestamp) return;
  if (!oldMessage.partial && oldMessage.content === aggiornato.content) return;

  await sendLog(aggiornato.guild, 'messaggi', buildMessageUpdateCard(oldMessage, aggiornato));
}

function buildBulkTranscript(messages) {
  return messages
    .filter(m => !m.partial)
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .map(m => {
      const quando = new Date(m.createdTimestamp).toLocaleString('it-IT');
      const allegati = m.attachments?.size
        ? ` [allegati: ${[...m.attachments.values()].map(a => a.url).join(' ')}]`
        : '';
      return `[${quando}] ${tagUtente(m.author)} (${m.author?.id}): ${m.content ?? ''}${allegati}`;
    })
    .join('\n');
}

function buildBulkDeleteCard(messages, channel) {
  const lista = [...messages.values()];
  const inCache = lista.filter(m => !m.partial);
  const trascrizione = buildBulkTranscript(lista);

  // Chi aveva piu' messaggi tra quelli eliminati: di solito e' il motivo della pulizia.
  const perAutore = new Map();
  for (const m of inCache) {
    if (!m.author) continue;
    perAutore.set(m.author.id, (perAutore.get(m.author.id) ?? 0) + 1);
  }
  const autori = [...perAutore.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, n]) => `<@${id}> (${n})`)
    .join(', ');

  const nomeFile = `eliminati-${channel.name ?? channel.id}-${Date.now()}.txt`;
  return creaScheda({
    colore: COLORI.eliminato,
    titolo: 'Eliminazione di massa',
    sottotitolo: `in <#${channel.id}>`,
    corpo:
      `**${lista.length}** messaggi eliminati.\n` +
      (inCache.length > 0
        ? `${inCache.length} erano in cache: trascrizione qui sotto.`
        : 'Nessuno era in cache: contenuto non disponibile.'),
    campi: [{ nome: 'Autori principali', valore: autori || null }],
    piede: [`Canale ${channel.id}`],
    file: trascrizione ? { nome: nomeFile, contenuto: trascrizione } : undefined,
    pulsanti: channel.guild ? [{ label: 'Apri il canale', url: linkCanale(channel.guild.id, channel.id) }] : [],
  });
}

async function logMessageDeleteBulk(messages, channel) {
  const guild = channel?.guild;
  if (!guild || !isEnabled(guild.id, 'messaggi')) return;
  if (isIgnoredChannel(guild.id, channel.id)) return;

  await sendLog(guild, 'messaggi', buildBulkDeleteCard(messages, channel));
}

/* ------------------------------------------------------------------------ */
/* Membri                                                                    */
/* ------------------------------------------------------------------------ */

const GIORNO_MS = 24 * 60 * 60 * 1000;

function descriviInvito(risultato) {
  switch (risultato?.stato) {
    case 'invito': {
      const { invito } = risultato;
      const limite = invito.maxUses > 0 ? `/${invito.maxUses}` : '';
      const esaurito = risultato.esaurito ? ', ora esaurito' : '';
      return `\`discord.gg/${invito.code}\` (${invito.uses}${limite} utilizzi${esaurito})`;
    }
    case 'vanity':
      return `URL personalizzato \`discord.gg/${risultato.code}\` (${risultato.uses} utilizzi)`;
    case 'ambiguo':
      return `Uno tra ${risultato.candidati.map(i => `\`${i.code}\``).join(', ')} (ingressi simultanei)`;
    case 'permessi':
      return '*Non tracciabile: al bot serve il permesso Gestire il server.*';
    case 'sconosciuto':
    case 'errore':
      return '*Sconosciuto (Scopri server, invito temporaneo o primo ingresso dopo l\'avvio).*';
    default:
      return null;
  }
}

function buildMemberJoinCard(member, invito) {
  const user = member.user;
  const etaMs = Date.now() - user.createdTimestamp;
  const nuovo = etaMs < logConfig.giorniAccountNuovo * GIORNO_MS;
  const invitante = invito?.stato === 'invito' ? invito.invito.inviterId : null;

  return creaScheda({
    colore: nuovo ? COLORI.avviso : COLORI.entrato,
    titolo: user.bot ? 'Bot aggiunto' : 'Nuovo membro',
    sottotitolo: tagUtente(user),
    immagine: avatarDi(user),
    corpo: `<@${user.id}> e' il membro numero **${member.guild.memberCount}**.`,
    campi: [
      { nome: 'Account creato', valore: dataConRelativo(user.createdAt) },
      { nome: 'Invito', valore: user.bot ? null : descriviInvito(invito) },
      {
        nome: 'Invitato da',
        valore: invitante
          ? `<@${invitante}>${typeof invito.totaleInvitante === 'number' ? `, ${invito.totaleInvitante} ingressi con i suoi inviti` : ''}`
          : null,
      },
      {
        nome: 'Attenzione',
        valore: nuovo ? `Account creato meno di ${logConfig.giorniAccountNuovo} giorni fa.` : null,
      },
    ],
    piede: [`Utente ${user.id}`],
  });
}

async function logMemberJoin(member, invito) {
  await sendLog(member.guild, 'membri', buildMemberJoinCard(member, invito));
}

/** "2 anni e 3 mesi", "5 giorni", "meno di un minuto": le due unita' piu' grandi. */
function durata(ms) {
  const unita = [
    ['anno', 'anni', 365 * GIORNO_MS],
    ['mese', 'mesi', 30 * GIORNO_MS],
    ['giorno', 'giorni', GIORNO_MS],
    ['ora', 'ore', 60 * 60 * 1000],
    ['minuto', 'minuti', 60 * 1000],
  ];
  const parti = [];
  let resto = Math.max(0, ms);
  for (const [singolare, plurale, valore] of unita) {
    const n = Math.floor(resto / valore);
    if (n > 0) {
      parti.push(`${n} ${n === 1 ? singolare : plurale}`);
      resto -= n * valore;
    }
    if (parti.length === 2) break;
  }
  return parti.length > 0 ? parti.join(' e ') : 'meno di un minuto';
}

function buildMemberLeaveCard(member) {
  const user = member.user;

  const ruoli = member.roles?.cache
    ? [...member.roles.cache.values()]
        .filter(r => r.id !== member.guild.id)
        .sort((a, b) => b.position - a.position)
        .map(r => `<@&${r.id}>`)
    : [];

  let campoRuoli = null;
  if (ruoli.length > 0) {
    campoRuoli = { nome: `Ruoli (${ruoli.length})`, valore: tronca(ruoli.join(' '), LIMITE_CAMPO) };
  } else if (member.partial) {
    campoRuoli = { nome: 'Ruoli', valore: '*Non disponibili: il membro non era in cache.*' };
  }

  return creaScheda({
    colore: COLORI.uscito,
    titolo: user?.bot ? 'Bot rimosso' : 'Membro uscito',
    sottotitolo: tagUtente(user),
    immagine: avatarDi(user),
    corpo: `<@${member.id}> ha lasciato il server. Ora siete **${member.guild.memberCount}**.`,
    campi: [
      { nome: 'Era entrato', valore: member.joinedAt ? dataConRelativo(member.joinedAt) : null },
      { nome: 'Permanenza', valore: member.joinedAt ? durata(Date.now() - member.joinedAt.getTime()) : null },
      campoRuoli,
    ],
    piede: [`Utente ${member.id}`],
  });
}

async function logMemberLeave(member) {
  if (!member.guild) return;
  await sendLog(member.guild, 'membri', buildMemberLeaveCard(member));
}

/* ------------------------------------------------------------------------ */
/* Voce                                                                      */
/* ------------------------------------------------------------------------ */

function buildVoiceCard(oldState, newState) {
  const prima = oldState.channelId;
  const dopo = newState.channelId;
  if (prima === dopo) return null;

  const member = newState.member ?? oldState.member;
  const userId = member?.id ?? newState.id;

  let titolo;
  let colore;
  let corpo;
  if (!prima) {
    titolo = 'Entrato in vocale';
    colore = COLORI.entrato;
    corpo = `<@${userId}> e' entrato in <#${dopo}>`;
  } else if (!dopo) {
    titolo = 'Uscito dalla vocale';
    colore = COLORI.uscito;
    corpo = `<@${userId}> e' uscito da <#${prima}>`;
  } else {
    titolo = 'Cambio canale vocale';
    colore = COLORI.info;
    corpo = `<@${userId}> si e' spostato\n<#${prima}> → <#${dopo}>`;
  }

  return creaScheda({
    colore,
    titolo,
    sottotitolo: member?.user ? tagUtente(member.user) : undefined,
    immagine: avatarDi(member?.user),
    corpo,
    piede: [`Utente ${userId}`],
  });
}

async function logVoiceStateUpdate(oldState, newState) {
  const guild = newState.guild ?? oldState.guild;
  if (!guild || !isEnabled(guild.id, 'voce')) return;
  if (logConfig.canaliIgnorati.includes(oldState.channelId) || logConfig.canaliIgnorati.includes(newState.channelId)) {
    return;
  }

  const card = buildVoiceCard(oldState, newState);
  if (!card) return;
  await sendLog(guild, 'voce', card);
}

/* ------------------------------------------------------------------------ */
/* Audit log: moderazione, ruoli, nickname, modifiche al server              */
/* ------------------------------------------------------------------------ */

const A = AuditLogEvent;

// Una riga per azione: dove va, come si chiama, di che colore e'. Le azioni
// non elencate (onboarding, monetizzazione, ...) vengono ignorate.
const AZIONI_AUDIT = {
  [A.MemberKick]: { tipo: 'moderazione', titolo: 'Membro espulso', colore: COLORI.sanzione },
  [A.MemberBanAdd]: { tipo: 'moderazione', titolo: 'Membro bannato', colore: COLORI.sanzione },
  [A.MemberBanRemove]: { tipo: 'moderazione', titolo: 'Ban revocato', colore: COLORI.revoca },
  [A.MemberPrune]: { tipo: 'moderazione', titolo: 'Pulizia membri inattivi', colore: COLORI.sanzione },
  [A.MemberDisconnect]: { tipo: 'moderazione', titolo: 'Membro disconnesso dalla voce', colore: COLORI.uscito },
  [A.MemberMove]: { tipo: 'moderazione', titolo: 'Membro spostato in voce', colore: COLORI.info },
  [A.MessageBulkDelete]: { tipo: 'moderazione', titolo: 'Eliminazione di massa', colore: COLORI.eliminato },
  [A.AutoModerationBlockMessage]: { tipo: 'moderazione', titolo: 'AutoMod: messaggio bloccato', colore: COLORI.avviso },
  [A.AutoModerationFlagToChannel]: { tipo: 'moderazione', titolo: 'AutoMod: messaggio segnalato', colore: COLORI.avviso },
  [A.AutoModerationUserCommunicationDisabled]: {
    tipo: 'moderazione',
    titolo: 'AutoMod: timeout',
    colore: COLORI.sanzione,
  },

  [A.MemberRoleUpdate]: { tipo: 'membri', titolo: 'Ruoli aggiornati', colore: COLORI.info },
  // MemberUpdate viene diviso tra membri (nickname) e moderazione (timeout,
  // mute e deaf di server): vedi dividiMemberUpdate.
  [A.MemberUpdate]: { tipo: 'membri', titolo: 'Membro aggiornato', colore: COLORI.info },

  [A.MessagePin]: { tipo: 'messaggi', titolo: 'Messaggio fissato', colore: COLORI.info },
  [A.MessageUnpin]: { tipo: 'messaggi', titolo: 'Messaggio tolto dai fissati', colore: COLORI.info },

  [A.GuildUpdate]: { tipo: 'server', titolo: 'Impostazioni del server modificate', colore: COLORI.modificato },
  [A.ChannelCreate]: { tipo: 'server', titolo: 'Canale creato', colore: COLORI.entrato },
  [A.ChannelUpdate]: { tipo: 'server', titolo: 'Canale modificato', colore: COLORI.modificato },
  [A.ChannelDelete]: { tipo: 'server', titolo: 'Canale eliminato', colore: COLORI.eliminato },
  [A.ChannelOverwriteCreate]: { tipo: 'server', titolo: 'Permessi del canale aggiunti', colore: COLORI.entrato },
  [A.ChannelOverwriteUpdate]: { tipo: 'server', titolo: 'Permessi del canale modificati', colore: COLORI.modificato },
  [A.ChannelOverwriteDelete]: { tipo: 'server', titolo: 'Permessi del canale rimossi', colore: COLORI.eliminato },
  [A.RoleCreate]: { tipo: 'server', titolo: 'Ruolo creato', colore: COLORI.entrato },
  [A.RoleUpdate]: { tipo: 'server', titolo: 'Ruolo modificato', colore: COLORI.modificato },
  [A.RoleDelete]: { tipo: 'server', titolo: 'Ruolo eliminato', colore: COLORI.eliminato },
  [A.InviteCreate]: { tipo: 'server', titolo: 'Invito creato', colore: COLORI.entrato },
  [A.InviteDelete]: { tipo: 'server', titolo: 'Invito eliminato', colore: COLORI.eliminato },
  [A.WebhookCreate]: { tipo: 'server', titolo: 'Webhook creato', colore: COLORI.entrato },
  [A.WebhookUpdate]: { tipo: 'server', titolo: 'Webhook modificato', colore: COLORI.modificato },
  [A.WebhookDelete]: { tipo: 'server', titolo: 'Webhook eliminato', colore: COLORI.eliminato },
  [A.EmojiCreate]: { tipo: 'server', titolo: 'Emoji aggiunta', colore: COLORI.entrato },
  [A.EmojiUpdate]: { tipo: 'server', titolo: 'Emoji modificata', colore: COLORI.modificato },
  [A.EmojiDelete]: { tipo: 'server', titolo: 'Emoji eliminata', colore: COLORI.eliminato },
  [A.StickerCreate]: { tipo: 'server', titolo: 'Sticker aggiunto', colore: COLORI.entrato },
  [A.StickerUpdate]: { tipo: 'server', titolo: 'Sticker modificato', colore: COLORI.modificato },
  [A.StickerDelete]: { tipo: 'server', titolo: 'Sticker eliminato', colore: COLORI.eliminato },
  [A.ThreadCreate]: { tipo: 'server', titolo: 'Thread creato', colore: COLORI.entrato },
  [A.ThreadUpdate]: { tipo: 'server', titolo: 'Thread modificato', colore: COLORI.modificato },
  [A.ThreadDelete]: { tipo: 'server', titolo: 'Thread eliminato', colore: COLORI.eliminato },
  [A.BotAdd]: { tipo: 'server', titolo: 'Bot aggiunto al server', colore: COLORI.avviso },
  [A.IntegrationCreate]: { tipo: 'server', titolo: 'Integrazione aggiunta', colore: COLORI.entrato },
  [A.IntegrationDelete]: { tipo: 'server', titolo: 'Integrazione rimossa', colore: COLORI.eliminato },
  [A.GuildScheduledEventCreate]: { tipo: 'server', titolo: 'Evento creato', colore: COLORI.entrato },
  [A.GuildScheduledEventUpdate]: { tipo: 'server', titolo: 'Evento modificato', colore: COLORI.modificato },
  [A.GuildScheduledEventDelete]: { tipo: 'server', titolo: 'Evento eliminato', colore: COLORI.eliminato },
  [A.AutoModerationRuleCreate]: { tipo: 'server', titolo: 'Regola AutoMod creata', colore: COLORI.entrato },
  [A.AutoModerationRuleUpdate]: { tipo: 'server', titolo: 'Regola AutoMod modificata', colore: COLORI.modificato },
  [A.AutoModerationRuleDelete]: { tipo: 'server', titolo: 'Regola AutoMod eliminata', colore: COLORI.eliminato },
};

const CHIAVI_MODERAZIONE = new Set(['communication_disabled_until', 'mute', 'deaf']);

const ETICHETTE_CAMPI = {
  name: 'Nome',
  nick: 'Nickname',
  topic: 'Argomento',
  nsfw: 'NSFW',
  rate_limit_per_user: 'Slowmode',
  default_auto_archive_duration: 'Archiviazione automatica',
  bitrate: 'Bitrate',
  user_limit: 'Limite utenti',
  rtc_region: 'Regione',
  video_quality_mode: 'Qualita\' video',
  type: 'Tipo',
  parent_id: 'Categoria',
  channel_id: 'Canale',
  permissions: 'Permessi',
  allow: 'Permessi concessi',
  deny: 'Permessi negati',
  color: 'Colore',
  colors: 'Colori',
  hoist: 'Mostrato separatamente',
  mentionable: 'Menzionabile',
  icon_hash: 'Icona',
  unicode_emoji: 'Emoji',
  communication_disabled_until: 'Timeout fino a',
  mute: 'Silenziato dal server',
  deaf: 'Assordato dal server',
  code: 'Codice',
  max_uses: 'Utilizzi massimi',
  max_age: 'Durata',
  temporary: 'Membership temporanea',
  uses: 'Utilizzi',
  archived: 'Archiviato',
  locked: 'Bloccato',
  auto_archive_duration: 'Archiviazione automatica',
  description: 'Descrizione',
  tags: 'Tag',
  avatar_hash: 'Avatar',
  splash_hash: 'Splash',
  banner_hash: 'Banner',
  owner_id: 'Proprietario',
  afk_channel_id: 'Canale AFK',
  afk_timeout: 'Timeout AFK',
  system_channel_id: 'Canale di sistema',
  rules_channel_id: 'Canale regole',
  verification_level: 'Livello di verifica',
  explicit_content_filter: 'Filtro contenuti espliciti',
  default_message_notifications: 'Notifiche predefinite',
  vanity_url_code: 'URL personalizzato',
  enabled: 'Attiva',
  $add: 'Ruoli aggiunti',
  $remove: 'Ruoli rimossi',
};

// Rumore senza valore per chi legge il log.
const CHIAVI_IGNORATE = new Set(['id', 'position', 'permission_overwrites', 'flags', 'available', 'guild_id']);

function nomiPermessi(valore) {
  try {
    return new PermissionsBitField(BigInt(valore ?? 0)).toArray();
  } catch {
    return [];
  }
}

function formattaPermessi(vecchio, nuovo) {
  const prima = new Set(nomiPermessi(vecchio));
  const dopo = new Set(nomiPermessi(nuovo));
  const aggiunti = [...dopo].filter(p => !prima.has(p));
  const tolti = [...prima].filter(p => !dopo.has(p));

  const parti = [];
  if (aggiunti.length > 0) parti.push(`+ ${aggiunti.map(p => `\`${p}\``).join(', ')}`);
  if (tolti.length > 0) parti.push(`- ${tolti.map(p => `\`${p}\``).join(', ')}`);
  return parti.join('\n') || '*nessuna differenza*';
}

function formattaValore(chiave, valore) {
  if (valore === undefined || valore === null || valore === '') return '*nessuno*';
  if (typeof valore === 'boolean') return valore ? 'Si\'' : 'No';
  if (chiave === 'color') return `\`#${Number(valore).toString(16).padStart(6, '0')}\``;
  if (chiave === 'communication_disabled_until') return dataConRelativo(new Date(valore));
  if (chiave === 'rate_limit_per_user' || chiave === 'afk_timeout') return `${valore}s`;
  if (chiave === 'max_age') return Number(valore) === 0 ? 'Mai' : `${Math.round(Number(valore) / 3600)}h`;
  if (chiave === 'type' && ChannelType[valore] !== undefined) return ChannelType[valore];
  if (chiave === 'owner_id') return `<@${valore}>`;
  if (chiave.endsWith('channel_id') || chiave === 'parent_id') return `<#${valore}>`;
  if (typeof valore === 'object') return `\`${tronca(JSON.stringify(valore), 200)}\``;
  return `\`${tronca(String(valore).replace(/`/g, "'"), 300)}\``;
}

function formattaCambio({ key, old: vecchio, new: nuovo }) {
  if (CHIAVI_IGNORATE.has(key)) return null;
  const etichetta = ETICHETTE_CAMPI[key] ?? key;

  if (key === '$add' || key === '$remove') {
    const ruoli = (nuovo ?? []).map(r => `<@&${r.id}>`).join(' ');
    return `**${etichetta}**: ${ruoli || '*nessuno*'}`;
  }
  if (key === 'permissions' || key === 'allow' || key === 'deny') {
    return `**${etichetta}**\n${formattaPermessi(vecchio, nuovo)}`;
  }
  if (vecchio === undefined) return `**${etichetta}**: ${formattaValore(key, nuovo)}`;
  if (nuovo === undefined) return `**${etichetta}**: ${formattaValore(key, vecchio)}`;
  return `**${etichetta}**: ${formattaValore(key, vecchio)} → ${formattaValore(key, nuovo)}`;
}

function righeCambi(changes) {
  const righe = [];
  let lunghezza = 0;
  for (const change of changes ?? []) {
    const riga = formattaCambio(change);
    if (!riga) continue;
    if (lunghezza + riga.length + 1 > LIMITE_CAMBI) {
      righe.push('*...altre modifiche omesse*');
      break;
    }
    righe.push(riga);
    lunghezza += riga.length + 1;
  }
  return righe;
}

function nomeDaCambi(changes) {
  const nome = changes?.find(c => c.key === 'name');
  return nome?.new ?? nome?.old ?? null;
}

/** Come mostrare il bersaglio dell'azione, anche quando e' stato eliminato. */
function descriviBersaglio(entry, guild) {
  const id = entry.targetId;
  const nome = entry.target?.name ?? nomeDaCambi(entry.changes);

  switch (entry.targetType) {
    case 'User':
      return id ? `<@${id}> ${entry.target?.tag ? tagUtente(entry.target) : ''}`.trim() : null;
    case 'Channel':
    case 'Thread':
      return guild.channels.cache.has(id) ? `<#${id}>` : `#${nome ?? id}`;
    case 'Role':
      return guild.roles.cache.has(id) ? `<@&${id}>` : `@${nome ?? id}`;
    case 'Invite': {
      const codice = entry.target?.code ?? entry.changes?.find(c => c.key === 'code')?.new
        ?? entry.changes?.find(c => c.key === 'code')?.old;
      return codice ? `discord.gg/${codice}` : null;
    }
    case 'Guild':
      return guild.name;
    case 'Message':
      // MessageBulkDelete: il bersaglio e' il canale.
      if (entry.action === A.MessageBulkDelete) return `<#${id}>`;
      return id ? `<@${id}>` : null;
    default:
      return nome ? `${nome}${id ? ` (${id})` : ''}` : id ?? null;
  }
}

function campiExtra(entry) {
  const extra = entry.extra;
  if (!extra) return [];
  const campi = [];

  if (extra.channel?.id) campi.push({ nome: 'Canale', valore: `<#${extra.channel.id}>` });
  if (typeof extra.count === 'number' && entry.action !== A.MessageDelete) {
    campi.push({ nome: 'Quantita\'', valore: String(extra.count) });
  }
  if (typeof extra.removed === 'number') {
    campi.push({ nome: 'Rimossi', valore: `${extra.removed} (inattivi da ${extra.days} giorni)` });
  }
  if (extra.autoModerationRuleName) {
    campi.push({ nome: 'Regola', valore: extra.autoModerationRuleName });
  }
  // Overwrite di un canale: extra e' il ruolo o il membro a cui si applica.
  if ([A.ChannelOverwriteCreate, A.ChannelOverwriteUpdate, A.ChannelOverwriteDelete].includes(entry.action)) {
    const isRuolo = extra instanceof Role || extra.type === AuditLogOptionsType.Role;
    campi.push({ nome: 'Per', valore: isRuolo ? `<@&${extra.id}>` : `<@${extra.id}>` });
  }
  return campi;
}

/**
 * Titolo specifico per il timeout, che nell'audit log e' un generico
 * "membro aggiornato" con communication_disabled_until tra i cambi.
 */
function titoloModerazioneMembro(changes) {
  const timeout = changes.find(c => c.key === 'communication_disabled_until');
  if (timeout) return timeout.new ? 'Membro in timeout' : 'Timeout rimosso';
  const mute = changes.find(c => c.key === 'mute');
  if (mute) return mute.new ? 'Membro silenziato dal server' : 'Silenziamento rimosso';
  const deaf = changes.find(c => c.key === 'deaf');
  if (deaf) return deaf.new ? 'Membro assordato dal server' : 'Assordamento rimosso';
  return 'Membro aggiornato';
}

/**
 * Una voce di audit log diventa zero, uno o due log. MemberUpdate puo'
 * contenere insieme un nickname (membri) e un timeout (moderazione).
 */
function instradaVoceAudit(entry) {
  const azione = AZIONI_AUDIT[entry.action];
  if (!azione) return [];

  if (entry.action !== A.MemberUpdate) {
    // Negli overwrite "type" dice se riguarda un ruolo o un membro, non il tipo
    // di canale: e' gia' nel campo "Per".
    const overwrite = [A.ChannelOverwriteCreate, A.ChannelOverwriteUpdate, A.ChannelOverwriteDelete]
      .includes(entry.action);
    const changes = (entry.changes ?? []).filter(c => !(overwrite && c.key === 'type'));
    return [{ ...azione, changes }];
  }

  const changes = entry.changes ?? [];
  const moderazione = changes.filter(c => CHIAVI_MODERAZIONE.has(c.key));
  const membri = changes.filter(c => !CHIAVI_MODERAZIONE.has(c.key));
  const risultato = [];

  if (moderazione.length > 0) {
    const timeoutAttivo = moderazione.some(c => c.new);
    risultato.push({
      tipo: 'moderazione',
      titolo: titoloModerazioneMembro(moderazione),
      colore: timeoutAttivo ? COLORI.sanzione : COLORI.revoca,
      changes: moderazione,
    });
  }
  if (membri.length > 0) {
    const soloNick = membri.every(c => c.key === 'nick');
    risultato.push({ ...azione, titolo: soloNick ? 'Nickname cambiato' : azione.titolo, changes: membri });
  }
  return risultato;
}

function buildAuditCard(entry, guild, voce, executor) {
  const righe = righeCambi(voce.changes);

  const pulsanti = [];
  if (entry.extra?.messageId && entry.extra?.channel?.id) {
    pulsanti.push({
      label: 'Vai al messaggio',
      url: `https://discord.com/channels/${guild.id}/${entry.extra.channel.id}/${entry.extra.messageId}`,
    });
  }

  return creaScheda({
    colore: voce.colore,
    titolo: voce.titolo,
    sottotitolo: executor ? `da ${tagUtente(executor)}` : undefined,
    immagine: avatarDi(executor),
    corpo: righe.length > 0 ? righe.join('\n') : undefined,
    campi: [
      { nome: 'Bersaglio', valore: descriviBersaglio(entry, guild) },
      { nome: 'Eseguito da', valore: entry.executorId ? `<@${entry.executorId}>` : null },
      ...campiExtra(entry),
      { nome: 'Motivo', valore: entry.reason ? citazione(entry.reason) : null },
    ],
    piede: [entry.targetId && `Bersaglio ${entry.targetId}`, entry.executorId && `Esecutore ${entry.executorId}`],
    quando: entry.createdAt ?? new Date(),
    pulsanti,
  });
}

async function resolveExecutor(entry, guild) {
  if (entry.executor) return entry.executor;
  if (!entry.executorId) return null;
  try {
    return await guild.client.users.fetch(entry.executorId);
  } catch {
    return null;
  }
}

async function logAuditEntry(entry, guild) {
  if (!guild) return;
  if (logConfig.ignoraAzioniDelBot && entry.executorId && entry.executorId === guild.client?.user?.id) return;

  const voci = instradaVoceAudit(entry).filter(v => isEnabled(guild.id, v.tipo));
  if (voci.length === 0) return;

  const executor = await resolveExecutor(entry, guild);
  for (const voce of voci) {
    await sendLog(guild, voce.tipo, buildAuditCard(entry, guild, voce, executor));
  }
}

module.exports = {
  AZIONI_AUDIT,
  COLORI,
  PERMESSI_CANALE_LOG,
  TIPI,
  buildAuditCard,
  buildBulkDeleteCard,
  buildBulkTranscript,
  buildMemberJoinCard,
  buildMemberLeaveCard,
  buildMessageDeleteCard,
  buildMessageUpdateCard,
  buildVoiceCard,
  createLogChannels,
  descriviBersaglio,
  durata,
  findMessageDeleter,
  formattaCambio,
  formattaPermessi,
  instradaVoceAudit,
  isEnabled,
  isIgnoredChannel,
  isTipoValido,
  logAuditEntry,
  logMemberJoin,
  logMemberLeave,
  logMessageDelete,
  logMessageDeleteBulk,
  logMessageUpdate,
  logVoiceStateUpdate,
  missingPermissions,
  safely,
  sendLog,
  tronca,
  _resetState() {
    conteggiEliminazioni.clear();
    ultimiWarning.clear();
  },
};
