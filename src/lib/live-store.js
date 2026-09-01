'use strict';

const fs = require('fs');
const path = require('path');

const liveConfig = require('../config/live');

// Persistenza della lista streamer: `src/config/live.js` e' solo il seed del
// primo avvio, da lì in poi la lista si modifica con /live e sopravvive ai
// restart. Forma su disco: { streamers: [{ platform, id, displayName? }] }
const DEFAULT_PATH = path.join(process.cwd(), 'data', 'live.json');

// Ogni account e' una richiesta in piu' a ogni giro di polling. Il tetto tiene
// la lista in una misura sensata per un server; a contenere la durata del giro
// pensano il limite di richieste in volo e i timeout in src/lib/live.js.
const MAX_STREAMERS = 50;
const MAX_DISPLAY_NAME = 60;

// Accettiamo anche il link incollato al posto dello username: e' quello che un
// admin ha sotto mano quando apre il canale dello streamer. Perche' un link
// valga come account devono valere due cose: host di profilo della piattaforma
// (niente clips.twitch.tv o link accorciati) e path della forma del profilo,
// altrimenti twitch.tv/videos/1234567890 finirebbe in lista come account
// "1234567890" e il bot controllerebbe un canale che non esiste.
const PLATFORMS = {
  twitch: {
    label: 'Twitch',
    idPattern: /^[a-z0-9_]{4,25}$/,
    idHint: '4-25 caratteri tra lettere, numeri e underscore',
    profileUrl: id => `https://www.twitch.tv/${id}`,
    domain: 'twitch.tv',
    profileHosts: new Set(['twitch.tv', 'www.twitch.tv', 'm.twitch.tv']),
    // Prime parti di path che sono sezioni del sito, non canali.
    reservedPaths: new Set([
      'about', 'broadcast', 'clips', 'collections', 'directory', 'downloads',
      'drops', 'event', 'events', 'following', 'followers', 'friends', 'jobs',
      'legal', 'moderator', 'p', 'popout', 'privacy', 'products', 'prime',
      'search', 'settings', 'store', 'subs', 'team', 'teams', 'terms', 'turbo',
      'u', 'video', 'videos', 'wallet',
    ]),
    profileFromPath(segments) {
      const [first] = segments;
      if (!first || first.startsWith('@')) return null;
      return this.reservedPaths.has(first.toLowerCase()) ? null : first;
    },
  },
  tiktok: {
    label: 'TikTok',
    idPattern: /^[a-z0-9_.]{2,24}$/,
    idHint: '2-24 caratteri tra lettere, numeri, punto e underscore',
    profileUrl: id => `https://www.tiktok.com/@${id}`,
    domain: 'tiktok.com',
    profileHosts: new Set(['tiktok.com', 'www.tiktok.com', 'm.tiktok.com']),
    profileFromPath(segments) {
      // Su TikTok il profilo e' sempre /@handle: senza chiocciola e' un video,
      // un tag o una pagina del sito.
      const handle = segments.find(segment => segment.startsWith('@'));
      return handle ? handle.slice(1) : null;
    },
  },
  kick: {
    label: 'Kick',
    idPattern: /^[a-z0-9_-]{3,25}$/,
    idHint: '3-25 caratteri tra lettere, numeri, trattino e underscore',
    profileUrl: id => `https://kick.com/${id}`,
    domain: 'kick.com',
    profileHosts: new Set(['kick.com', 'www.kick.com']),
    reservedPaths: new Set([
      'about', 'browse', 'categories', 'category', 'clip', 'clips', 'dashboard',
      'following', 'help', 'popout', 'privacy', 'search', 'settings',
      'subscriptions', 'terms', 'video', 'videos',
    ]),
    profileFromPath(segments) {
      const [first] = segments;
      if (!first || first.startsWith('@')) return null;
      return this.reservedPaths.has(first.toLowerCase()) ? null : first;
    },
  },
};

// host -> piattaforma, per i soli host di profilo.
const PLATFORM_BY_PROFILE_HOST = new Map(
  Object.entries(PLATFORMS).flatMap(([platform, meta]) =>
    [...meta.profileHosts].map(host => [host, platform]),
  ),
);

// dominio -> piattaforma: serve a riconoscere che un link e' "di Twitch" anche
// quando l'host non e' quello di un profilo (clips.twitch.tv, player....).
const PLATFORM_BY_DOMAIN = new Map(
  Object.entries(PLATFORMS).map(([platform, meta]) => [meta.domain, platform]),
);

const URL_SHAPE_RE = /^(?:[a-z][a-z0-9+.-]*:\/\/)?([a-z0-9._-]+)(\/[^\s]*)?$/i;

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
 * Riconosce il dominio di una piattaforma dentro un host, anche quando l'host
 * non e' quello di un profilo (clips.twitch.tv, player.twitch.tv, ...).
 * @param {string} host
 */
function platformFromHost(host) {
  const diretto = PLATFORM_BY_PROFILE_HOST.get(host);
  if (diretto) return { platform: diretto, profileHost: true };

  for (const [domain, platform] of PLATFORM_BY_DOMAIN) {
    if (host === domain || host.endsWith(`.${domain}`)) {
      return { platform, profileHost: false };
    }
  }

  return { platform: null, profileHost: false };
}

/**
 * Legge uno username, un @handle o un link al canale: torna lo username e, se
 * l'input era un link, la piattaforma di quel link. Un link accettato deve
 * avere host e path della forma del profilo, altrimenti l'id torna vuoto.
 * Non valida la forma dello username: ci pensa normalizeStreamer col pattern
 * della piattaforma.
 * @param {unknown} raw
 * @returns {{ id: string, platform: string | null }} id vuoto se non estraibile
 */
