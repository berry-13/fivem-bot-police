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
    "The desert doesn't forgive. Neither do we.",
    "Sandy Shores sleeps because we don't.",
    'Badge on. Mercy off.',
    "We don't chase trouble. Trouble pulls over.",
    'Quiet county. Loud consequences.',
    'Lights on. Eyes up. Earn the star.',
  ],

  footer: "Los Santos Sheriff's Department • Servire e proteggere",

  // Messaggio per chi esce dal server: stessa card, altro titolo e frasi.
  arrivederci: {
    // 📌・ᴀʀʀɪᴠᴇᴅᴇʀᴄɪ
    channelId: '1527655500773195788',
    titolo: 'ARRIVEDERCI',
    frasi: [
      'End of watch.',
      'Badge turned in. Legacy stays.',
      'The road goes on. So do we.',
      'Clocked out. The desert remembers.',
      "Drive safe out there. We'll hold the line.",
      'Last patrol done. Respect earned.',
    ],
  },
};
