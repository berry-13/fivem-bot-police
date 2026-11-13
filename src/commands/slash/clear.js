'use strict';

const { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const store = require('../../lib/logs-store');
const { safeDeferReply, safeInteractionReply } = require('../../lib/safe-reply');

// Tetto di sicurezza: 100 messaggi per giro, quindi al massimo 5000 messaggi.
const MAX_GIRI = 50;
// Discord elimina in blocco solo messaggi con meno di 14 giorni; teniamo un
// minuto di margine per non mandare un id che scade durante la richiesta.
const ETA_MASSIMA_MS = 14 * 24 * 60 * 60 * 1000 - 60 * 1000;
// "Unknown Message": il messaggio e' gia' sparito, che e' quello che volevamo.
const MESSAGGIO_SCONOSCIUTO = 10008;

function giaEliminato(error) {
  return error?.code === MESSAGGIO_SCONOSCIUTO;
}

async function eliminaBlocco(channel, ids) {
  if (ids.length === 1) {
    try {
      await channel.messages.delete(ids[0]);
      return 1;
    } catch (error) {
      if (giaEliminato(error)) return 0;
      throw error;
    }
  }
  try {
    await channel.bulkDelete(ids);
    return ids.length;
  } catch (error) {
    if (!giaEliminato(error)) throw error;
    // Uno degli id non esiste piu': si ripiega sull'eliminazione singola.
    let eliminati = 0;
    for (const id of ids) eliminati += await eliminaBlocco(channel, [id]);
    return eliminati;
  }
}

/**
 * Svuota il canale a blocchi di 100. Si scorre all'indietro con il cursore
 * `before`, cosi' un messaggio appena eliminato che Discord restituisce ancora
 * per qualche istante non viene riletto (era la causa degli errori 10008).
 * I messaggi piu' vecchi di 14 giorni non si possono eliminare in blocco: al
 * primo che si incontra ci si ferma, perche' i successivi sono tutti piu' vecchi.
 */
async function svuotaCanale(channel) {
  let eliminati = 0;
  let before;
  for (let giro = 0; giro < MAX_GIRI; giro++) {
    const blocco = await channel.messages.fetch(before ? { limit: 100, before } : { limit: 100 });
    if (blocco.size === 0) break;
    before = blocco.lastKey();

    const limite = Date.now() - ETA_MASSIMA_MS;
    const ids = [];
    let trovatoVecchio = false;
    for (const [id, message] of blocco) {
      if (message.createdTimestamp < limite) {
        trovatoVecchio = true;
        break;
      }
      ids.push(id);
    }
    if (ids.length > 0) eliminati += await eliminaBlocco(channel, ids);
    if (trovatoVecchio || blocco.size < 100) break;
  }
  return eliminati;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Elimina tutti i messaggi del canale in cui lanci il comando')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  svuotaCanale,

  async execute(interaction) {
    const channel = interaction.channel;
    if (!interaction.guild || !channel?.bulkDelete) {
      await safeInteractionReply(interaction, {
        content: 'Questo comando funziona solo in un canale di testo di un server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Il permesso predefinito del comando lo possono cambiare gli admin e vale a
    // livello di server: controlliamo chi lo lancia sul canale, dove valgono
    // anche gli overwrite (lo staff in sola lettura sui log non puo' svuotarli).
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      await safeInteractionReply(interaction, {
        content: 'Ti serve il permesso Gestire i messaggi in questo canale.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // I canali di log sono l'archivio: svuotarli e' riservato agli amministratori.
    const canaliLog = Object.values(store.getChannels(interaction.guild.id));
    if (
      canaliLog.includes(channel.id) &&
      !interaction.memberPermissions.has(PermissionFlagsBits.Administrator)
    ) {
      await safeInteractionReply(interaction, {
        content: 'Solo un amministratore puo\' svuotare un canale di log.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const permessi = channel.permissionsFor(interaction.guild.members.me);
    const mancanti = permessi?.missing([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.ManageMessages,
    ]) ?? [];
    if (mancanti.length > 0) {
      await safeInteractionReply(interaction, {
        content: `Al bot mancano i permessi in questo canale: ${mancanti.join(', ')}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // L'eliminazione puo' richiedere diversi giri: ack subito, risposta privata.
    if (!(await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral }))) return;

    let eliminati;
    try {
      eliminati = await svuotaCanale(channel);
    } catch (error) {
      console.error(`/clear fallito in #${channel.name}:`, error);
      await safeInteractionReply(interaction, {
        content: `Pulizia interrotta: ${error.message}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await safeInteractionReply(interaction, {
      content:
        eliminati === 0
          ? 'Nessun messaggio da eliminare (Discord non permette di eliminare in blocco quelli piu\' vecchi di 14 giorni).'
          : `Eliminati ${eliminati} messaggi. Quelli piu' vecchi di 14 giorni restano: Discord non li elimina in blocco.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
