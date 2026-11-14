'use strict';

const gerarchia = require('./gerarchia');

// Chi puo' usare /matricola: l'Alto comando della gerarchia (primo gruppo,
// Comandante d'Aria compreso), i ruoli extra qui sotto e chiunque sia
// amministratore del server. Per aggiungere un ruolo basta metterne l'ID qui.
module.exports = {
  allowedRoles: [
    ...gerarchia.groups[0],
    '1527673537064861828', // abilitato solo a /matricola
  ],

  // Matricola a 4 cifre senza zeri iniziali: 1000-9999 (9000 numeri).
  min: 1000,
  max: 9999,

  // Canale con l'elenco pubblico delle matricole: il bot lo tiene aggiornato
  // da solo a ogni assegnazione (e all'avvio).
  boardChannelId: '1571197516744101969',
  title: '# MATRICOLE SHERIFF\'S DEPARTMENT',
  emptyPlaceholder: '_Nessuna matricola assegnata._',
};
