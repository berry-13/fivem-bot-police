'use strict';

const fs = require('fs');
const path = require('path');

const liveConfig = require('../config/live');

// Persistenza della lista streamer: `src/config/live.js` e' solo il seed del
// primo avvio, da lì in poi la lista si modifica con /live e sopravvive ai
// restart. Forma su disco: { streamers: [{ platform, id, displayName? }] }
const DEFAULT_PATH = path.join(process.cwd(), 'data', 'live.json');

// Ogni account aggiunto e' una chiamata HTTP in piu' a ogni giro di polling:
// il tetto evita che una lista fuori controllo mandi il loop fuori tempo.
const MAX_STREAMERS = 50;
const MAX_DISPLAY_NAME = 60;

const PLATFORMS = {
  twitch: {
    label: 'Twitch',
    idPattern: /^[a-z0-9_]{4,25}$/,
    idHint: '4-25 caratteri tra lettere, numeri e underscore',
    profileUrl: id => `https://www.twitch.tv/${id}`,
  },
  tiktok: {
    label: 'TikTok',
    idPattern: /^[a-z0-9_.]{2,24}$/,
    idHint: '2-24 caratteri tra lettere, numeri, punto e underscore',
    profileUrl: id => `https://www.tiktok.com/@${id}`,
  },
  kick: {
    label: 'Kick',
    idPattern: /^[a-z0-9_-]{3,25}$/,
    idHint: '3-25 caratteri tra lettere, numeri, trattino e underscore',
    profileUrl: id => `https://kick.com/${id}`,
  },
};

// Accettiamo anche il link incollato al posto dello username: e' quello che
// un admin ha sotto mano quando apre il canale dello streamer.
const PLATFORM_URL_RE = /^(?:[a-z]+:\/\/)?(?:[\w-]+\.)*(?:twitch\.tv|tiktok\.com|kick\.com)\//i;
const URL_NOISE_SEGMENTS = new Set([
  'about',
  'channel',
  'clips',
  'live',
  'schedule',
  'streams',
  'video',
  'videos',
]);

function resolveStorePath(customPath) {
  return customPath || process.env.LIVE_STORE_PATH || DEFAULT_PATH;
}

/**
 * Chiave stabile per lo stato live di uno streamer.
 * @param {{ platform: string, id: string }} streamer
 */
function streamerKey(streamer) {
  return `${String(streamer.platform).toLowerCase()}:${String(streamer.id).toLowerCase()}`;
}

function normalizePlatform(value) {
  const platform = String(value ?? '')
    .trim()
    .toLowerCase();
  return Object.hasOwn(PLATFORMS, platform) ? platform : null;
}

/**
 * Ricava lo username da uno username, un @handle o un link alla piattaforma.
 * Non valida la forma: ci pensa normalizeAccountId col pattern giusto.
 * @param {unknown} raw
 * @returns {string} username minuscolo, o '' se non estraibile
 */
