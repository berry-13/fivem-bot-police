'use strict';

module.exports = {
  name: 'ping',
  description: 'Risponde con Pong! e mostra la latenza del gateway.',
  async execute(message, args, client) {
    await message.reply(`Pong! Latenza gateway: ${Math.round(client.ws.ping)}ms`);
  },
};
