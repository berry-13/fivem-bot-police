// Stessa forma di config/tickets.js: candidarsi a un bando apre un ticket, e i
// ruoli elencati qui sono quelli che vedono il canale e vengono pingati.
// I nomi devono combaciare carattere per carattere con quelli del server,
// emoji e spazi compresi, altrimenti il ruolo non viene risolto.
module.exports = {
  categories: [
    {
      value: 'bando_risorse_umane',
      label: 'Bando Risorse Umane',
      description: 'Candidati per il reparto Risorse Umane',
      emoji: '🧠',
      roles: ['🧠| HR Capo Reparto', '🧠| HR Vice Capo Reparto'],
    },
    {
      value: 'bando_coordinamento',
      label: 'Bando Coordinamento',
      description: 'Candidati per il reparto Coordinamento',
      emoji: '📞',
      roles: ['📞| Coordinamento Capo Reparto', '📞| Coordinamento Vice Capo Reparto'],
    },
    {
      value: 'bando_documentazione',
      label: 'Bando Documentazione',
      description: 'Candidati per il reparto Documentazione',
      emoji: '📋',
      roles: ['📋| Documentazione Capo Reparto', '📋| Documentazione Vice Capo Reparto'],
    },
    {
      value: 'bando_magazzino',
      label: 'Bando Magazzino',
      description: 'Candidati per il reparto Magazzino',
      emoji: '📦',
      roles: ['📦| Magazzino Capo Reparto', '📦| Magazzino Vice Capo Reparto'],
    },
    {
      value: 'bando_pubbliche_relazioni',
      label: 'Bando Pubbliche Relazioni',
      description: 'Candidati per il reparto Pubbliche Relazioni',
      emoji: '📢',
      roles: ['📢| Pubbliche Relazioni Capo Reparto', '📢| Pubbliche Relazioni Vice Capo Reparto'],
    },
    {
      value: 'bando_sert',
      label: 'Bando SERT',
      description: 'Candidati per il reparto SERT',
      emoji: '🦅',
      roles: ['🦅| SERT Capo Reparto', '🦅| SERT Vice Capo Reparto'],
    },
    {
      value: 'bando_cid',
      label: 'Bando CID',
      description: 'Candidati per il reparto CID',
      emoji: '🕵️',
      roles: ['🕵️| CID Capo Reparto', '🕵️| CID Vice Capo Reparto'],
    },
    {
      value: 'bando_hsu',
      label: 'Bando HSU',
      description: 'Candidati per il reparto HSU',
      emoji: '🚓',
      roles: ['🚓| HSU Capo Reparto', '🚓| HSU Vice Capo Reparto'],
    },
    {
      value: 'bando_elicotteristi',
      label: 'Bando Elicotteristi',
      description: 'Candidati per il reparto Elicotteristi',
      emoji: '🚁',
      // Attenzione: questi due hanno uno spazio prima della barra, a differenza
      // di tutti gli altri ruoli. E' come sono scritti sul server.
      roles: ['🚁 | Elicotteristi Capo Reparto', '🚁 | Elicotteristi Vice Capo Reparto'],
    },
    {
      value: 'bando_mary',
      label: 'Bando Mary',
      description: 'Candidati per il reparto Mary',
      emoji: '🏍️',
      roles: ['🏍️| Mary Capo Reparto', '🏍️| Mary Vice Capo Reparto'],
    },
    {
      value: 'bando_diportista',
      label: 'Bando Diportista',
      description: 'Candidati per il reparto Diportista',
      emoji: '🚢',
      roles: ['🚢| Diportista Capo Reparto', '🚢| Diportista Vice Capo Reparto'],
    },
  ],
};
