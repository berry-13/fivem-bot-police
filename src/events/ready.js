'use strict';

module.exports = {
  name: 'clientReady',
  once: true,
  execute(client) {
    console.log(`Bot online come ${client.user.tag} su ${client.guilds.cache.size} server.`);

    // Riempie la cache membri in background (intent GuildMembers). Cosi'
    // /setup-gerarchia e i refresh non devono scaricare tutto a freddo sotto
    // la finestra dei 3 secondi dell'interazione.
    for (const guild of client.guilds.cache.values()) {
      guild.members.fetch()
        .then(members => {
          console.log(`Cache membri pronta per ${guild.name}: ${members.size} membri.`);
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
