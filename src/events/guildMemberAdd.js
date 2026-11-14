'use strict';

const { logMemberJoin, safely } = require('../lib/logs');
const { trovaInvitoUsato } = require('../lib/invites');
const { inviaBenvenuto } = require('../lib/benvenuto');

module.exports = {
  name: 'guildMemberAdd',
  execute(member) {
    // Il benvenuto va per conto suo: disegnare la card non deve ritardare il
    // log d'ingresso, e un errore di uno non deve bloccare l'altro.
    const benvenuto = safely('benvenuto', () => inviaBenvenuto(member));
    const log = safely('guildMemberAdd', async () => {
      // Il confronto va fatto a ogni ingresso, anche con i log spenti: altrimenti
      // la foto degli inviti invecchia e il primo log dopo l'accensione sbaglia.
      // I bot entrano via OAuth, non con un invito.
      const invito = member.user.bot ? null : await trovaInvitoUsato(member.guild);
      await logMemberJoin(member, invito);
    });
    return Promise.all([benvenuto, log]);
  },
};
