'use strict';

/**
 * Configurazione dei log del server.
 *
 * Ogni tipo ha un canale dedicato, scelto con /setup-log: "crea" genera una
 * categoria privata con un canale per tipo, "imposta" usa un canale esistente.
 * Un tipo senza canale e' semplicemente spento.
 */
module.exports = {
  // Nome della categoria creata da "/setup-log crea".
  categoria: 'Server Log',

  tipi: [
    {
      value: 'messaggi',
      label: 'Messaggi',
      descrizione: 'Messaggi modificati, eliminati, eliminazioni di massa, fissati',
      canale: 'log-messaggi',
    },
    {
      value: 'membri',
      label: 'Membri',
      descrizione: 'Ingressi, uscite, nickname e ruoli',
      canale: 'log-membri',
    },
    {
      value: 'moderazione',
      label: 'Moderazione',
      descrizione: 'Ban, espulsioni, timeout, AutoMod, spostamenti in voce',
      canale: 'log-moderazione',
    },
    {
      value: 'voce',
      label: 'Voce',
      descrizione: 'Ingressi, uscite e cambi di canale vocale',
      canale: 'log-voce',
    },
    {
      value: 'server',
      label: 'Server',
      descrizione: 'Canali, ruoli, permessi, inviti, webhook, emoji e impostazioni',
      canale: 'log-server',
    },
  ],

  // Messaggi scritti da bot: modificati ed eliminati di continuo (embed live,
  // pannelli), riempirebbero il canale di rumore.
  ignoraBot: true,

  // Azioni fatte da questo bot (apertura e chiusura dei ticket, creazione dei
  // canali di log): hanno gia' il loro archivio in ticket-logs.
  ignoraAzioniDelBot: true,

  // Id di canali da non loggare mai (messaggi e voce), oltre ai canali di log.
  canaliIgnorati: [],

  // Un account piu' giovane di cosi' viene segnalato all'ingresso.
  giorniAccountNuovo: 7,
};
