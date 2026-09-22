'use strict';

const fs = require('fs');
const path = require('path');

// Canali di log per server, su disco per sopravvivere ai restart.
// Forma: { [guildId]: { canali: { [tipo]: channelId }, categoriaId?: string } }
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
  // Scrittura atomica: un file troncato a meta' (disco pieno, processo ucciso)
  // verrebbe letto come store vuoto e spegnerebbe tutti i log in silenzio.
  // Il rename nella stessa cartella sostituisce il file in un colpo solo.
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmpPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    fs.renameSync(tmpPath, filePath);
  } catch (error) {
    fs.rmSync(tmpPath, { force: true });
    throw error;
  }
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

/** Categoria creata da /setup-log crea: l'unica che crea puo' riusare e modificare. */
function getCategoryId(guildId, storePath) {
  return loadStore(storePath)[guildId]?.categoriaId ?? null;
}

function setCategoryId(guildId, categoriaId, storePath) {
  const store = loadStore(storePath);
  saveStore({ ...store, [guildId]: { ...store[guildId], categoriaId: String(categoriaId) } }, storePath);
}

function _resetCache() {
  cache = null;
  cachePath = null;
}

module.exports = {
  DEFAULT_PATH,
  getCategoryId,
  getChannelId,
  getChannels,
  loadStore,
  removeChannel,
  resolveStorePath,
  setCategoryId,
  setChannel,
  _resetCache,
};