function extractAccountId(raw) {
  // Discord manda i link tra < > quando l'utente sopprime l'anteprima.
  let value = String(raw ?? '')
    .trim()
    .replace(/^<+/, '')
    .replace(/>+$/, '')
    .trim();

  // Via query string e fragment: /salvinosalvo?sr=a resta salvinosalvo.
  value = value.split(/[?#]/)[0].trim();
  if (!value) return '';

  if (PLATFORM_URL_RE.test(value)) {
    const segments = value
      .replace(/^[a-z]+:\/\//i, '')
      .split('/')
      // Fuori l'host: restano solo i pezzi di path.
      .slice(1)
      .map(segment => segment.trim())
      .filter(Boolean);

    // Su TikTok l'handle e' il segmento con la chiocciola, altrove e' il primo
    // che non sia una sezione del sito (/live, /videos, ...).
    const handle =
      segments.find(segment => segment.startsWith('@')) ??
      segments.find(segment => !URL_NOISE_SEGMENTS.has(segment.toLowerCase()));
    value = handle ?? '';
  } else if (value.includes('/')) {
    // Un path di un dominio che non monitoriamo: meglio rifiutare che
    // indovinare un pezzo qualunque dell'url.
    return '';
  }

  return value.replace(/^@+/, '').toLowerCase();
}

function normalizeAccountId(platform, raw) {
  const id = extractAccountId(raw);
  if (!id) return null;
  return PLATFORMS[platform].idPattern.test(id) ? id : null;
}

function normalizeDisplayName(raw) {
  const name = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_DISPLAY_NAME);
  return name || null;
}

/**
 * Valida e normalizza una voce della lista.
 * @param {{ platform?: unknown, id?: unknown, displayName?: unknown }} input
 * @returns {{ ok: true, streamer: { platform: string, id: string, displayName?: string } }
 *   | { ok: false, reason: 'platform' | 'id', platform?: string }}
 */
function normalizeStreamer(input) {
  const platform = normalizePlatform(input?.platform);
  if (!platform) return { ok: false, reason: 'platform' };

  const id = normalizeAccountId(platform, input?.id);
  if (!id) return { ok: false, reason: 'id', platform };

  const displayName = normalizeDisplayName(input?.displayName);
  const streamer = displayName ? { platform, id, displayName } : { platform, id };
  return { ok: true, streamer };
}

function normalizeList(rawList) {
  const seen = new Set();
  const streamers = [];
  let skipped = 0;

  for (const raw of Array.isArray(rawList) ? rawList : []) {
    const result = normalizeStreamer(raw);
    if (!result.ok) {
      skipped += 1;
      continue;
    }

    const key = streamerKey(result.streamer);
    if (seen.has(key)) continue;
    seen.add(key);
    streamers.push(result.streamer);
  }

  return { streamers: streamers.slice(0, MAX_STREAMERS), skipped };
}

function seedFromConfig() {
  const { streamers, skipped } = normalizeList(liveConfig.streamers);
  if (skipped > 0) {
    console.warn(`Store live: ${skipped} streamer di src/config/live.js scartati (piattaforma o username non validi).`);
  }
  return streamers;
}

/**
 * Legge la lista dal disco. `seeded` segnala che il file non c'era (o era
 * illeggibile) e la lista arriva dal config.
 * @param {string} [storePath]
 */
function loadStreamers(storePath) {
  const filePath = resolveStorePath(storePath);

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (Array.isArray(data?.streamers)) {
      return { streamers: normalizeList(data.streamers).streamers, seeded: false };
    }
    console.warn(`Store live malformato (${filePath}): manca l'array "streamers", riparto dal config.`);
  } catch (error) {
    // File assente al primo avvio o JSON rotto: ripartiamo dal seed invece di
    // spegnere le notifiche.
    if (error.code !== 'ENOENT') {
      console.warn(`Store live illeggibile (${filePath}): ${error.message}`);
    }
  }

  return { streamers: seedFromConfig(), seeded: true };
}

function saveStreamers(streamers, storePath) {
  const filePath = resolveStorePath(storePath);
  const body = { streamers: normalizeList(streamers).streamers };

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
    return true;
  } catch (error) {
    console.error(`Store live: scrittura fallita (${filePath}): ${error.message}`);
    return false;
  }
}

/**
 * Lista corrente. Al primo avvio fissa il seed su disco: senza questo passo
 * una rimozione tornerebbe indietro al riavvio successivo.
 * @param {string} [storePath]
 */
function listStreamers(storePath) {
  const { streamers, seeded } = loadStreamers(storePath);
  if (seeded) saveStreamers(streamers, storePath);
  return streamers;
}

/**
 * @param {{ platform?: unknown, id?: unknown, displayName?: unknown }} input
 * @param {string} [storePath]
 * @returns {{ ok: true, streamer: object, total: number }
 *   | { ok: false, reason: 'platform' | 'id' | 'duplicate' | 'limit' | 'io', platform?: string, streamer?: object, limit?: number }}
 */
