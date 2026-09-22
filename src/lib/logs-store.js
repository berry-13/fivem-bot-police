'use strict';

const fs = require('fs');
const path = require('path');

// Canali di log per server, su disco per sopravvivere ai restart.
// Forma: { [guildId]: { canali: { [tipo]: channelId } } }
const DEFAULT_PATH = path.join(process.cwd(), 'data', 'logs.json');

// Lo store viene letto a ogni evento loggato (ogni messaggio eliminato, ogni
// ingresso in voce): teniamo in memoria l'ultima lettura invece di rileggere il
// file ogni volta. Tutte le scritture passano da qui, quindi resta coerente.
let cache = null;
let cachePath = null;

function resolveStorePath(customPath) {
  return customPath || process.env.LOGS_STORE_PATH || DEFAULT_PATH;
}

function loadStore(storePath) {
  const filePath = resolveStorePath(storePath);
  if (cache && cachePath === filePath) return cache;

  let data = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed;
  } catch (error) {
    // File assente o corrotto: log spenti invece di un bot che non parte.
    if (error.code !== 'ENOENT') {
      console.warn(`Store log illeggibile (${filePath}): ${error.message}`);
    }
  }

  cache = data;
  cachePath = filePath;
  return cache;
}

function saveStore(data, storePath) {
  const filePath = resolveStorePath(storePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  cache = data;
  cachePath = filePath;
}

function getChannels(guildId, storePath) {
  const canali = loadStore(storePath)[guildId]?.canali;
  return canali && typeof canali === 'object' ? { ...canali } : {};
}

function getChannelId(guildId, tipo, storePath) {
  return getChannels(guildId, storePath)[tipo] ?? null;
}

function setChannel(guildId, tipo, channelId, storePath) {
  const store = loadStore(storePath);
  const canali = { ...getChannels(guildId, storePath), [tipo]: String(channelId) };
  saveStore({ ...store, [guildId]: { ...store[guildId], canali } }, storePath);
  return canali;
}

function removeChannel(guildId, tipo, storePath) {
  const store = loadStore(storePath);
  const canali = getChannels(guildId, storePath);
  if (!(tipo in canali)) return false;
  delete canali[tipo];
  saveStore({ ...store, [guildId]: { ...store[guildId], canali } }, storePath);
  return true;
}

function _resetCache() {
  cache = null;
  cachePath = null;
}

module.exports = {
  DEFAULT_PATH,
  getChannelId,
  getChannels,
  loadStore,
  removeChannel,
  resolveStorePath,
  setChannel,
  _resetCache,
};
