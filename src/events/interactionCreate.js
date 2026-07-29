'use strict';

const {
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  MessageFlags,
} = require('discord.js');
const ticketConfig = require('../config/tickets');
const { safeInteractionReply } = require('../lib/safe-reply');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction, client) {
    if (interaction.isChatInputCommand()) {
      const command = client.slashCommands.get(interaction.commandName);
      if (!command) return;

      try {
        await command.execute(interaction, client);
      } catch (error) {
        console.error(`Errore nello slash command "${interaction.commandName}":`, error);
        await safeInteractionReply(interaction, {
          content: "❌ Errore durante l'esecuzione del comando.",
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket-select') {
      await handleTicketOpen(interaction);
      return;
    }

    if (interaction.isButton() && interaction.customId === 'ticket-close') {
      await handleTicketClose(interaction);
      return;
    }
  },
};

async function handleTicketOpen(interaction) {
  const categoryValue = interaction.values[0];
  const category = ticketConfig.categories.find((c) => c.value === categoryValue);
  if (!category) {
    return interaction.reply({ content: '❌ Categoria non valida.', flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guild = interaction.guild;

  const resolvedRoles = category.roles
    .map((roleName) => guild.roles.cache.find((r) => r.name === roleName))
    .filter(Boolean);

  if (resolvedRoles.length !== category.roles.length) {
    console.warn(`⚠️ Alcuni ruoli per "${category.label}" non trovati. Controlla i nomi in src/config/tickets.js`);
  }

  const channelName = `ticket-${interaction.user.username}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .slice(0, 90);

  const permissionOverwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: interaction.user.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    },
    {
      id: interaction.client.user.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory],
    },
    ...resolvedRoles.map((role) => ({
      id: role.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    })),
  ];

  let ticketChannel;
  try {
    ticketChannel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: process.env.TICKET_CATEGORY_ID || null,
      permissionOverwrites,
    });
  } catch (error) {
    console.error(error);
    return interaction.editReply({ content: '❌ Non sono riuscito a creare il canale ticket. Controlla i miei permessi.' });
  }

  const welcomeEmbed = new EmbedBuilder()
    .setColor(0xE91E63)
    .setTitle(`🎫 Ticket: ${category.label}`)
    .setDescription(
      `Ciao ${interaction.user}, grazie per aver aperto un ticket.\n` +
      `Categoria: **${category.label}**\n\n` +
      `Spiega qui il motivo della tua richiesta, un membro competente ti risponderà a breve.`
    );

  const closeButton = new ButtonBuilder()
    .setCustomId('ticket-close')
    .setLabel('Chiudi Ticket')
    .setEmoji('🔒')
    .setStyle(ButtonStyle.Danger);

  const row = new ActionRowBuilder().addComponents(closeButton);
  const pingRoles = resolvedRoles.map((r) => `<@&${r.id}>`).join(' ');

  await ticketChannel.send({
    content: `${interaction.user} ${pingRoles}`,
    embeds: [welcomeEmbed],
    components: [row],
  });

  await interaction.editReply({ content: `✅ Ticket creato: ${ticketChannel}` });
}

async function handleTicketClose(interaction) {
  await interaction.deferReply();

  const channel = interaction.channel;
  const guild = interaction.guild;

  const messages = await fetchAllMessages(channel);
  const transcript = messages
    .reverse()
    .map((m) => {
      const time = new Date(m.createdTimestamp).toLocaleString('it-IT');
      return `[${time}] ${m.author.tag}: ${m.content}`;
    })
    .join('\n');

  const buffer = Buffer.from(transcript || 'Nessun messaggio.', 'utf-8');
  const attachment = new AttachmentBuilder(buffer, { name: `${channel.name}.txt` });

  let logChannel = guild.channels.cache.find(
    (c) => c.name === ticketConfig.logChannelName && c.type === ChannelType.GuildText
  );

  if (!logChannel) {
    try {
      logChannel = await guild.channels.create({
        name: ticketConfig.logChannelName,
        type: ChannelType.GuildText,
        permissionOverwrites: [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }],
      });
    } catch (error) {
      console.error('Impossibile creare il canale ticket-logs:', error);
    }
  }

  if (logChannel) {
    const logEmbed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setTitle('📁 Ticket chiuso')
      .addFields(
        { name: 'Canale', value: `#${channel.name}`, inline: true },
        { name: 'Chiuso da', value: `${interaction.user.tag}`, inline: true }
      )
      .setTimestamp();

    await logChannel.send({ embeds: [logEmbed], files: [attachment] });
  }

  await interaction.editReply('🔒 Ticket in chiusura tra 5 secondi... la trascrizione è stata salvata.');

  setTimeout(() => {
    channel.delete().catch(console.error);
  }, 5000);
}

async function fetchAllMessages(channel) {
  let allMessages = [];
  let lastId;

  while (true) {
    const options = { limit: 100 };
    if (lastId) options.before = lastId;

    const messages = await channel.messages.fetch(options);
    if (messages.size === 0) break;

    allMessages = allMessages.concat(Array.from(messages.values()));
    lastId = messages.last().id;

    if (messages.size < 100) break;
  }

  return allMessages;
}