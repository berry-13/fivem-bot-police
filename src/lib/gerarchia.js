'use strict';

const config = require('../config/gerarchia');
const store = require('./gerarchia-store');

// Discord taglia i messaggi a 2000 caratteri.
const DISCORD_CONTENT_LIMIT = 2000;

// Evita raffiche di edit se qualcuno assegna/toglie piu' ruoli di fila.
const REFRESH_DEBOUNCE_MS = 2500;

const pendingRefresh = new Map();

// Un solo Request Guild Members (opcode 8) per guild alla volta: due fetch
// ravvicinati (ready + refresh, o doppio role update) fanno scattare il
// GatewayRateLimitError.
const inflightMemberFetches = new Map();

const SEND_OPTIONS = { allowedMentions: { parse: [] } };

function isGatewayMembersRateLimit(error) {
  if (!error) return false;
  if (error.name === 'GatewayRateLimitError') return true;
  // discord.js a volte espone solo data/opcode
  return error.data?.opcode === 8 && typeof error.data?.retry_after === 'number';
}

/**
 * True se la cache locale copre gia' tutti i membri del server: in quel caso
 * un altro members.fetch() e' solo un rate limit gratis.
 */
function isMembersCacheComplete(guild) {
  const cached = guild.members?.cache?.size ?? 0;
  const total = guild.memberCount;
  if (typeof total === 'number' && total > 0) {
    return cached >= total;
  }
  return false;
}

/**
 * Assicura che i membri siano in cache. Se sono gia' tutti presenti non
 * tocca il gateway. Se c'e' un fetch in corso lo riutilizza. Se Discord
 * rate-limita l'opcode 8 e abbiamo almeno qualcuno in cache, usa quello.
 */
function ensureMembersCached(guild, { force = false } = {}) {
  if (!guild?.members?.fetch) {
    return Promise.resolve(guild?.members?.cache ?? null);
  }

  if (!force && isMembersCacheComplete(guild)) {
    return Promise.resolve(guild.members.cache);
  }

  const guildId = guild.id ?? 'unknown';
  const existing = inflightMemberFetches.get(guildId);
  if (existing) return existing;

  const promise = (async () => {
    try {
      return await guild.members.fetch();
    } catch (error) {
      if (isGatewayMembersRateLimit(error)) {
        const cached = guild.members.cache?.size ?? 0;
        if (cached > 0) {
          const wait = error.data?.retry_after ?? '?';
          console.warn(
            `Request Guild Members in rate limit per ${guild.name || guildId} ` +
              `(retry after ${wait}s): uso la cache locale (${cached} membri).`,
          );
          return guild.members.cache;
        }
      }
      throw error;
    } finally {
      inflightMemberFetches.delete(guildId);
    }
  })();

  inflightMemberFetches.set(guildId, promise);
  return promise;
}

/**
 * Tutti i ruoli che compaiono nella gerarchia (gradi + footer).
 */
function hierarchyRoleIds(options = {}) {
  const groups = options.groups ?? config.groups;
  const footerRoles = options.footerRoles ?? config.footerRoles ?? [];
  return new Set([...groups.flat(), ...footerRoles].map(String));
}

function roleIdSet(member) {
  const cache = member?.roles?.cache;
  if (!cache) return new Set();
  return new Set(cache.keys());
}

/**
 * True se tra old e new e' cambiato almeno un ruolo della gerarchia.
 */
function hierarchyRolesChanged(oldMember, newMember, options = {}) {
  const tracked = hierarchyRoleIds(options);
  const before = roleIdSet(oldMember);
  const after = roleIdSet(newMember);

  for (const roleId of tracked) {
    if (before.has(roleId) !== after.has(roleId)) return true;
  }
  return false;
}

function memberHasHierarchyRole(member, options = {}) {
  if (!member?.roles?.cache) return false;
  const tracked = hierarchyRoleIds(options);
  return member.roles.cache.some(role => tracked.has(role.id));
}

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
 * Assicura la cache membri (senza rifetch inutili) e costruisce i pezzi
 * di messaggio da inviare.
 */
async function buildHierarchyMessages(guild, options = {}) {
  // Con l'intent GuildMembers, dopo il preload a ready e dopo guildMemberUpdate
  // la cache e' gia' aggiornata: un fetch a ogni refresh prende solo rate limit.
  await ensureMembersCached(guild);

  const content = buildHierarchyContent(guild, options);
  return splitContent(content);
}

/**
 * Tenta di cancellare i messaggi della gerarchia salvata (best effort).
 */
async function deleteStoredMessages(client, guildId, storePath) {
  const board = store.getBoard(guildId, storePath);
  if (!board) return;

  let channel;
  try {
    channel = await client.channels.fetch(board.channelId);
  } catch {
    return;
  }
  if (!channel?.messages) return;

  for (const messageId of board.messageIds) {
    try {
      const message = await channel.messages.fetch(messageId);
      await message.delete();
    } catch {
      // Messaggio gia' cancellato o canale non accessibile: ok.
    }
  }
}

