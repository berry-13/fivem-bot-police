'use strict';

const fs = require('fs');
const path = require('path');

// Persistenza minima su disco: sopravvive ai restart del bot.
// Forma: { [guildId]: { channelId, messageIds: string[] } }
const DEFAULT_PATH = path.join(process.cwd(), 'data', 'gerarchia.json');

function resolveStorePath(customPath) {
  return customPath || process.env.GERARCHIA_STORE_PATH || DEFAULT_PATH;
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function loadStore(storePath) {
  const filePath = resolveStorePath(storePath);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (data && typeof data === 'object' && !Array.isArray(data)) return data;
  } catch (error) {
    // File assente o corrotto: ripartiamo da zero invece di far crashare il bot.
    if (error.code !== 'ENOENT') {
      console.warn(`Store gerarchia illeggibile (${filePath}): ${error.message}`);
    }
  }
  return {};
}

function saveStore(data, storePath) {
  const filePath = resolveStorePath(storePath);
  ensureDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function getBoard(guildId, storePath) {
  const store = loadStore(storePath);
  const board = store[guildId];
  if (!board?.channelId || !Array.isArray(board.messageIds)) return null;
  return {
    channelId: board.channelId,
    messageIds: board.messageIds.map(String),
  };
}

function setBoard(guildId, board, storePath) {
  const store = loadStore(storePath);
  store[guildId] = {
    channelId: String(board.channelId),
    messageIds: (board.messageIds || []).map(String),
  };
  saveStore(store, storePath);
  return store[guildId];
}

function clearBoard(guildId, storePath) {
  const store = loadStore(storePath);
  if (!(guildId in store)) return false;
  delete store[guildId];
  saveStore(store, storePath);
  return true;
}

module.exports = {
  DEFAULT_PATH,
  clearBoard,
  getBoard,
  loadStore,
  resolveStorePath,
  setBoard,
};
