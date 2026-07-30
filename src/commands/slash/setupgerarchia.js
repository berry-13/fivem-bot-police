'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { publishHierarchy } = require('../../lib/gerarchia');
const { safeDeferReply, safeInteractionReply } = require('../../lib/safe-reply');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup-gerarchia')
    .setDescription('Invia la lista della gerarchia del reparto in questo canale (si aggiorna da sola)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    // Ack IMMEDIATO: Discord scarta l'interazione dopo 3s (10062 Unknown interaction).
    // Niente await prima di questa riga.
    const ageMs = Date.now() - interaction.createdTimestamp;
    if (ageMs > 2000) {
      console.warn(`setup-gerarchia: interazione gia' vecchia di ${ageMs}ms prima del defer`);
    }

    const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const guild = interaction.guild;
    if (!guild) {
      await safeInteractionReply(interaction, {
        content: '❌ Questo comando funziona solo in un server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    let result;
    try {
      // Anche se il defer e' fallito pubblichiamo lo stesso: la gerarchia
      // passa da channel.send, non dall'interazione.
      result = await publishHierarchy(interaction.channel, guild, {
        client: interaction.client,
      });
    } catch (error) {
      console.error('Errore nel pubblicare la gerarchia:', error);
      await safeInteractionReply(interaction, {
        content:
          '❌ Impossibile caricare o inviare la gerarchia. Assicurati che il bot abbia l\'intent ' +
          '**Server Members** abilitato e i permessi per scrivere in questo canale.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const pezzi = result.messageIds.length > 1 ? ` (${result.messageIds.length} messaggi)` : '';
    const ok =
      `✅ Gerarchia inviata${pezzi}!\n` +
      'Si aggiorna in automatico quando assegni o togli i ruoli del reparto.';

    if (deferred) {
      await safeInteractionReply(interaction, { content: ok });
    } else {
      // Interazione morta: conferma in canale cosi' l'admin sa che e' andata.
      try {
        await interaction.channel.send({
          content: `${ok}\n_(conferma ephemeral non disponibile: interazione scaduta)_`,
          allowedMentions: { parse: [] },
        });
      } catch (error) {
        console.error('Gerarchia inviata ma conferma in canale fallita:', error);
      }
    }
  },
};
