'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { buildHierarchyMessages } = require('../../lib/gerarchia');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup-gerarchia')
    .setDescription('Invia la lista della gerarchia del reparto in questo canale')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    // Il fetch di tutti i membri puo' richiedere qualche secondo su server grandi.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guild = interaction.guild;
    if (!guild) {
      await interaction.editReply({ content: '❌ Questo comando funziona solo in un server.' });
      return;
    }

    let chunks;
    try {
      chunks = await buildHierarchyMessages(guild);
    } catch (error) {
      console.error('Errore nel costruire la gerarchia:', error);
      await interaction.editReply({
        content:
          '❌ Impossibile caricare i membri. Assicurati che il bot abbia l\'intent **Server Members** ' +
          'abilitato nel Developer Portal e i permessi per vedere i membri.',
      });
      return;
    }

    // allowedMentions vuoto: i ping si vedono ma non notificano nessuno
    // (altrimenti al setup partirebbero decine di ping a ruoli e utenti).
    const sendOptions = { allowedMentions: { parse: [] } };

    for (const content of chunks) {
      await interaction.channel.send({ content, ...sendOptions });
    }

    const pezzi = chunks.length > 1 ? ` (${chunks.length} messaggi)` : '';
    await interaction.editReply({ content: `✅ Gerarchia inviata${pezzi}!` });
  },
};
