'use strict';

// Messaggio di benvenuto per chi entra nel server.
module.exports = {
  // 📌・ʙᴇɴᴠᴇɴᴜᴛᴏ
  channelId: '1527652730804633610',

  // Oro del distintivo: bordo dell'embed.
  color: 0xc9a44c,

  // Canali citati nel messaggio, in quest'ordine.
  passi: [
    { emoji: '👮', testo: 'Richiedi i tuoi ruoli in', channelId: '1527657556745388104' },
    { emoji: '💫', testo: 'Vuoi entrare nel reparto? Candidati in', channelId: '1532165004369858600' },
    { emoji: '🎫', testo: 'Per qualsiasi problema apri un ticket in', channelId: '1532036582016679956' },
  ],

  // Frase sulla card, una a caso per ogni ingresso.
  frasi: [
    'Il rispetto si guadagna un turno alla volta.',
    'Il distintivo pesa: portalo con onore.',
    'Disciplina oggi, fiducia domani.',
    'La differenza la fa chi si presenta, turno dopo turno.',
  ],

  footer: "Los Santos Sheriff's Department • Servire e proteggere",
};