function parseAccountInput(raw) {
  // Discord manda i link tra < > quando l'utente sopprime l'anteprima.
  let value = String(raw ?? '')
    .trim()
    .replace(/^<+/, '')
    .replace(/>+$/, '')
    .trim();

  // Via query string e fragment: /salvinosalvo?sr=a resta salvinosalvo.
  value = value.split(/[?#]/)[0].trim();
  if (!value) return { id: '', platform: null };

  const url = value.match(URL_SHAPE_RE);
  const host = url?.[1].toLowerCase() ?? '';
  const { platform, profileHost } = platformFromHost(host);

  if (platform) {
    // Host della piattaforma senza path di profilo (o host non di profilo):
    // sappiamo di che piattaforma si tratta ma non chi e' il canale.
    if (!profileHost || !url[2]) return { id: '', platform };

    const segments = url[2]
      .split('/')
      .map(segment => segment.trim())
      .filter(Boolean);
    const handle = PLATFORMS[platform].profileFromPath(segments);

    return { id: (handle ?? '').replace(/^@+/, '').toLowerCase(), platform };
  }

  if (value.includes('/')) {
    // Url di un dominio che non monitoriamo: meglio rifiutare che indovinare un
    // pezzo qualunque del path.
    return { id: '', platform: null };
  }

  // Username secco. Il punto resta ammesso: negli handle TikTok e' legittimo.

  return { id: value.replace(/^@+/, '').toLowerCase(), platform: null };
}

function extractAccountId(raw) {
  return parseAccountInput(raw).id;
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
 *   | { ok: false, reason: 'platform' | 'mismatch' | 'id', platform?: string, detected?: string }}
 */
function normalizeStreamer(input) {
  const platform = normalizePlatform(input?.platform);
  if (!platform) return { ok: false, reason: 'platform' };

  const parsed = parseAccountInput(input?.id);

  // Link di un'altra piattaforma: lo username da solo sarebbe pure valido, ma
  // il bot finirebbe a controllare il servizio sbagliato.
  if (parsed.platform && parsed.platform !== platform) {
    return { ok: false, reason: 'mismatch', platform, detected: parsed.platform };
  }

  if (!parsed.id || !PLATFORMS[platform].idPattern.test(parsed.id)) {
    return { ok: false, reason: 'id', platform };
  }

  const displayName = normalizeDisplayName(input?.displayName);
  const streamer = displayName
    ? { platform, id: parsed.id, displayName }
    : { platform, id: parsed.id };
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
  // Scrittura atomica (file temporaneo + rename): un SIGTERM in mezzo a un
  // writeFileSync lascerebbe un JSON troncato e al riavvio la lista tornerebbe
  // al seed del config, buttando via gli account aggiunti a mano.
  const tmpPath = `${filePath}.${process.pid}.tmp`;

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(tmpPath, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
    fs.renameSync(tmpPath, filePath);
    return true;
  } catch (error) {
    console.error(`Store live: scrittura fallita (${filePath}): ${error.message}`);
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // Il temporaneo può non esistere: niente da ripulire.
    }
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
 * Risolve un account in modo **esatto**: valore dell'autocomplete
 * ("piattaforma:username"), username preciso o link del canale. Serve alle
 * operazioni distruttive, dove un match parziale rimuoverebbe l'account
 * sbagliato senza che nessuno l'abbia chiesto.
 * Funzione pura: la lista arriva da chi chiama.
 * @param {Array<{ platform: string, id: string, displayName?: string }>} streamers
 * @param {unknown} query
 */
function resolveStreamers(streamers, query) {
  const raw = String(query ?? '')
    .trim()
    .toLowerCase();
  if (!raw) return [];

  const separator = raw.indexOf(':');
  if (separator > 0) {
    const platform = normalizePlatform(raw.slice(0, separator));
    // Attenzione: in "https://..." i due punti non separano la piattaforma,
    // quindi si prosegue solo se il pezzo davanti e' una piattaforma vera.
    if (platform) {
      const { id } = parseAccountInput(raw.slice(separator + 1));
      if (!id) return [];
      return streamers.filter(streamer => streamerKey(streamer) === `${platform}:${id}`);
    }
  }

  const { id, platform } = parseAccountInput(raw);
  if (!id) return [];
  return streamers.filter(
    streamer => streamer.id === id && (!platform || streamer.platform === platform),
  );
}

/**
 * Cerca nella lista in modo tollerante: pezzi di username, di nome mostrato o
 * di piattaforma. Solo per i suggerimenti dell'autocomplete, mai per rimuovere.
 * Funzione pura: la lista arriva da chi chiama.
 * @param {Array<{ platform: string, id: string, displayName?: string }>} streamers
 * @param {unknown} query
 */
function matchStreamers(streamers, query) {
  const raw = String(query ?? '')
    .trim()
    .toLowerCase();
  if (!raw) return [...streamers];

  // Se l'input identifica già un account preciso, i suggerimenti sono quello.
  const exact = resolveStreamers(streamers, raw);
  if (exact.length > 0) return exact;

  const needle = extractAccountId(raw) || raw;
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
  parseAccountInput,
  platformLabel,
  profileUrl,
  removeStreamer,
  resolveStorePath,
  resolveStreamers,
  saveStreamers,
  streamerKey,
};
