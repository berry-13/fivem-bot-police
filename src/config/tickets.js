module.exports = {
  categories: [
    {
      value: 'richiesta_esame',
      label: 'Richiesta Esame',
      description: 'Richiedi di sostenere un esame',
      emoji: '🧠',
      roles: ['🧠| HR Team'],
    },
    {
      value: 'segnalazioni_interne',
      label: 'Segnalazioni Interne',
      description: 'Segnala un problema interno',
      emoji: '⚠️',
      roles: [
        '➖➖➖ SOTTOUFFICIALI➖➖➖',
        '➖➖➖ UFFICIALI ➖➖➖',
        '➖➖➖ COMANDO➖➖➖',
      ],
    },
    {
      value: 'colloquio_superiore',
      label: 'Colloquio con un superiore',
      description: 'Richiedi un colloquio con un superiore',
      emoji: '🗣️',
      roles: [
        '➖➖➖ SOTTOUFFICIALI➖➖➖',
        '➖➖➖ UFFICIALI ➖➖➖',
        '➖➖➖ COMANDO➖➖➖',
      ],
    },
    {
      value: 'dimissioni',
      label: 'Dimissioni',
      description: 'Presenta le tue dimissioni',
      emoji: '📄',
      roles: [
        '➖➖➖ SOTTOUFFICIALI➖➖➖',
        '➖➖➖ UFFICIALI ➖➖➖',
        '➖➖➖ COMANDO➖➖➖',
      ],
    },
  ],
  logChannelName: 'ticket-logs',
};