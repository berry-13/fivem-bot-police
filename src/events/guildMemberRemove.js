'use strict';

const {
  memberHasHierarchyRole,
  scheduleHierarchyRefresh,
} = require('../lib/gerarchia');

module.exports = {
  name: 'guildMemberRemove',
  execute(member) {
    // Se chi esce aveva un grado del reparto, togliamolo dalla lista.
    if (!memberHasHierarchyRole(member)) return;
    scheduleHierarchyRefresh(member.guild);
  },
};
