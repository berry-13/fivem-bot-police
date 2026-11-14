'use strict';

const gerarchia = require('./gerarchia');

// Chi puo' usare /matricola: l'Alto comando della gerarchia (primo gruppo,
// Comandante d'Aria compreso) piu' chiunque sia amministratore del server.
// Per aggiungere un ruolo basta metterne l'ID qui sotto.
module.exports = {
  allowedRoles: [...gerarchia.groups[0]],

  // Matricola a 4 cifre senza zeri iniziali: 1000-9999 (9000 numeri).
  min: 1000,
  max: 9999,
};
