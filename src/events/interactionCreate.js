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
const bandoConfig = require('../config/bandi');
const { safeInteractionReply, isDeadInteractionError } = require('../lib/safe-reply');
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
        // Se l'interazione e' gia' morta (10062/40060) un altro reply fallisce
        // di nuovo e riempie solo i log: usciamo.
        if (isDeadInteractionError(error)) return;
        await safeInteractionReply(interaction, {
          content: "❌ Errore durante l'esecuzione del comando.",
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    // Le autocomplete arrivano come interazioni a parte: rispondere con
    // interaction.respond e' l'unico modo, un reply normale qui fallisce.
    if (interaction.isAutocomplete()) {
      const command = client.slashCommands.get(interaction.commandName);
      if (typeof command?.autocomplete !== 'function') return;

      try {
        await command.autocomplete(interaction, client);
      } catch (error) {
        // Niente da rispondere all'utente: la finestra dei suggerimenti si
        // chiude da sola e il comando resta usabile scrivendo il valore a mano.
        console.error(`Errore nell'autocomplete di "${interaction.commandName}":`, error);
      }
      return;
    }

    if (interaction.isStringSelectMenu() && PANNELLI[interaction.customId]) {
      const pannello = PANNELLI[interaction.customId];
      await runTicketHandler(interaction, (i) => handleTicketOpen(i, pannello), "l'apertura");
      return;
    }

    if (interaction.isButton() && interaction.customId === 'ticket-close') {
      await runTicketHandler(interaction, handleTicketClose, 'la chiusura');
      return;
    }
  },
};

/**
 * Ticket generali e bandi aprono lo stesso tipo di canale, cambiano solo le
 * categorie disponibili e il testo di benvenuto. Tenerli in una mappa evita di
 * duplicare tutta l'apertura del ticket per il secondo pannello.
 */
const PANNELLI = {
  'ticket-select': {
    categories: ticketConfig.categories,
    titolo: (label) => `🎫 Ticket: ${label}`,
    corpo: (utente, label) =>
      `Ciao ${utente}, grazie per aver aperto un ticket.\n` +
      `Categoria: **${label}**\n\n` +
      'Spiega qui il motivo della tua richiesta, un membro competente ti risponderà a breve.',
  },
  'bando-select': {
    categories: bandoConfig.categories,
    titolo: (label) => `📋 Candidatura: ${label}`,
    corpo: (utente, label) =>
      `Ciao ${utente}, grazie per esserti candidato/a.\n` +
      `Bando: **${label}**\n\n` +
      'Presenta qui la tua candidatura, il Capo Reparto o il Vice Capo Reparto ti risponderà a breve.',
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

async function handleTicketOpen(interaction, pannello) {
  const categoryValue = interaction.values[0];
  const category = pannello.categories.find((c) => c.value === categoryValue);
  if (!category) {
    return interaction.reply({ content: '❌ Categoria non valida.', flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guild = interaction.guild;

  const resolvedRoles = category.roles
    .map((roleName) => guild.roles.cache.find((r) => r.name === roleName))
    .filter(Boolean);

  if (resolvedRoles.length !== category.roles.length) {
    const mancanti = category.roles.filter((nome) => !guild.roles.cache.some((r) => r.name === nome));
    console.warn(
      `⚠️ Ruoli non trovati per "${category.label}": ${mancanti.map((n) => `"${n}"`).join(', ')}. ` +
      'Controlla i nomi in src/config/tickets.js o src/config/bandi.js (emoji e spazi compresi).'
    );
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
    .setTitle(pannello.titolo(category.label))
    .setDescription(pannello.corpo(interaction.user, category.label));

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