function addStreamer(input, storePath) {
  const normalized = normalizeStreamer(input);
  if (!normalized.ok) return normalized;

  const streamers = listStreamers(storePath);
  const key = streamerKey(normalized.streamer);
  const existing = streamers.find(streamer => streamerKey(streamer) === key);
  if (existing) return { ok: false, reason: 'duplicate', streamer: existing };
  if (streamers.length >= MAX_STREAMERS) return { ok: false, reason: 'limit', limit: MAX_STREAMERS };

  const next = [...streamers, normalized.streamer];
  if (!saveStreamers(next, storePath)) return { ok: false, reason: 'io' };
  return { ok: true, streamer: normalized.streamer, total: next.length };
}

/**
 * @param {{ platform?: unknown, id?: unknown }} input
 * @param {string} [storePath]
 * @returns {{ ok: true, streamer: object, total: number }
 *   | { ok: false, reason: 'platform' | 'id' | 'missing' | 'io' }}
 */
function removeStreamer(input, storePath) {
  const platform = normalizePlatform(input?.platform);
  if (!platform) return { ok: false, reason: 'platform' };

  // Qui non applichiamo idPattern: se una voce e' finita nello store deve
  // poter uscire anche se oggi non passerebbe la validazione.
  const id = extractAccountId(input?.id);
  if (!id) return { ok: false, reason: 'id' };

  const streamers = listStreamers(storePath);
  const key = `${platform}:${id}`;
  const found = streamers.find(streamer => streamerKey(streamer) === key);
  if (!found) return { ok: false, reason: 'missing' };

  const next = streamers.filter(streamer => streamerKey(streamer) !== key);
  if (!saveStreamers(next, storePath)) return { ok: false, reason: 'io' };
  return { ok: true, streamer: found, total: next.length };
}

/**
 * Cerca nella lista. Accetta il valore dell'autocomplete
 * ("piattaforma:account"), uno username, un link o un pezzo di nome.
 * Funzione pura: la lista arriva da chi chiama.
 * @param {Array<{ platform: string, id: string, displayName?: string }>} streamers
 * @param {unknown} query
 */
function matchStreamers(streamers, query) {
  const raw = String(query ?? '')
    .trim()
    .toLowerCase();
  if (!raw) return [...streamers];

  const separator = raw.indexOf(':');
  if (separator > 0) {
    const platform = normalizePlatform(raw.slice(0, separator));
    const id = extractAccountId(raw.slice(separator + 1));
    if (platform && id) {
      return streamers.filter(streamer => streamerKey(streamer) === `${platform}:${id}`);
    }
  }

  const needle = extractAccountId(raw) || raw;
  const exact = streamers.filter(streamer => streamer.id === needle);
  if (exact.length > 0) return exact;

  return streamers.filter(streamer => {
    const label = PLATFORMS[streamer.platform]?.label.toLowerCase() ?? streamer.platform;
    return (
      streamer.id.includes(needle) ||
      (streamer.displayName ?? '').toLowerCase().includes(needle) ||
      label.includes(needle)
    );
  });
}

function platformLabel(platform) {
  return PLATFORMS[platform]?.label ?? String(platform);
}

function profileUrl(streamer) {
  return PLATFORMS[streamer?.platform]?.profileUrl(streamer.id) ?? null;
}

module.exports = {
  DEFAULT_PATH,
  MAX_DISPLAY_NAME,
  MAX_STREAMERS,
  PLATFORMS,
  addStreamer,
  extractAccountId,
  listStreamers,
  loadStreamers,
  matchStreamers,
  normalizeStreamer,
  platformLabel,
  profileUrl,
  removeStreamer,
  resolveStorePath,
  saveStreamers,
  streamerKey,
};
