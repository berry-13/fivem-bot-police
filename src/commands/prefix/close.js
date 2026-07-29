'use strict';

const { safeReply } = require('../../lib/safe-reply');
const {
  archiveTicket,
  closingMessage,
  isTicketChannel,
  scheduleTicketDeletion,
} = require('../../lib/tickets');

module.exports = {
  name: 'close',
  description: 'Chiude il ticket in cui viene scritto, salvando la trascrizione.',
  async execute(message) {
    if (!isTicketChannel(message.channel)) {
      await message.reply('❌ Questo comando funziona solo dentro un canale ticket.');
      return;
    }

    const trascrizioneSalvata = await archiveTicket(message.channel, {
      guild: message.guild,
      closedBy: message.author,
    });

    // safeReply e non reply: se l'avviso non parte il ticket deve chiudersi
    // lo stesso, altrimenti resta aperto per un errore cosmetico.
    await safeReply(message, closingMessage(trascrizioneSalvata));

    scheduleTicketDeletion(message.channel);
  },
};
