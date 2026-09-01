'use strict';

const { EmbedBuilder } = require('discord.js');
const liveConfig = require('../config/live');
const { optionalEnv } = require('./env');
const { listStreamers, streamerKey } = require('./live-store');

const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const TWITCH_STREAMS_URL = 'https://api.twitch.tv/helix/streams';
const TWITCH_USERS_URL = 'https://api.twitch.tv/helix/users';

const TIKTOK_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const KICK_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// Colori embed allineati al brand delle piattaforme.
const COLOR_TWITCH = 0x9146ff;
const COLOR_TIKTOK = 0x010101;
const COLOR_KICK = 0x53fc18;

/**
 * Token app Twitch (client credentials) con cache in memoria.
 * @param {{ clientId: string, clientSecret: string, fetchImpl?: typeof fetch }} opts
 */
function createTwitchAuth({ clientId, clientSecret, fetchImpl = fetch }) {
  let accessToken = null;
  let expiresAt = 0;

  async function getToken() {
    if (accessToken && Date.now() < expiresAt - 60_000) {
      return accessToken;
    }

    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    });

    const response = await fetchImpl(TWITCH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Twitch token HTTP ${response.status}: ${text.slice(0, 200)}`);
    }

    const data = await response.json();
    if (!data.access_token) {
      throw new Error('Twitch token: risposta senza access_token');
    }

    accessToken = data.access_token;
    // expires_in e' in secondi; default 1h se assente.
    const ttlSec = Number(data.expires_in) || 3600;
    expiresAt = Date.now() + ttlSec * 1000;
    return accessToken;
  }

  function invalidate() {
    accessToken = null;
    expiresAt = 0;
  }

  return { getToken, invalidate };
}

/**
 * Controlla quali login Twitch sono in live.
 * Restituisce una Map login -> info stream.
 * @param {string[]} logins
 * @param {{ clientId: string, getToken: () => Promise<string>, fetchImpl?: typeof fetch }} opts
 */
async function fetchTwitchLive(logins, { clientId, getToken, fetchImpl = fetch }) {
  const unique = [...new Set(logins.map(l => l.toLowerCase()).filter(Boolean))];
  if (unique.length === 0) return new Map();

  const token = await getToken();
  const params = new URLSearchParams();
  for (const login of unique) {
    params.append('user_login', login);
  }

  const response = await fetchImpl(`${TWITCH_STREAMS_URL}?${params}`, {
    headers: {
      'Client-ID': clientId,
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.status === 401) {
    const err = new Error('Twitch streams: token non valido (401)');
    err.code = 'TWITCH_UNAUTHORIZED';
    throw err;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Twitch streams HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  const byLogin = new Map();

  for (const stream of data.data ?? []) {
    const login = String(stream.user_login || '').toLowerCase();
    if (!login) continue;
    byLogin.set(login, {
      live: true,
      title: stream.title || null,
      gameName: stream.game_name || null,
      viewerCount: typeof stream.viewer_count === 'number' ? stream.viewer_count : null,
      thumbnailUrl: stream.thumbnail_url
        ? stream.thumbnail_url.replace('{width}', '1280').replace('{height}', '720')
        : null,
      startedAt: stream.started_at || null,
      userName: stream.user_name || login,
      url: `https://www.twitch.tv/${login}`,
    });
  }

  return byLogin;
}

/**
 * Carica display name e avatar Twitch (best effort, non bloccante per le notifiche).
 * @param {string[]} logins
 * @param {{ clientId: string, getToken: () => Promise<string>, fetchImpl?: typeof fetch }} opts
 */
