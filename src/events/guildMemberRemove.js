'use strict';

const {
  memberHasHierarchyRole,
  scheduleHierarchyRefresh,
} = require('../lib/gerarchia');
const { logMemberLeave, safely } = require('../lib/logs');
const { inviaArrivederci } = require('../lib/benvenuto');
const { memberHasRepartoRole, scheduleRepartiRefresh } = require('../lib/reparti');

module.exports = {
  name: 'guildMemberRemove',
  execute(member) {
    // Il log parte in parallelo: non deve ritardare il refresh della gerarchia.
    safely('guildMemberRemove', () => logMemberLeave(member));
    // Anche il messaggio di arrivederci va per conto suo.
    safely('arrivederci', () => inviaArrivederci(member));

    // Se chi esce aveva un grado o un ruolo di reparto, togliamolo dalle liste.
    if (memberHasHierarchyRole(member)) scheduleHierarchyRefresh(member.guild);
    if (memberHasRepartoRole(member)) scheduleRepartiRefresh(member.guild);
  },
};
