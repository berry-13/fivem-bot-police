'use strict';

const { ensureMembersCached } = require('../lib/gerarchia');
const { startLiveMonitor } = require('../lib/live');
const { initInviteTracking } = require('../lib/invites');
const { diagnosticaLog } = require('../lib/logs');

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

    // Stato dei log: canali mancanti o permessi persi si vedono subito in console.
    for (const guild of client.guilds.cache.values()) {
      for (const riga of diagnosticaLog(guild)) console.warn(riga);
    }

    // Foto iniziale degli inviti: senza, il primo ingresso non dice da dove arriva.
    for (const guild of client.guilds.cache.values()) {
      initInviteTracking(guild).catch(error => {
        console.warn(`Tracciamento inviti non avviato per ${guild.name}: ${error.message}`);
      });
    }

    // Notifiche quando gli streamer di config/live.js vanno in live (Twitch/TikTok).
    // Si spegne in registerShutdown cosi' non resta un interval dopo SIGTERM.
    client.liveMonitor = startLiveMonitor(client);
  },
};
