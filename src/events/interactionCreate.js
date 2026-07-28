'use strict';

const { MessageFlags } = require('discord.js');

const { safeInteractionReply } = require('../lib/safe-reply');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction, client) {
    if (!interaction.isChatInputCommand()) return;

    const command = client.slashCommands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction, client);
    } catch (error) {
      console.error(`Errore nello slash command "${interaction.commandName}":`, error);
      await safeInteractionReply(interaction, {
        content: "Errore durante l'esecuzione del comando.",
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
