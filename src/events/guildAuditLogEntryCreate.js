'use strict';

const { logAuditEntry, safely } = require('../lib/logs');

// Unica fonte per moderazione, ruoli, nickname e modifiche al server: la voce di
// audit log porta gia' chi ha fatto l'azione e il motivo, senza doverlo cercare.
// Richiede l'intent GuildModeration e il permesso Visualizzare il registro.
module.exports = {
  name: 'guildAuditLogEntryCreate',
  execute(entry, guild) {
    return safely('guildAuditLogEntryCreate', () => logAuditEntry(entry, guild));
  },
};
