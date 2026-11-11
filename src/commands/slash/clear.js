'use strict';

const { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { safeDeferReply, safeInteractionReply } = require('../../lib/safe-reply');

// Tetto di sicurezza: 100 messaggi per giro, quindi al massimo 5000 messaggi.
const MAX_GIRI = 50;

/**
 * Svuota il canale a blocchi di 100. Discord rifiuta di eliminare in blocco i
 * messaggi piu' vecchi di 14 giorni: bulkDelete(..., true) li salta, e quando
 * un giro non elimina nulla ci fermiamo invece di girare a vuoto.
 */
async function svuotaCanale(channel) {
  let eliminati = 0;
  for (let giro = 0; giro < MAX_GIRI; giro++) {
    const rimossi = await channel.bulkDelete(100, true);
    if (rimossi.size === 0) break;
    eliminati += rimossi.size;
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
