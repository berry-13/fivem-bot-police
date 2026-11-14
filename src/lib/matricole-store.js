'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const config = require('../config/matricole');

// Matricole assegnate, per server. Un numero, una volta dato, non torna mai in
// circolo: chi lo ha avuto se lo tiene e nessun altro puo' riceverlo.
// Forma su disco: { [guildId]: { [userId]: "1234" } }
const DEFAULT_PATH = path.join(process.cwd(), 'data', 'matricole.json');

function resolveStorePath(customPath) {
  return customPath || process.env.MATRICOLE_STORE_PATH || DEFAULT_PATH;
}

function loadStore(storePath) {
  const filePath = resolveStorePath(storePath);
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (data && typeof data === 'object' && !Array.isArray(data)) return data;
    console.warn(`Store matricole malformato (${filePath}).`);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      // Meglio fermarsi che ripartire da vuoto: assegneremmo numeri gia' dati.
      throw new Error(`Store matricole illeggibile (${filePath}): ${error.message}`, { cause: error });
    }
  }
  return {};
}

// Scrittura atomica (temporaneo + rename): un JSON troncato farebbe perdere
// l'elenco e quindi la garanzia che i numeri non si ripetano.
function saveStore(data, storePath) {
  const filePath = resolveStorePath(storePath);
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(tmpPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function normalizzaNumero(raw) {
  const value = String(raw ?? '').trim().replace(/^#/, '');
  return /^\d{4}$/.test(value) ? value : null;
}

/** Matricola di un utente, o null. */
function getByUser(guildId, userId, storePath) {
  return loadStore(storePath)[guildId]?.[userId] ?? null;
}

/** Utente che ha quella matricola, o null. */
function getByNumber(guildId, numero, storePath) {
  const value = normalizzaNumero(numero);
  if (!value) return null;
  const elenco = loadStore(storePath)[guildId] ?? {};
  const trovato = Object.entries(elenco).find(([, n]) => n === value);
  return trovato ? trovato[0] : null;
}

/**
 * Assegna una matricola casuale mai usata nel server. Se l'utente ne ha gia'
 * una non la cambia e la restituisce con `existing: true`.
 * Tutto sincrono: due comandi in contemporanea non possono pescare lo stesso
 * numero, perche' Node esegue una funzione sincrona per intero.
 * @returns {{ ok: true, numero: string, existing: boolean } | { ok: false, reason: 'full' }}
 */
function assign(guildId, userId, storePath, random = crypto.randomInt) {
  const store = loadStore(storePath);
  const elenco = store[guildId] ?? {};

  if (elenco[userId]) return { ok: true, numero: elenco[userId], existing: true };

  const usati = new Set(Object.values(elenco));
  const totale = config.max - config.min + 1;
  if (usati.size >= totale) return { ok: false, reason: 'full' };

  // Si pesca a caso tra i soli numeri liberi: niente tentativi a vuoto anche
  // quando l'elenco e' quasi pieno.
  const liberi = [];
  for (let n = config.min; n <= config.max; n++) {
    const s = String(n);
    if (!usati.has(s)) liberi.push(s);
  }
  const numero = liberi[random(liberi.length)];

  store[guildId] = { ...elenco, [userId]: numero };
  saveStore(store, storePath);
  return { ok: true, numero, existing: false };
}

module.exports = {
  DEFAULT_PATH,
  assign,
  getByNumber,
  getByUser,
  loadStore,
  normalizzaNumero,
  resolveStorePath,
};

// Id dei messaggi dell'elenco pubblico, in un file a parte cosi' la forma di
// matricole.json resta { [guildId]: { [userId]: numero } }.
// Forma: { [guildId]: { channelId, messageIds: string[] } }
const BOARD_DEFAULT_PATH = path.join(process.cwd(), 'data', 'matricole-board.json');

function resolveBoardPath(customPath) {
  return customPath || process.env.MATRICOLE_BOARD_PATH || BOARD_DEFAULT_PATH;
}

function getBoard(guildId, boardPath) {
  try {
    const data = JSON.parse(fs.readFileSync(resolveBoardPath(boardPath), 'utf8'));
    const board = data?.[guildId];
    if (board?.channelId && Array.isArray(board.messageIds)) {
      return { channelId: String(board.channelId), messageIds: board.messageIds.map(String) };
    }
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn(`Board matricole illeggibile: ${error.message}`);
  }
  return null;
}

function setBoard(guildId, board, boardPath) {
  const filePath = resolveBoardPath(boardPath);
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8')) || {};
  } catch {
    // Assente o rotto: lo riscriviamo, perdiamo solo gli id dei messaggi.
  }
  data[guildId] = { channelId: String(board.channelId), messageIds: board.messageIds.map(String) };
  saveStore(data, filePath);
}

module.exports.getBoard = getBoard;
module.exports.setBoard = setBoard;
module.exports.BOARD_DEFAULT_PATH = BOARD_DEFAULT_PATH;
