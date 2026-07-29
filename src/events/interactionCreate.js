'use strict';

const {
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const ticketConfig = require('../config/tickets');
const { safeInteractionReply } = require('../lib/safe-reply');
const {
  archiveTicket,
  buildTicketChannelName,
  closingMessage,
  scheduleTicketDeletion,
} = require('../lib/tickets');

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
      await runTicketHandler(interaction, handleTicketOpen, "l'apertura");
      return;
    }

    if (interaction.isButton() && interaction.customId === 'ticket-close') {
      await runTicketHandler(interaction, handleTicketClose, 'la chiusura');
      return;
    }
  },
};

/**
 * Stessa rete di sicurezza che avvolge gli slash command. discord.js non
 * aspetta il nostro handler: un throw qui diventa una unhandled rejection e
 * lascia l'utente con l'interazione ferma su "sta pensando" per sempre.
 */
async function runTicketHandler(interaction, handler, fase) {
  try {
    await handler(interaction);
  } catch (error) {
    console.error(`Errore durante ${fase} del ticket:`, error);
    await safeInteractionReply(interaction, {
      content: `❌ Errore durante ${fase} del ticket.`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

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

  const channelName = buildTicketChannelName(category, interaction.user.username);

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

  // Il canale esiste gia': se il benvenuto non parte lo segnaliamo nei log ma
  // diciamo comunque all'utente dov'e' il suo ticket, altrimenti resta con un
  // canale aperto e nessuna indicazione.
  try {
    await ticketChannel.send({
      content: `${interaction.user} ${pingRoles}`,
      embeds: [welcomeEmbed],
      components: [row],
    });
  } catch (error) {
    console.error('Ticket creato ma messaggio di benvenuto non inviato:', error);
  }

  await interaction.editReply({ content: `✅ Ticket creato: ${ticketChannel}` });
}

async function handleTicketClose(interaction) {
  await interaction.deferReply();

  const channel = interaction.channel;
  const trascrizioneSalvata = await archiveTicket(channel, {
    guild: interaction.guild,
    closedBy: interaction.user,
  });

  await interaction.editReply(closingMessage(trascrizioneSalvata));

  scheduleTicketDeletion(channel);
}
