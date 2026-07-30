'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { publishHierarchy } = require('../../lib/gerarchia');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup-gerarchia')
    .setDescription('Invia la lista della gerarchia del reparto in questo canale (si aggiorna da sola)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    // Il fetch di tutti i membri puo' richiedere qualche secondo su server grandi.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guild = interaction.guild;
    if (!guild) {
      await interaction.editReply({ content: '❌ Questo comando funziona solo in un server.' });
      return;
    }

    let result;
    try {
      result = await publishHierarchy(interaction.channel, guild, {
        client: interaction.client,
      });
    } catch (error) {
      console.error('Errore nel pubblicare la gerarchia:', error);
      await interaction.editReply({
        content:
          '❌ Impossibile caricare o inviare la gerarchia. Assicurati che il bot abbia l\'intent ' +
          '**Server Members** abilitato e i permessi per scrivere in questo canale.',
      });
      return;
    }

    const pezzi = result.messageIds.length > 1 ? ` (${result.messageIds.length} messaggi)` : '';
    await interaction.editReply({
      content:
        `✅ Gerarchia inviata${pezzi}!\n` +
        'Si aggiorna in automatico quando assegni o togli i ruoli del reparto.',
    });
  },
};
