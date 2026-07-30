'use strict';

const config = require('../config/gerarchia');

// Discord taglia i messaggi a 2000 caratteri.
const DISCORD_CONTENT_LIMIT = 2000;

/**
 * Restituisce gli ID dei membri umani che hanno il ruolo (niente bot).
 * Si affida alla cache popolata da guild.members.fetch().
 */
function membersWithRole(guild, roleId) {
  const role = guild.roles.cache.get(roleId);
  if (!role) return [];

  return [...role.members.values()]
    .filter(member => !member.user?.bot)
    .map(member => member.id);
}

function formatRoleLine(roleId, memberIds, emptyPlaceholder = config.emptyPlaceholder) {
  const roleMention = `<@&${roleId}>`;
  if (memberIds.length === 0) {
    return `${roleMention} ${emptyPlaceholder}`;
  }
  const pings = memberIds.map(id => `<@${id}>`).join(' ');
  return `${roleMention} ${pings}`;
}

/**
 * Costruisce il testo completo della gerarchia a partire dalla config e
 * dai membri del server (gia' in cache).
 */
function buildHierarchyContent(guild, options = {}) {
  const {
    title = config.title,
    separator = config.separator,
    groupSeparator = config.groupSeparator,
    emptyPlaceholder = config.emptyPlaceholder,
    groups = config.groups,
    footerRoles = config.footerRoles,
  } = options;

  const blocks = [];

  if (title) {
    blocks.push(title);
  }

  for (let g = 0; g < groups.length; g++) {
    const group = groups[g];
    const lines = [];

    for (let i = 0; i < group.length; i++) {
      const roleId = group[i];
      const memberIds = membersWithRole(guild, roleId);
      lines.push(formatRoleLine(roleId, memberIds, emptyPlaceholder));

      // Separatore sottile tra i ruoli dello stesso gruppo (anche dopo l'ultimo:
      // cosi' il blocco e' leggibile come nell'esempio del server).
      if (i < group.length - 1) {
        lines.push(separator);
      }
    }

    blocks.push(lines.join('\n'));

    if (g < groups.length - 1) {
      blocks.push(groupSeparator);
    }
  }

  if (footerRoles?.length) {
    const footer = footerRoles.map(roleId => `<@&${roleId}>`).join('\n');
    blocks.push(footer);
  }

  // Blocchi separati da riga vuota: leggibilita' come nell'esempio.
  return blocks.join('\n\n');
}

/**
 * Spezza il testo in pezzi <= 2000 caratteri, preferibilmente sui confini
 * di riga (separatori e fine blocco), cosi' non si taglia a meta' un ping.
 */
function splitContent(content, limit = DISCORD_CONTENT_LIMIT) {
  if (content.length <= limit) return [content];

  const chunks = [];
  const lines = content.split('\n');
  let current = '';

  for (const line of lines) {
    // Riga singola troppo lunga: spezza a forza (caso raro, solo se un
    // ruolo ha centinaia di membri sulla stessa riga).
    if (line.length > limit) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      for (let i = 0; i < line.length; i += limit) {
        chunks.push(line.slice(i, i + limit));
      }
      continue;
    }

    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > limit) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

/**
 * Carica tutti i membri del guild (serve l'intent GuildMembers) e costruisce
 * i pezzi di messaggio da inviare.
 */
async function buildHierarchyMessages(guild, options = {}) {
  // Senza fetch la cache ha solo chi ha parlato di recente: la gerarchia
  // uscirebbe incompleta. Con l'intent abilitato Discord.js popola role.members.
  await guild.members.fetch();

  const content = buildHierarchyContent(guild, options);
  return splitContent(content);
}

module.exports = {
  DISCORD_CONTENT_LIMIT,
  buildHierarchyContent,
  buildHierarchyMessages,
  formatRoleLine,
  membersWithRole,
  splitContent,
};