async function fetchTwitchUsers(logins, { clientId, getToken, fetchImpl = fetch }) {
  const unique = [...new Set(logins.map(l => l.toLowerCase()).filter(Boolean))];
  if (unique.length === 0) return new Map();

  const token = await getToken();
  const params = new URLSearchParams();
  for (const login of unique) {
    params.append('login', login);
  }

  const response = await fetchImpl(`${TWITCH_USERS_URL}?${params}`, {
    headers: {
      'Client-ID': clientId,
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    return new Map();
  }

  const data = await response.json();
  const byLogin = new Map();
  for (const user of data.data ?? []) {
    const login = String(user.login || '').toLowerCase();
    if (!login) continue;
    byLogin.set(login, {
      displayName: user.display_name || login,
      profileImageUrl: user.profile_image_url || null,
    });
  }
  return byLogin;
}

/**
 * Interpreta la risposta JSON dell'endpoint room TikTok.
 * status 2 = in live (convenzione comune sulle API webcast).
 * @param {unknown} payload
 * @param {string} username
 */
function parseTikTokRoomPayload(payload, username) {
  if (!payload || typeof payload !== 'object') {
    return { live: false };
  }

  const root = /** @type {Record<string, unknown>} */ (payload);
  const data = /** @type {Record<string, unknown> | undefined} */ (root.data ?? root);

  const liveRoom =
    /** @type {Record<string, unknown> | undefined} */ (
      data?.liveRoom ?? data?.live_room ?? root.liveRoom
    );

  const statusCandidates = [
    liveRoom?.status,
    data?.status,
    data?.liveStatus,
    data?.live_status,
    /** @type {Record<string, unknown> | undefined} */ (data?.user)?.status,
  ];

  const isLive = statusCandidates.some(s => Number(s) === 2);

  if (!isLive) {
    // Alcune risposte espongono solo un booleano.
    const flags = [liveRoom?.live, data?.live, data?.isLive, data?.is_live];
    if (!flags.some(Boolean)) {
      return { live: false };
    }
  }

  const title =
    (typeof liveRoom?.title === 'string' && liveRoom.title) ||
    (typeof data?.title === 'string' && data.title) ||
    null;

  const cover =
    (typeof liveRoom?.coverUrl === 'string' && liveRoom.coverUrl) ||
    (typeof liveRoom?.cover_url === 'string' && liveRoom.cover_url) ||
    null;

  const roomId =
    liveRoom?.roomId ?? liveRoom?.room_id ?? data?.roomId ?? data?.room_id ?? null;

  return {
    live: true,
    title,
    thumbnailUrl: cover,
    roomId: roomId !== null && roomId !== undefined ? String(roomId) : null,
    url: `https://www.tiktok.com/@${username}/live`,
  };
}

/**
 * Controlla se un account TikTok e' in live.
 * Usa l'endpoint pubblico room; se fallisce, prova a leggere la pagina live.
 * @param {string} username senza @
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 */
async function fetchTikTokLive(username, { fetchImpl = fetch } = {}) {
  const clean = username.replace(/^@/, '').trim();
  if (!clean) return { live: false };

  const headers = {
    'User-Agent': TIKTOK_UA,
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    Referer: `https://www.tiktok.com/@${clean}`,
  };

  // 1) Endpoint room (piu' stabile delle pagine HTML).
  try {
    const roomUrl =
      `https://www.tiktok.com/api-live/user/room/?aid=1988&sourceType=54&uniqueId=${encodeURIComponent(clean)}`;
    const response = await fetchImpl(roomUrl, { headers });
    if (response.ok) {
      const json = await response.json();
      const parsed = parseTikTokRoomPayload(json, clean);
      if (parsed.live) return parsed;
      // risposta ok ma non live: affidabile, non serve fallback.
      if (json && typeof json === 'object') {
        return { live: false };
      }
    }
  } catch {
    // prosegui col fallback HTML
  }

  // 2) Fallback: pagina /live e segnali grezzi nel markup.
  try {
    const pageUrl = `https://www.tiktok.com/@${encodeURIComponent(clean)}/live`;
    const response = await fetchImpl(pageUrl, {
      headers: {
        ...headers,
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      return { live: false };
    }

    const html = await response.text();
    // "status":2 nel blob JSON della pagina, oppure meta live.
    const looksLive =
      /"status"\s*:\s*2\b/.test(html) ||
      /"liveRoomUserInfo"/.test(html) ||
      /"isLive"\s*:\s*true/.test(html) ||
      /"LiveRoom"/i.test(html);

    if (!looksLive) {
      return { live: false };
    }

    return {
      live: true,
      title: null,
      thumbnailUrl: null,
      roomId: null,
      url: pageUrl,
    };
  } catch {
    return { live: false };
  }
}

/**
 * Interpreta la risposta JSON dell'endpoint canale Kick.
 * livestream null/assente = offline, oggetto = live.
 * @param {unknown} payload
 * @param {string} username
 */
function parseKickChannelPayload(payload, username) {
  if (!payload || typeof payload !== 'object') {
    return { live: false };
  }

  const root = /** @type {Record<string, unknown>} */ (payload);
  const livestream = /** @type {Record<string, unknown> | null | undefined} */ (root.livestream);

  if (!livestream || typeof livestream !== 'object') {
    return { live: false };
  }

  const title =
    (typeof livestream.session_title === 'string' && livestream.session_title) || null;

  const thumbnail = /** @type {Record<string, unknown> | undefined} */ (livestream.thumbnail);
  const thumbnailUrl = (typeof thumbnail?.url === 'string' && thumbnail.url) || null;

  const viewerCount =
    typeof livestream.viewer_count === 'number' ? livestream.viewer_count : null;

  const user = /** @type {Record<string, unknown> | undefined} */ (root.user);
  const profileImageUrl = (typeof user?.profile_pic === 'string' && user.profile_pic) || null;

  return {
    live: true,
    title,
    thumbnailUrl,
    viewerCount,
    profileImageUrl,
    url: `https://kick.com/${username}`,
  };
}

/**
 * Controlla se un account Kick e' in live.
 * Fallimenti di rete/HTTP vengono propagati (invece di essere letti come
 * offline): il chiamante deve trattarli come stato sconosciuto e non
 * aggiornare lo stato precedente, per evitare falsi passaggi offline->live.
 * @param {string} username
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [opts]
 */
async function fetchKickLive(username, { fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
  const clean = username.replace(/^@/, '').trim();
  if (!clean) return { live: false };

  const channelUrl = `https://kick.com/api/v2/channels/${encodeURIComponent(clean)}`;
  const response = await fetchImpl(channelUrl, {
    headers: {
      'User-Agent': KICK_UA,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Kick channel HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  const json = await response.json();
  return parseKickChannelPayload(json, clean);
}

/**
 * Interpreta LIVE_ROLE_ID (o roleId passato a mano).
 * - vuoto / assente: nessun ping
 * - "everyone" / "@everyone": ping @everyone
 * - snowflake uguale all'id del server: ping @everyone (l'id del ruolo @everyone
 *   coincide col guild id, ma Discord non pinga se mandi solo <@&guildId>)
 * - altro snowflake: ping di quel ruolo
 *
 * @param {string | undefined | null} roleId
 * @param {string | undefined | null} [guildId]
 * @returns {{ kind: 'none' } | { kind: 'everyone' } | { kind: 'role', roleId: string }}
 */
function resolveLiveMention(roleId, guildId) {
  const raw = typeof roleId === 'string' ? roleId.trim() : '';
  if (!raw) return { kind: 'none' };

  const normalized = raw.toLowerCase();
  if (normalized === 'everyone' || normalized === '@everyone') {
    return { kind: 'everyone' };
  }

  // Il ruolo @everyone ha lo stesso id del server: va trattato come everyone,
  // non come menzione di ruolo generica.
  if (guildId && raw === String(guildId)) {
    return { kind: 'everyone' };
  }

  return { kind: 'role', roleId: raw };
}

/**
 * Content + allowedMentions coerenti col tipo di ping scelto.
 * Senza allowedMentions espliciti Discord (e i default del client) possono
 * sopprimere @everyone anche se il testo lo contiene.
 * @param {{ kind: 'none' } | { kind: 'everyone' } | { kind: 'role', roleId: string }} mention
 */
function mentionPayload(mention) {
  if (mention.kind === 'everyone') {
    return {
      content: '@everyone',
      allowedMentions: { parse: ['everyone'] },
    };
  }
  if (mention.kind === 'role') {
    return {
      content: `<@&${mention.roleId}>`,
      allowedMentions: { parse: [], roles: [mention.roleId] },
    };
  }
  return {
    content: undefined,
    allowedMentions: { parse: [] },
  };
}

/**
 * Costruisce embed + eventuale content (ping ruolo / @everyone) per una notifica live.
 * @param {{
 *   platform: 'twitch' | 'tiktok' | 'kick',
 *   displayName: string,
 *   info: {
 *     title?: string | null,
 *     gameName?: string | null,
 *     viewerCount?: number | null,
 *     thumbnailUrl?: string | null,
 *     url: string,
 *     profileImageUrl?: string | null,
 *   },
 *   roleId?: string,
 *   guildId?: string,
 * }} opts
 */
function buildLiveNotification({ platform, displayName, info, roleId, guildId }) {
  const isTwitch = platform === 'twitch';
  const isKick = platform === 'kick';
  const platformLabel = isTwitch ? 'Twitch' : isKick ? 'Kick' : 'TikTok';
  const color = isTwitch ? COLOR_TWITCH : isKick ? COLOR_KICK : COLOR_TIKTOK;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${displayName} e' in live su ${platformLabel}!`)
    .setURL(info.url)
    .setTimestamp(new Date());

  if (info.title) {
    embed.setDescription(info.title);
  }

  const fields = [];
  if (isTwitch && info.gameName) {
    fields.push({ name: 'Categoria', value: info.gameName, inline: true });
  }
  if (typeof info.viewerCount === 'number') {
    fields.push({ name: 'Spettatori', value: String(info.viewerCount), inline: true });
  }
  fields.push({ name: 'Link', value: info.url, inline: false });
  embed.addFields(fields);

  if (info.thumbnailUrl) {
    // Cache-buster: le thumbnail Twitch restano in cache se l'URL non cambia.
    const thumb =
      info.thumbnailUrl.includes('?')
        ? `${info.thumbnailUrl}&t=${Date.now()}`
        : `${info.thumbnailUrl}?t=${Date.now()}`;
    embed.setImage(thumb);
  }

  if (info.profileImageUrl) {
    embed.setThumbnail(info.profileImageUrl);
  }

  embed.setFooter({ text: platformLabel });

  const mention = resolveLiveMention(roleId, guildId);
  const { content, allowedMentions } = mentionPayload(mention);

  return { content, embeds: [embed], allowedMentions };
}

/**
 * Decide se annunciare un passaggio di stato.
 * Prima osservazione: solo seed, nessuna notifica (evita spam al restart).
 * @param {Map<string, boolean>} previous
 * @param {string} key
 * @param {boolean} isLive
 * @param {{ seeded: Set<string> }} meta
 * @returns {'notify' | 'update' | 'skip'}
 */
function transitionAction(previous, key, isLive, meta) {
  if (!meta.seeded.has(key)) {
    meta.seeded.add(key);
    previous.set(key, isLive);
    return 'skip';
  }

  const wasLive = previous.get(key) === true;
  previous.set(key, isLive);

  if (isLive && !wasLive) return 'notify';
  return 'update';
}

/**
 * Avvia il loop di polling. Non lancia mai: errori loggati e ritentati.
 * La lista streamer viene riletta a ogni giro, cosi' /live aggiungi e
 * /live rimuovi fanno effetto senza riavviare il bot.
 * @param {import('discord.js').Client} client
 * @param {{
 *   streamers?: typeof liveConfig.streamers,
 *   storePath?: string,
 *   channelId?: string,
 *   roleId?: string,
 *   pollIntervalMs?: number,
 *   twitchClientId?: string,
 *   twitchClientSecret?: string,
 *   fetchImpl?: typeof fetch,
 *   setIntervalFn?: typeof setInterval,
 *   clearIntervalFn?: typeof clearInterval,
 *   skipInitialTick?: boolean,
 * }} [options]
 */
function startLiveMonitor(client, options = {}) {
  // options.streamers congela la lista (usato dai test); altrimenti comanda lo
  // store, che i comandi /live riscrivono a bot acceso.
  const readStreamers = options.streamers
    ? () => options.streamers
    : () => listStreamers(options.storePath);
  const channelId = options.channelId ?? optionalEnv('LIVE_CHANNEL_ID');
  const roleId = options.roleId ?? optionalEnv('LIVE_ROLE_ID');
  const pollIntervalMs = Math.max(
    15_000,
    Number(options.pollIntervalMs ?? optionalEnv('LIVE_POLL_INTERVAL_MS') ?? liveConfig.defaultPollIntervalMs) ||
      liveConfig.defaultPollIntervalMs,
  );
  const twitchClientId = options.twitchClientId ?? optionalEnv('TWITCH_CLIENT_ID');
  const twitchClientSecret = options.twitchClientSecret ?? optionalEnv('TWITCH_CLIENT_SECRET');
  const fetchImpl = options.fetchImpl ?? fetch;
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;

  if (!channelId) {
    console.warn(
      'Live monitor disattivato: manca LIVE_CHANNEL_ID. ' +
        'Imposta l\'id del canale Discord dove mandare le notifiche.',
    );
    return { stop() {}, running: false };
  }

  let twitchAuth = null;
  let warnedTwitchCreds = false;

  // Le credenziali Twitch servono solo se nella lista c'e' almeno un account
  // Twitch, e la lista cambia a runtime: l'auth nasce al primo giro utile e il
  // warning per le credenziali mancanti esce una volta sola.
  function getTwitchAuth() {
    if (twitchAuth) return twitchAuth;

    if (!twitchClientId || !twitchClientSecret) {
      if (!warnedTwitchCreds) {
        warnedTwitchCreds = true;
        console.warn(
          'Live monitor: streamer Twitch in lista ma mancano TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET. ' +
            'Crea un\'app su https://dev.twitch.tv/console. Gli account TikTok e Kick restano attivi.',
        );
      }
      return null;
    }

    twitchAuth = createTwitchAuth({
      clientId: twitchClientId,
      clientSecret: twitchClientSecret,
      fetchImpl,
    });
    return twitchAuth;
  }

  /** @type {Map<string, boolean>} */
  const previous = new Map();
  const meta = { seeded: new Set() };
  let ticking = false;
  let stopped = false;

  async function resolveChannel() {
    const cached = client.channels.cache.get(channelId);
    if (cached?.isTextBased?.()) return cached;
    try {
      const fetched = await client.channels.fetch(channelId);
      if (fetched?.isTextBased?.()) return fetched;
    } catch (error) {
      console.warn(`Live monitor: canale ${channelId} non raggiungibile: ${error.message}`);
    }
    return null;
  }

  async function checkTwitch(twitchStreamers) {
    if (twitchStreamers.length === 0) return;

    const auth = getTwitchAuth();
    if (!auth) return;

    const logins = twitchStreamers.map(s => s.id);
    let liveMap;
    try {
      liveMap = await fetchTwitchLive(logins, {
        clientId: twitchClientId,
        getToken: () => auth.getToken(),
        fetchImpl,
      });
    } catch (error) {
      if (error.code === 'TWITCH_UNAUTHORIZED') {
        auth.invalidate();
      }
      console.warn(`Live monitor Twitch: ${error.message}`);
      return;
    }

    // Avatar solo per chi e' appena andato in live (riduce chiamate).
    /** @type {Map<string, { displayName: string, profileImageUrl: string | null }>} */
    let users = new Map();

    for (const streamer of twitchStreamers) {
      const key = streamerKey(streamer);
      const login = streamer.id.toLowerCase();
      const info = liveMap.get(login);
      const isLive = Boolean(info);
      const action = transitionAction(previous, key, isLive, meta);

      if (action !== 'notify' || !info) continue;

      if (users.size === 0) {
        try {
          users = await fetchTwitchUsers(logins, {
            clientId: twitchClientId,
            getToken: () => auth.getToken(),
            fetchImpl,
          });
        } catch {
          users = new Map();
        }
      }

      const user = users.get(login);
      if (!ancoraInLista(streamer)) continue;

      const channel = await resolveChannel();
      if (!channel) continue;

      const payload = buildLiveNotification({
        platform: 'twitch',
        displayName: streamer.displayName || user?.displayName || info.userName || login,
        info: {
          ...info,
          profileImageUrl: user?.profileImageUrl ?? null,
        },
        roleId,
        guildId: channel.guild?.id,
      });

      try {
        await channel.send(payload);
        console.log(`Live monitor: notificato Twitch ${login}`);
      } catch (error) {
        console.warn(`Live monitor: invio fallito per Twitch ${login}: ${error.message}`);
      }
    }
  }

  async function checkTikTok(tiktokStreamers) {
    for (const streamer of tiktokStreamers) {
      if (stopped) return;

      const key = streamerKey(streamer);
      let info;
      try {
        info = await fetchTikTokLive(streamer.id, { fetchImpl });
      } catch (error) {
        console.warn(`Live monitor TikTok ${streamer.id}: ${error.message}`);
        continue;
      }

      const isLive = Boolean(info?.live);
      const action = transitionAction(previous, key, isLive, meta);
      if (action !== 'notify') continue;

      if (!ancoraInLista(streamer)) continue;

      const channel = await resolveChannel();
      if (!channel) continue;

      const payload = buildLiveNotification({
        platform: 'tiktok',
        displayName: streamer.displayName || streamer.id,
        info: {
          title: info.title,
          thumbnailUrl: info.thumbnailUrl,
          url: info.url || `https://www.tiktok.com/@${streamer.id}/live`,
        },
        roleId,
        guildId: channel.guild?.id,
      });

      try {
        await channel.send(payload);
        console.log(`Live monitor: notificato TikTok ${streamer.id}`);
      } catch (error) {
        console.warn(`Live monitor: invio fallito per TikTok ${streamer.id}: ${error.message}`);
      }
    }
  }

  async function checkKick(kickStreamers) {
    for (const streamer of kickStreamers) {
      if (stopped) return;

      const key = streamerKey(streamer);
      let info;
      try {
        info = await fetchKickLive(streamer.id, { fetchImpl });
      } catch (error) {
        console.warn(`Live monitor Kick ${streamer.id}: ${error.message}`);
        continue;
      }

      const isLive = Boolean(info?.live);

      // Stato committato subito, tranne per la transizione offline->live:
      // in quel caso si aggiorna solo dopo l'invio riuscito, cosi' un
      // fallimento di resolveChannel/send viene ritentato al prossimo giro
      // invece di essere considerato "gia' notificato".
      if (!meta.seeded.has(key)) {
        meta.seeded.add(key);
        previous.set(key, isLive);
        continue;
      }

      const wasLive = previous.get(key) === true;
      if (!isLive || wasLive) {
        previous.set(key, isLive);
        continue;
      }

      if (!ancoraInLista(streamer)) continue;

      const channel = await resolveChannel();
      if (!channel) continue;

      const payload = buildLiveNotification({
        platform: 'kick',
        displayName: streamer.displayName || streamer.id,
        info: {
          title: info.title,
          viewerCount: info.viewerCount,
          thumbnailUrl: info.thumbnailUrl,
          profileImageUrl: info.profileImageUrl,
          url: info.url || `https://kick.com/${streamer.id}`,
        },
        roleId,
        guildId: channel.guild?.id,
      });

      try {
        await channel.send(payload);
        previous.set(key, isLive);
        console.log(`Live monitor: notificato Kick ${streamer.id}`);
      } catch (error) {
        console.warn(`Live monitor: invio fallito per Kick ${streamer.id}: ${error.message}`);
      }
    }
  }

  // Uno streamer rimosso dalla lista non deve lasciare il suo stato dietro:
  // altrimenti la mappa cresce a ogni modifica e un account ri-aggiunto
  // ripartirebbe da uno stato vecchio di ore.
  function pruneState(streamers) {
    const keys = new Set(streamers.map(streamerKey));

    for (const key of previous.keys()) {
      if (!keys.has(key)) previous.delete(key);
    }
    for (const key of meta.seeded) {
      if (!keys.has(key)) meta.seeded.delete(key);
    }
  }

  // Un giro di controllo puo' restare appeso su una richiesta di rete o su
  // Discord per secondi: nel frattempo /live rimuovi puo' aver tolto l'account,
  // e annunciarlo dopo una rimozione confermata sarebbe un messaggio che
  // nessuno ha piu' chiesto. Rileggiamo la lista appena prima di inviare.
  function ancoraInLista(streamer) {
    const key = streamerKey(streamer);
    return readStreamers().some(altro => streamerKey(altro) === key);
  }

  async function tick() {
    if (stopped || ticking) return;
    ticking = true;
    try {
      const streamers = readStreamers();
      pruneState(streamers);

      await checkTwitch(streamers.filter(s => s.platform === 'twitch'));
      await checkTikTok(streamers.filter(s => s.platform === 'tiktok'));
      await checkKick(streamers.filter(s => s.platform === 'kick'));
    } catch (error) {
      console.warn(`Live monitor: errore imprevisto: ${error.message}`);
    } finally {
      ticking = false;
    }
  }

  console.log(
    `Live monitor avviato: ${readStreamers().length} streamer in lista, ogni ` +
      `${Math.round(pollIntervalMs / 1000)}s, canale ${channelId}.`,
  );

  // Prima passata subito (solo seed stato), poi intervallo.
  // skipInitialTick e' per i test che vogliono controllare i tick a mano.
  if (!options.skipInitialTick) {
    void tick();
  }
  const timer = setIntervalFn(() => {
    void tick();
  }, pollIntervalMs);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  return {
    running: true,
    stop() {
      stopped = true;
      clearIntervalFn(timer);
    },
    // Esposti per i test.
    _tick: tick,
    _previous: previous,
    _meta: meta,
  };
}

module.exports = {
  streamerKey,
  createTwitchAuth,
  fetchTwitchLive,
  fetchTwitchUsers,
  parseTikTokRoomPayload,
  fetchTikTokLive,
  parseKickChannelPayload,
  fetchKickLive,
  resolveLiveMention,
  mentionPayload,
  buildLiveNotification,
  transitionAction,
  startLiveMonitor,
};
