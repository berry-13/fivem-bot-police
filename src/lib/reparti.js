'use strict';

const fs = require('fs');
const path = require('path');

const config = require('../config/reparti');
const { ensureMembersCached, membersWithRole, splitContent, SEND_OPTIONS } = require('./gerarchia');

// Id dei messaggi pubblicati, per poterli rieditare dopo un riavvio.
// Forma: { [guildId]: { [boardKey]: { channelId, messageIds: string[] } } }
const DEFAULT_PATH = path.join(process.cwd(), 'data', 'reparti.json');
const REFRESH_DEBOUNCE_MS = 2500;
// "Unknown Message": il messaggio salvato e' stato cancellato a mano.
const MESSAGGIO_SCONOSCIUTO = 10008;

function resolveStorePath(customPath) {
  return customPath || process.env.REPARTI_STORE_PATH || DEFAULT_PATH;
}

function loadStore(storePath) {
  const filePath = resolveStorePath(storePath);
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (data && typeof data === 'object' && !Array.isArray(data)) return data;
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn(`Store reparti illeggibile (${filePath}): ${error.message}`);
  }
  return {};
}

function saveBoard(guildId, key, board, storePath) {
  const filePath = resolveStorePath(storePath);
  const data = loadStore(storePath);
  data[guildId] = { ...data[guildId], [key]: board };
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(tmpPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function getBoard(guildId, key, storePath) {
  const board = loadStore(storePath)[guildId]?.[key];
  if (board?.channelId && Array.isArray(board.messageIds)) {
    return { channelId: String(board.channelId), messageIds: board.messageIds.map(String) };
  }
  return null;
}

function boardRoleIds(board) {
  return new Set(board.groups.flatMap(g => [...(g.roles ?? []), ...(g.footer ? [g.footer] : [])]).map(String));
}

/** Tutti i ruoli che compaiono in almeno una lista dei reparti. */
function trackedRoleIds(boards = config.boards) {
  return new Set(boards.flatMap(b => [...boardRoleIds(b)]));
}

function roleLine(guild, roleId, emptyPlaceholder) {
  const ids = membersWithRole(guild, roleId);
  const membri = ids.length ? ids.map(id => `<@${id}>`).join(' ') : emptyPlaceholder;
  return `- <@&${roleId}> ${membri}`;
}

/** Testo della lista, con lo stesso formato dei messaggi fatti a mano. */
function buildRepartoContent(guild, board, options = {}) {
  const { separator = config.separator, emptyPlaceholder = config.emptyPlaceholder } = options;
  const blocks = [];
  if (board.title) blocks.push(board.title, separator);

  board.groups.forEach((group, i) => {
    // Un gruppo puo' avere solo il ruolo di reparto (es. Brevetto EMS).
    if (group.roles?.length) {
      blocks.push(group.roles.map(roleId => roleLine(guild, roleId, emptyPlaceholder)).join('\n'));
    }
    if (group.footer) blocks.push(`- <@&${group.footer}>`);
    if (i < board.groups.length - 1) blocks.push(separator);
  });

  return blocks.join('\n\n');
}

async function fetchMessage(channel, id) {
  try {
    return await channel.messages.fetch(id);
  } catch (error) {
    if (error?.code === MESSAGGIO_SCONOSCIUTO) return null;
    throw error;
  }
}

/**
 * Riscrive una lista nel suo canale: edita i messaggi gia' pubblicati, ne
 * aggiunge se il testo e' cresciuto, toglie quelli in avanzo. Se il canale
 * cambia in config si riparte con messaggi nuovi.
 */
async function aggiornaReparto(guild, board, deps = {}) {
  const { storePath } = deps;
  const client = deps.client || guild.client;
  const channel = await client.channels.fetch(board.channelId);
  if (!channel?.isTextBased?.() || channel.guildId !== guild.id) return null;

  await ensureMembersCached(guild);
  const chunks = splitContent(buildRepartoContent(guild, board));

  const salvato = getBoard(guild.id, board.key, storePath);
  const vecchi = salvato?.channelId === channel.id ? salvato.messageIds : [];

  const ids = [];
  for (let i = 0; i < chunks.length; i++) {
    const esistente = vecchi[i] ? await fetchMessage(channel, vecchi[i]) : null;
    if (esistente) {
      if (esistente.content !== chunks[i]) await esistente.edit({ content: chunks[i], ...SEND_OPTIONS });
      ids.push(esistente.id);
    } else {
      const nuovo = await channel.send({ content: chunks[i], ...SEND_OPTIONS });
      ids.push(nuovo.id);
    }
  }
  for (const id of vecchi.slice(chunks.length)) {
    const msg = await fetchMessage(channel, id);
    if (msg) await msg.delete().catch(() => {});
  }

  saveBoard(guild.id, board.key, { channelId: channel.id, messageIds: ids }, storePath);
  return ids;
}

// Un aggiornamento alla volta per server, cosi' due refresh di fila non
// pubblicano due copie della stessa lista.
const code = new Map();

function refreshReparti(guild, deps = {}) {
  const boards = deps.boards ?? config.boards;
  const precedente = code.get(guild.id) ?? Promise.resolve();
  const prossimo = precedente
    .catch(() => {})
    .then(async () => {
      for (const board of boards) {
        try {
          await aggiornaReparto(guild, board, deps);
        } catch (error) {
          console.error(`Lista reparti "${board.key}" non aggiornata (${guild.id}): ${error.message}`);
        }
      }
    });
  code.set(guild.id, prossimo);
  return prossimo;
}

const pending = new Map();

/** Refresh con debounce: una raffica di cambi ruolo produce un solo edit. */
function scheduleRepartiRefresh(guild, deps = {}) {
  if (!guild?.id) return;
  clearTimeout(pending.get(guild.id));
  const timer = setTimeout(() => {
    pending.delete(guild.id);
    refreshReparti(guild, deps);
  }, deps.debounceMs ?? REFRESH_DEBOUNCE_MS);
  if (typeof timer.unref === 'function') timer.unref();
  pending.set(guild.id, timer);
}

function repartiRolesChanged(oldMember, newMember, boards) {
  const before = oldMember?.roles?.cache;
  const after = newMember?.roles?.cache;
  for (const roleId of trackedRoleIds(boards)) {
    if (Boolean(before?.has(roleId)) !== Boolean(after?.has(roleId))) return true;
  }
  return false;
}

function memberHasRepartoRole(member, boards) {
  const tracked = trackedRoleIds(boards);
  return Boolean(member?.roles?.cache?.some(role => tracked.has(role.id)));
}

/** Solo per i test. */
function _resetReparti() {
  for (const timer of pending.values()) clearTimeout(timer);
  pending.clear();
  code.clear();
}

module.exports = {
  DEFAULT_PATH,
  _resetReparti,
  buildRepartoContent,
  getBoard,
  memberHasRepartoRole,
  refreshReparti,
  repartiRolesChanged,
  scheduleRepartiRefresh,
  trackedRoleIds,
};
