'use strict';

const {
  hierarchyRolesChanged,
  scheduleHierarchyRefresh,
} = require('../lib/gerarchia');

module.exports = {
  name: 'guildMemberUpdate',
  execute(oldMember, newMember) {
    // Solo se e' cambiato un ruolo della gerarchia: nickname o altri ruoli
    // non devono far scattare un rebuild del messaggio.
    if (!hierarchyRolesChanged(oldMember, newMember)) return;
    scheduleHierarchyRefresh(newMember.guild);
  },
};
