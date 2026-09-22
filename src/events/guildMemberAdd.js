'use strict';

const { logMemberJoin, safely } = require('../lib/logs');
const { trovaInvitoUsato } = require('../lib/invites');

module.exports = {
  name: 'guildMemberAdd',
  execute(member) {
    return safely('guildMemberAdd', async () => {
      // Il confronto va fatto a ogni ingresso, anche con i log spenti: altrimenti
      // la foto degli inviti invecchia e il primo log dopo l'accensione sbaglia.
      // I bot entrano via OAuth, non con un invito.
      const invito = member.user.bot ? null : await trovaInvitoUsato(member.guild);
      await logMemberJoin(member, invito);
    });
  },
};