/**
 * Invia la gerarchia in un canale e salva channelId + messageIds per gli
 * aggiornamenti automatici. Se esisteva una board precedente, la cancella.
 * Fetch membri e cancellazione messaggi vecchi partono in parallelo per
 * restare dentro la finestra di risposta di Discord.
 */
async function publishHierarchy(channel, guild, { client, storePath, options } = {}) {
  const guildId = guild.id;

  const chunksPromise = buildHierarchyMessages(guild, options);
  const deletePromise =
    client && guildId
      ? deleteStoredMessages(client, guildId, storePath)
      : Promise.resolve();

  const [chunks] = await Promise.all([chunksPromise, deletePromise]);
  const messageIds = [];

  for (const content of chunks) {
    const message = await channel.send({ content, ...SEND_OPTIONS });
    messageIds.push(message.id);
  }

  if (guildId) {
    store.setBoard(guildId, { channelId: channel.id, messageIds }, storePath);
  }

  return { chunks, messageIds };
}

/**
 * Riedita i messaggi salvati (o ne manda di nuovi se il numero di pezzi cambia).
 * Se non c'e' una board salvata non fa nulla.
 */
async function refreshHierarchy(guild, { client, storePath, options } = {}) {
  const guildId = guild.id;
  const board = store.getBoard(guildId, storePath);
  if (!board) return { updated: false, reason: 'no-board' };

  const resolvedClient = client || guild.client;
  let channel;
  try {
    channel = await resolvedClient.channels.fetch(board.channelId);
  } catch (error) {
    console.warn(`Canale gerarchia non trovato per guild ${guildId}: ${error.message}`);
    return { updated: false, reason: 'channel-missing' };
  }

  if (!channel?.messages) {
    return { updated: false, reason: 'channel-missing' };
  }

  const chunks = await buildHierarchyMessages(guild, options);
  const messageIds = [...board.messageIds];
  const nextIds = [];

  for (let i = 0; i < chunks.length; i++) {
    const content = chunks[i];
    const existingId = messageIds[i];

    if (existingId) {
      try {
        const message = await channel.messages.fetch(existingId);
        await message.edit({ content, ...SEND_OPTIONS });
        nextIds.push(existingId);
        continue;
      } catch {
        // Messaggio sparito: ne mandiamo uno nuovo sotto.
      }
    }

    const created = await channel.send({ content, ...SEND_OPTIONS });
    nextIds.push(created.id);
  }

  // Pezzi in piu' rispetto a prima: elimina i messaggi residui.
  for (let i = chunks.length; i < messageIds.length; i++) {
    try {
      const message = await channel.messages.fetch(messageIds[i]);
      await message.delete();
    } catch {
      // gia' andato
    }
  }

  store.setBoard(guildId, { channelId: channel.id, messageIds: nextIds }, storePath);
  return { updated: true, messageIds: nextIds };
}

/**
 * Programma un refresh debounced per il guild. Utile su raffiche di role update.
 */
function scheduleHierarchyRefresh(guild, deps = {}) {
  const guildId = guild?.id;
  if (!guildId) return;

  const delay = deps.debounceMs ?? REFRESH_DEBOUNCE_MS;
  const existing = pendingRefresh.get(guildId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    pendingRefresh.delete(guildId);
    refreshHierarchy(guild, deps).catch(error => {
      console.error(`Refresh gerarchia fallito per guild ${guildId}:`, error);
    });
  }, delay);

  // Node non deve restare vivo solo per questo timer.
  if (typeof timer.unref === 'function') timer.unref();

  pendingRefresh.set(guildId, timer);
}

/** Solo per i test: svuota i timer pendenti. */
function _resetRefreshTimers() {
  for (const timer of pendingRefresh.values()) clearTimeout(timer);
  pendingRefresh.clear();
}

/** Solo per i test. */
function _resetInflightFetches() {
  inflightMemberFetches.clear();
}

module.exports = {
  DISCORD_CONTENT_LIMIT,
  REFRESH_DEBOUNCE_MS,
  SEND_OPTIONS,
  _resetInflightFetches,
  _resetRefreshTimers,
  buildHierarchyContent,
  buildHierarchyMessages,
  deleteStoredMessages,
  ensureMembersCached,
  formatRoleLine,
  hierarchyRoleIds,
  hierarchyRolesChanged,
  isMembersCacheComplete,
  memberHasHierarchyRole,
  membersWithRole,
  publishHierarchy,
  refreshHierarchy,
  scheduleHierarchyRefresh,
  splitContent,
};
