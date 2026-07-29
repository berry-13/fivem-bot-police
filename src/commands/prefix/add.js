'use strict';

const { isTicketChannel, isTicketStaff } = require('../../lib/tickets');

// Accetta la menzione (<@123>, <@!123>) e l'id incollato a mano.
const RIFERIMENTO_UTENTE = /^(?:<@!?)?(\d{17,20})>?$/;

module.exports = {
  name: 'add',
  description: 'Aggiunge un utente al ticket in cui viene scritto.',
  async execute(message, args, client) {
    if (!isTicketChannel(message.channel)) {
      await message.reply('❌ Questo comando funziona solo dentro un canale ticket.');
      return;
    }

    if (!isTicketStaff(message.member)) {
      await message.reply('❌ Solo lo staff puo\' aggiungere qualcuno a un ticket.');
      return;
    }

    const riferimento = RIFERIMENTO_UTENTE.exec(args[0] ?? '');
    if (!riferimento) {
      const prefix = client?.prefix ?? '!';
      await message.reply(`Uso: \`${prefix}add @utente\` (va bene anche solo l'id).`);
      return;
    }

    const member = await message.guild.members.fetch(riferimento[1]).catch(() => null);
    if (!member) {
      await message.reply('❌ Non trovo quell\'utente in questo server.');
      return;
    }

    try {
      await message.channel.permissionOverwrites.edit(member.id, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
      });
    } catch (error) {
      console.error('Impossibile aggiungere un utente al ticket:', error);
      await message.reply('❌ Non sono riuscito a dargli accesso. Controlla i miei permessi sul canale.');
      return;
    }

    await message.reply(`✅ ${member} ora ha accesso a questo ticket.`);
  },
};
