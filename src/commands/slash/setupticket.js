const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, PermissionFlagsBits } = require('discord.js');
const ticketConfig = require('../../config/tickets');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup-ticket')
    .setDescription('Invia il pannello per aprire i ticket in questo canale')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(0xE91E63)
      .setTitle('🎫 • Ticket Lista Ticket Generali')
      .setDescription(
        'Benvenuto/a Nella Richiesta Ticket.\n\n' +
        'Seleziona una delle categorie elencate qui sotto nel menù a tendina!\n\n' +
        'In caso di riscontro di anomalie puoi sempre compilare il Modulo Assistenza per ricevere supporto da parte del nostro Staff'
      );

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('ticket-select')
      .setPlaceholder('Seleziona una categoria qui!')
      .addOptions(
        ticketConfig.categories.map((cat) => ({
          label: cat.label,
          description: cat.description,
          value: cat.value,
          emoji: cat.emoji,
        }))
      );

    const row = new ActionRowBuilder().addComponents(selectMenu);

    await interaction.channel.send({ embeds: [embed], components: [row] });
    await interaction.reply({ content: '✅ Pannello ticket inviato!', ephemeral: true });
  },
};