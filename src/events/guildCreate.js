'use strict';

const { initInviteTracking } = require('../lib/invites');

// Server in cui il bot entra (o che tornano disponibili) dopo l'avvio: senza
// la foto degli inviti il loro primo ingresso risulterebbe sempre sconosciuto.
module.exports = {
  name: 'guildCreate',
  execute(guild) {
    return initInviteTracking(guild);
  },
};
