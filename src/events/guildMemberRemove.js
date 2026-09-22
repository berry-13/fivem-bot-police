'use strict';

const {
  memberHasHierarchyRole,
  scheduleHierarchyRefresh,
} = require('../lib/gerarchia');
const { logMemberLeave, safely } = require('../lib/logs');

module.exports = {
  name: 'guildMemberRemove',
  execute(member) {
    // Il log parte in parallelo: non deve ritardare il refresh della gerarchia.
    safely('guildMemberRemove', () => logMemberLeave(member));

    // Se chi esce aveva un grado del reparto, togliamolo dalla lista.
    if (!memberHasHierarchyRole(member)) return;
    scheduleHierarchyRefresh(member.guild);
  },
};
