const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const bandoConfig = require('../../config/bandi');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup-bando')
    .setDescription('Invia il pannello per candidarsi ai bandi in questo canale')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(0xE91E63)
      .setTitle('📋 • Bandi Reparti')
      .setDescription(
        'Benvenuto/a nella sezione candidature.\n\n' +
        'Seleziona il bando a cui vuoi candidarti dal menù a tendina qui sotto: verrà aperto un ticket dedicato ' +
        'dove potrai presentare la tua candidatura.\n\n' +
        'Ti risponderanno il Capo Reparto o il Vice Capo Reparto del reparto scelto.'
      );

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('bando-select')
      .setPlaceholder('Seleziona un bando qui!')
      .addOptions(
        bandoConfig.categories.map((cat) => ({
          label: cat.label,
          description: cat.description,
          value: cat.value,
          emoji: cat.emoji,
        }))
      );

    const row = new ActionRowBuilder().addComponents(selectMenu);

    await interaction.channel.send({ embeds: [embed], components: [row] });
    await interaction.reply({ content: '✅ Pannello bandi inviato!', flags: MessageFlags.Ephemeral });
  },
};
