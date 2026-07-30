'use strict';

const { ensureMembersCached } = require('../lib/gerarchia');

module.exports = {
  name: 'clientReady',
  once: true,
  execute(client) {
    console.log(`Bot online come ${client.user.tag} su ${client.guilds.cache.size} server.`);

    // Un solo fetch per guild (condiviso con setup/refresh via ensureMembersCached).
    for (const guild of client.guilds.cache.values()) {
      ensureMembersCached(guild)
        .then(members => {
          const size = members?.size ?? guild.members.cache.size;
          console.log(`Cache membri pronta per ${guild.name}: ${size} membri.`);
        })
        .catch(error => {
          console.warn(
            `Impossibile precaricare i membri di ${guild.name}: ${error.message}. ` +
              'Verifica che Server Members Intent sia abilitato nel Developer Portal.',
          );
        });
    }
  },
};
