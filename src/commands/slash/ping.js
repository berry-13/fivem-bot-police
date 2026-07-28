'use strict';

const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Risponde con Pong!'),
  async execute(interaction, client) {
    await interaction.reply(`Pong! Latenza gateway: ${Math.round(client.ws.ping)}ms`);
  },
};
