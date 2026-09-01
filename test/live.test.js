'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  streamerKey,
  createTwitchAuth,
  fetchTwitchLive,
  parseTikTokRoomPayload,
  parseKickChannelPayload,
  fetchKickLive,
  resolveLiveMention,
  buildLiveNotification,
  transitionAction,
  startLiveMonitor,
} = require('../src/lib/live');

const originalWarn = console.warn;
const originalLog = console.log;

beforeEach(() => {
  console.warn = () => {};
  console.log = () => {};
});

afterEach(() => {
  console.warn = originalWarn;
  console.log = originalLog;
});

test('streamerKey normalizza id e piattaforma', () => {
  assert.equal(streamerKey({ platform: 'twitch', id: 'SalvinoSalvo' }), 'twitch:salvinosalvo');
  assert.equal(streamerKey({ platform: 'tiktok', id: 'xx_cicci_xx' }), 'tiktok:xx_cicci_xx');
});

test('transitionAction al primo giro fa solo seed, senza notify', () => {
  const previous = new Map();
  const meta = { seeded: new Set() };

  assert.equal(transitionAction(previous, 'twitch:a', true, meta), 'skip');
  assert.equal(previous.get('twitch:a'), true);
  assert.equal(meta.seeded.has('twitch:a'), true);

  // Secondo giro, ancora live: nessun notify.
  assert.equal(transitionAction(previous, 'twitch:a', true, meta), 'update');

  // Offline.
  assert.equal(transitionAction(previous, 'twitch:a', false, meta), 'update');

  // Di nuovo live: notify.
  assert.equal(transitionAction(previous, 'twitch:a', true, meta), 'notify');
});

test('parseTikTokRoomPayload riconosce status 2 come live', () => {
  const live = parseTikTokRoomPayload(
    { data: { liveRoom: { status: 2, title: 'Ciao', coverUrl: 'https://img/x' } } },
    'xx_cicci_xx',
  );
  assert.equal(live.live, true);
  assert.equal(live.title, 'Ciao');
  assert.equal(live.url, 'https://www.tiktok.com/@xx_cicci_xx/live');

  const offline = parseTikTokRoomPayload({ data: { liveRoom: { status: 4 } } }, 'xx_cicci_xx');
  assert.equal(offline.live, false);
});

test('parseKickChannelPayload riconosce livestream come live', () => {
  const live = parseKickChannelPayload(
    {
      livestream: {
        session_title: 'Ciao Kick',
        viewer_count: 7,
        thumbnail: { url: 'https://img/kick.jpg' },
      },
      user: { profile_pic: 'https://img/avatar.jpg' },
    },
    'salvinosalvo',
  );
  assert.equal(live.live, true);
  assert.equal(live.title, 'Ciao Kick');
  assert.equal(live.viewerCount, 7);
  assert.equal(live.thumbnailUrl, 'https://img/kick.jpg');
  assert.equal(live.profileImageUrl, 'https://img/avatar.jpg');
  assert.equal(live.url, 'https://kick.com/salvinosalvo');

  const offline = parseKickChannelPayload({ livestream: null }, 'salvinosalvo');
  assert.equal(offline.live, false);
});

test('fetchKickLive rilancia l\'errore su risposta HTTP non ok (stato sconosciuto, non offline)', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 503,
    async text() {
      return 'service unavailable';
    },
  });

  await assert.rejects(
    () => fetchKickLive('salvinosalvo', { fetchImpl }),
    /Kick channel HTTP 503/,
  );
});

test('createTwitchAuth cache il token e lo rinnova se invalido', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return {
      ok: true,
      async json() {
        return { access_token: `tok-${calls}`, expires_in: 3600 };
      },
    };
  };

  const auth = createTwitchAuth({
    clientId: 'id',
    clientSecret: 'secret',
    fetchImpl,
  });

  assert.equal(await auth.getToken(), 'tok-1');
  assert.equal(await auth.getToken(), 'tok-1');
  assert.equal(calls, 1);

  auth.invalidate();
  assert.equal(await auth.getToken(), 'tok-2');
  assert.equal(calls, 2);
});

test('fetchTwitchLive mappa i login in live', async () => {
  const fetchImpl = async url => {
    assert.match(String(url), /helix\/streams/);
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          data: [
            {
              user_login: 'salvinosalvo',
              user_name: 'SalvinoSalvo',
              title: 'GTA RP',
              game_name: 'Grand Theft Auto V',
              viewer_count: 42,
              thumbnail_url: 'https://static.twitch/{width}x{height}.jpg',
              started_at: '2026-01-01T00:00:00Z',
            },
          ],
        };
      },
    };
  };

  const map = await fetchTwitchLive(['SalvinoSalvo', 'offline_user'], {
    clientId: 'cid',
    getToken: async () => 'token',
    fetchImpl,
  });

  assert.equal(map.size, 1);
  assert.equal(map.get('salvinosalvo').live, true);
  assert.equal(map.get('salvinosalvo').title, 'GTA RP');
  assert.equal(map.get('salvinosalvo').url, 'https://www.twitch.tv/salvinosalvo');
  assert.equal(
    map.get('salvinosalvo').thumbnailUrl,
    'https://static.twitch/1280x720.jpg',
  );
});

test('resolveLiveMention distingue nessuno, ruolo e @everyone', () => {
  assert.deepEqual(resolveLiveMention(undefined), { kind: 'none' });
  assert.deepEqual(resolveLiveMention(''), { kind: 'none' });
  assert.deepEqual(resolveLiveMention('  '), { kind: 'none' });
  assert.deepEqual(resolveLiveMention('123456789012345678'), {
    kind: 'role',
    roleId: '123456789012345678',
  });
  assert.deepEqual(resolveLiveMention('everyone'), { kind: 'everyone' });
  assert.deepEqual(resolveLiveMention('@everyone'), { kind: 'everyone' });
  assert.deepEqual(resolveLiveMention('EVERYONE'), { kind: 'everyone' });
  // Id del server = id del ruolo @everyone: va trattato come everyone.
  assert.deepEqual(resolveLiveMention('999888777', '999888777'), { kind: 'everyone' });
  // Stesso snowflake ma guild diversa: resta un ping di ruolo.
  assert.deepEqual(resolveLiveMention('999888777', '111'), {
    kind: 'role',
    roleId: '999888777',
  });
});

test('buildLiveNotification produce embed Twitch con titolo e link', () => {
  const payload = buildLiveNotification({
    platform: 'twitch',
    displayName: 'SalvinoSalvo',
    info: {
      title: 'GTA RP',
      gameName: 'Grand Theft Auto V',
      viewerCount: 10,
      url: 'https://www.twitch.tv/salvinosalvo',
      thumbnailUrl: 'https://static.twitch/img.jpg',
    },
    roleId: '123',
  });

  assert.equal(payload.content, '<@&123>');
  assert.deepEqual(payload.allowedMentions, { parse: [], roles: ['123'] });
  assert.equal(payload.embeds.length, 1);
  const data = payload.embeds[0].data;
  assert.match(data.title, /SalvinoSalvo/);
  assert.match(data.title, /Twitch/);
  assert.equal(data.description, 'GTA RP');
  assert.equal(data.url, 'https://www.twitch.tv/salvinosalvo');
  assert.equal(data.color, 0x9146ff);
});

test('buildLiveNotification con everyone manda @everyone e allowedMentions', () => {
  const byKeyword = buildLiveNotification({
    platform: 'twitch',
    displayName: 's4k3_tv',
    info: { url: 'https://www.twitch.tv/s4k3_tv' },
    roleId: 'everyone',
  });
  assert.equal(byKeyword.content, '@everyone');
  assert.deepEqual(byKeyword.allowedMentions, { parse: ['everyone'] });

  const byGuildId = buildLiveNotification({
    platform: 'twitch',
    displayName: 's4k3_tv',
    info: { url: 'https://www.twitch.tv/s4k3_tv' },
    roleId: '555666777',
    guildId: '555666777',
  });
  assert.equal(byGuildId.content, '@everyone');
  assert.deepEqual(byGuildId.allowedMentions, { parse: ['everyone'] });
});

test('buildLiveNotification TikTok senza ruolo non ha content', () => {
  const payload = buildLiveNotification({
    platform: 'tiktok',
    displayName: 'xx_cicci_xx',
    info: { url: 'https://www.tiktok.com/@xx_cicci_xx/live' },
  });

  assert.equal(payload.content, undefined);
  assert.deepEqual(payload.allowedMentions, { parse: [] });
  assert.equal(payload.embeds[0].data.color, 0x010101);
});

test('buildLiveNotification Kick senza ruolo non ha content', () => {
  const payload = buildLiveNotification({
    platform: 'kick',
    displayName: 'SalvinoSalvo',
    info: { url: 'https://kick.com/salvinosalvo' },
  });

  assert.equal(payload.content, undefined);
  assert.deepEqual(payload.allowedMentions, { parse: [] });
  assert.match(payload.embeds[0].data.title, /Kick/);
  assert.equal(payload.embeds[0].data.color, 0x53fc18);
});

test('startLiveMonitor senza LIVE_CHANNEL_ID non parte', () => {
  const monitor = startLiveMonitor(
    { channels: { cache: new Map() } },
    { channelId: '', streamers: [] },
  );
  assert.equal(monitor.running, false);
});

test('startLiveMonitor notifica solo al passaggio offline -> live', async () => {
  const inviati = [];
  const channel = {
    isTextBased: () => true,
    send: async payload => {
      inviati.push(payload);
    },
  };

  const client = {
    channels: {
      cache: {
        get: id => (id === 'chan-1' ? channel : undefined),
      },
      fetch: async () => channel,
    },
  };

  let twitchPayload = { data: [] };
  let tiktokLive = false;

  const fetchImpl = async url => {
    const u = String(url);

    if (u.includes('oauth2/token')) {
      return {
        ok: true,
        async json() {
          return { access_token: 't', expires_in: 3600 };
        },
      };
    }

    if (u.includes('helix/streams')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return twitchPayload;
        },
      };
    }

    if (u.includes('helix/users')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return { data: [{ login: 'salvinosalvo', display_name: 'SalvinoSalvo' }] };
        },
      };
    }

    if (u.includes('api-live/user/room')) {
      return {
        ok: true,
        async json() {
          return {
            data: {
              liveRoom: {
                status: tiktokLive ? 2 : 4,
                title: tiktokLive ? 'Live TikTok' : '',
              },
            },
          };
        },
      };
    }

    return { ok: false, status: 404, async text() { return ''; }, async json() { return {}; } };
  };

  const monitor = startLiveMonitor(client, {
    channelId: 'chan-1',
    streamers: [
      { platform: 'twitch', id: 'salvinosalvo', displayName: 'SalvinoSalvo' },
      { platform: 'tiktok', id: 'xx_cicci_xx', displayName: 'xx_cicci_xx' },
    ],
    twitchClientId: 'cid',
    twitchClientSecret: 'sec',
    pollIntervalMs: 15_000,
    fetchImpl,
    skipInitialTick: true,
    setIntervalFn: () => ({ unref() {} }),
    clearIntervalFn: () => {},
  });

  assert.equal(monitor.running, true);

  // Seed: entrambi "live" ma zero messaggi al primo giro.
  twitchPayload = {
    data: [
      {
        user_login: 'salvinosalvo',
        user_name: 'SalvinoSalvo',
        title: 'Gia live',
        game_name: 'Just Chatting',
        viewer_count: 1,
        thumbnail_url: 'https://x/{width}x{height}.jpg',
      },
    ],
  };
  tiktokLive = true;
  await monitor._tick();
  assert.equal(inviati.length, 0);

  // Offline.
  twitchPayload = { data: [] };
  tiktokLive = false;
  await monitor._tick();
  assert.equal(inviati.length, 0);

  // Tornano in live: due notifiche.
  twitchPayload = {
    data: [
      {
        user_login: 'salvinosalvo',
        user_name: 'SalvinoSalvo',
        title: 'Di nuovo live',
        game_name: 'Just Chatting',
        viewer_count: 5,
        thumbnail_url: 'https://x/{width}x{height}.jpg',
      },
    ],
  };
  tiktokLive = true;
  await monitor._tick();

  assert.equal(inviati.length, 2);
  const titles = inviati.map(p => p.embeds[0].data.title);
  assert.ok(titles.some(t => t.includes('Twitch')));
  assert.ok(titles.some(t => t.includes('TikTok')));

  // Ancora live: niente spam.
  await monitor._tick();
  assert.equal(inviati.length, 2);

  monitor.stop();
});

test('startLiveMonitor Kick: un errore HTTP transitorio non forza offline ne\' causa falsi notify', async () => {
  const inviati = [];
  const channel = {
    isTextBased: () => true,
    send: async payload => {
      inviati.push(payload);
    },
  };
  const client = {
    channels: {
      cache: { get: id => (id === 'chan-1' ? channel : undefined) },
      fetch: async () => channel,
    },
  };

  let kickState = 'live';
  const fetchImpl = async () => {
    if (kickState === 'error') {
      return { ok: false, status: 500, async text() { return 'boom'; } };
    }
    return {
      ok: true,
      async json() {
        return kickState === 'live'
          ? { livestream: { session_title: 'In live su Kick', viewer_count: 3 }, user: {} }
          : { livestream: null };
      },
    };
  };

  const monitor = startLiveMonitor(client, {
    channelId: 'chan-1',
    streamers: [{ platform: 'kick', id: 'salvinosalvo', displayName: 'SalvinoSalvo' }],
    pollIntervalMs: 15_000,
    fetchImpl,
    skipInitialTick: true,
    setIntervalFn: () => ({ unref() {} }),
    clearIntervalFn: () => {},
  });

  // Seed: gia' live, nessun notify.
  await monitor._tick();
  assert.equal(inviati.length, 0);

  // Errore transitorio mentre e' ancora live: stato preservato, nessun notify.
  kickState = 'error';
  await monitor._tick();
  assert.equal(inviati.length, 0);

  // Ancora live dopo l'errore: se lo stato fosse stato resettato a offline
  // dall'errore precedente, qui scatterebbe un falso notify offline->live.
  kickState = 'live';
  await monitor._tick();
  assert.equal(inviati.length, 0);

  // Va davvero offline.
  kickState = 'offline';
  await monitor._tick();
  assert.equal(inviati.length, 0);

  // Un altro errore transitorio mentre e' offline: stato preservato.
  kickState = 'error';
  await monitor._tick();
  assert.equal(inviati.length, 0);

  // Torna live per davvero: notify, perche' lo stato offline non era stato
  // corrotto dall'errore transitorio.
  kickState = 'live';
  await monitor._tick();
  assert.equal(inviati.length, 1);
  assert.match(inviati[0].embeds[0].data.title, /Kick/);

  monitor.stop();
});

test('startLiveMonitor Kick: un invio Discord fallito viene ritentato al giro successivo', async () => {
  const inviati = [];
  let sendShouldFail = true;
  const channel = {
    isTextBased: () => true,
    send: async payload => {
      if (sendShouldFail) {
        throw new Error('Discord API down');
      }
      inviati.push(payload);
    },
  };
  const client = {
    channels: {
      cache: { get: id => (id === 'chan-1' ? channel : undefined) },
      fetch: async () => channel,
    },
  };

  let kickLive = false;
  const fetchImpl = async () => ({
    ok: true,
    async json() {
      return kickLive
        ? { livestream: { session_title: 'Live', viewer_count: 1 }, user: {} }
        : { livestream: null };
    },
  });

  const monitor = startLiveMonitor(client, {
    channelId: 'chan-1',
    streamers: [{ platform: 'kick', id: 'salvinosalvo', displayName: 'SalvinoSalvo' }],
    pollIntervalMs: 15_000,
    fetchImpl,
    skipInitialTick: true,
    setIntervalFn: () => ({ unref() {} }),
    clearIntervalFn: () => {},
  });

  await monitor._tick(); // seed offline
  assert.equal(inviati.length, 0);

  kickLive = true;
  await monitor._tick(); // offline -> live, ma l'invio fallisce
  assert.equal(inviati.length, 0);

  // L'invio fallito non deve aver marcato lo stream come "gia' notificato":
  // al giro successivo, ancora live, deve ritentare l'invio.
  sendShouldFail = false;
  await monitor._tick();
  assert.equal(inviati.length, 1);

  // Da qui in poi niente altri invii per lo stesso stream.
  await monitor._tick();
  assert.equal(inviati.length, 1);

  monitor.stop();
});

test('startLiveMonitor rilegge la lista dallo store a ogni giro', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kelp-live-monitor-'));
  const storePath = path.join(tmpDir, 'live.json');

  const scrivi = streamers =>
    fs.writeFileSync(storePath, JSON.stringify({ streamers }, null, 2), 'utf8');

  const inviati = [];
  const channel = {
    isTextBased: () => true,
    send: async payload => {
      inviati.push(payload);
    },
  };
  const client = {
    channels: {
      cache: { get: id => (id === 'chan-1' ? channel : undefined) },
      fetch: async () => channel,
    },
  };

  // Kick non richiede credenziali: l'account interrogato si legge dall'url.
  const inLive = new Set();
  const fetchImpl = async url => {
    const username = String(url).match(/channels\/([^/?]+)/)?.[1];
    return {
      ok: true,
      async json() {
        return inLive.has(username)
          ? { livestream: { session_title: `Live di ${username}`, viewer_count: 1 }, user: {} }
          : { livestream: null };
      },
    };
  };

  scrivi([{ platform: 'kick', id: 'primo-canale' }]);

  const monitor = startLiveMonitor(client, {
    channelId: 'chan-1',
    storePath,
    pollIntervalMs: 15_000,
    fetchImpl,
    skipInitialTick: true,
    setIntervalFn: () => ({ unref() {} }),
    clearIntervalFn: () => {},
  });

  try {
    await monitor._tick(); // seed offline del solo account in lista
    assert.deepEqual([...monitor._previous.keys()], ['kick:primo-canale']);

    // /live aggiungi mentre il bot e' acceso: il giro dopo lo monitora, e il
    // primo giro per lui e' solo seed (niente annuncio di una live in corso).
    inLive.add('secondo-canale');
    scrivi([{ platform: 'kick', id: 'primo-canale' }, { platform: 'kick', id: 'secondo-canale' }]);
    await monitor._tick();
    assert.equal(inviati.length, 0);
    assert.deepEqual([...monitor._previous.keys()].sort(), ['kick:primo-canale', 'kick:secondo-canale']);

    // Passaggio offline -> live rilevato senza riavvio.
    inLive.delete('secondo-canale');
    await monitor._tick();
    inLive.add('secondo-canale');
    await monitor._tick();
    assert.equal(inviati.length, 1);
    assert.match(inviati[0].embeds[0].data.title, /Kick/);

    // /live rimuovi: niente piu' controlli e stato ripulito.
    scrivi([{ platform: 'kick', id: 'primo-canale' }]);
    await monitor._tick();
    assert.deepEqual([...monitor._previous.keys()], ['kick:primo-canale']);
    assert.deepEqual([...monitor._meta.seeded], ['kick:primo-canale']);
    assert.equal(inviati.length, 1);
  } finally {
    monitor.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('startLiveMonitor parte anche con la lista vuota, in attesa di /live aggiungi', () => {
  const monitor = startLiveMonitor(
    { channels: { cache: new Map() } },
    { channelId: 'chan-1', streamers: [], setIntervalFn: () => ({ unref() {} }), clearIntervalFn: () => {} },
  );

  assert.equal(monitor.running, true);
  monitor.stop();
});

test('startLiveMonitor non annuncia un account rimosso mentre il giro era in corso', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kelp-live-race-'));
  const storePath = path.join(tmpDir, 'live.json');
  const scrivi = streamers =>
    fs.writeFileSync(storePath, JSON.stringify({ streamers }, null, 2), 'utf8');

  const inviati = [];
  const channel = {
    isTextBased: () => true,
    send: async payload => {
      inviati.push(payload);
    },
  };
  const client = {
    channels: {
      cache: { get: id => (id === 'chan-1' ? channel : undefined) },
      fetch: async () => channel,
    },
  };

  let kickLive = false;
  let rimuoviDurante = false;
  const fetchImpl = async () => {
    // La rimozione arriva mentre il tick e' appeso su questa richiesta: e' il
    // caso in cui il tick lavora ancora sulla lista vecchia.
    if (rimuoviDurante) scrivi([]);
    return {
      ok: true,
      async json() {
        return kickLive
          ? { livestream: { session_title: 'Live', viewer_count: 1 }, user: {} }
          : { livestream: null };
      },
    };
  };

  scrivi([{ platform: 'kick', id: 'salvinosalvo' }]);

  const monitor = startLiveMonitor(client, {
    channelId: 'chan-1',
    storePath,
    pollIntervalMs: 15_000,
    fetchImpl,
    skipInitialTick: true,
    setIntervalFn: () => ({ unref() {} }),
    clearIntervalFn: () => {},
  });

  try {
    await monitor._tick(); // seed offline
    assert.equal(inviati.length, 0);

    kickLive = true;
    rimuoviDurante = true;
    await monitor._tick();

    // Offline -> live, ma l'account non e' piu' in lista: niente annuncio.
    assert.equal(inviati.length, 0);

    // E lo stato del rimosso non resta appeso.
    rimuoviDurante = false;
    await monitor._tick();
    assert.deepEqual([...monitor._previous.keys()], []);
    assert.equal(inviati.length, 0);
  } finally {
    monitor.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('monitor.forget rimette a zero un account rimosso e riaggiunto', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kelp-live-forget-'));
  const storePath = path.join(tmpDir, 'live.json');
  const scrivi = streamers =>
    fs.writeFileSync(storePath, JSON.stringify({ streamers }, null, 2), 'utf8');

  const inviati = [];
  const channel = {
    isTextBased: () => true,
    send: async payload => {
      inviati.push(payload);
    },
  };
  const client = {
    channels: {
      cache: { get: id => (id === 'chan-1' ? channel : undefined) },
      fetch: async () => channel,
    },
  };

  let kickLive = false;
  const fetchImpl = async () => ({
    ok: true,
    async json() {
      return kickLive
        ? { livestream: { session_title: 'Live', viewer_count: 1 }, user: {} }
        : { livestream: null };
    },
  });

  scrivi([{ platform: 'kick', id: 'salvinosalvo' }]);

  const monitor = startLiveMonitor(client, {
    channelId: 'chan-1',
    storePath,
    pollIntervalMs: 15_000,
    fetchImpl,
    skipInitialTick: true,
    setIntervalFn: () => ({ unref() {} }),
    clearIntervalFn: () => {},
  });

  try {
    await monitor._tick(); // seed: offline
    assert.equal(monitor._previous.get('kick:salvinosalvo'), false);

    // Rimosso e riaggiunto tra due giri (es. per cambiare il nome mostrato):
    // la chiave e' la stessa, quindi pruneState non vede il buco. Senza forget
    // il nuovo ingresso eredita "offline" e, essendo già in live, verrebbe
    // annunciato al giro dopo.
    scrivi([{ platform: 'kick', id: 'salvinosalvo', displayName: 'Salvino' }]);
    monitor.forget({ platform: 'kick', id: 'salvinosalvo' });
    kickLive = true;

    await monitor._tick();
    assert.equal(inviati.length, 0);
    assert.equal(monitor._previous.get('kick:salvinosalvo'), true);

    // Da qui in poi funziona come un account nuovo: annuncia solo il prossimo
    // passaggio offline -> live.
    kickLive = false;
    await monitor._tick();
    kickLive = true;
    await monitor._tick();
    assert.equal(inviati.length, 1);
  } finally {
    monitor.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('startLiveMonitor non annuncia se la rimozione arriva mentre risolve il canale', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kelp-live-race2-'));
  const storePath = path.join(tmpDir, 'live.json');
  const scrivi = streamers =>
    fs.writeFileSync(storePath, JSON.stringify({ streamers }, null, 2), 'utf8');

  const inviati = [];
  const channel = {
    isTextBased: () => true,
    send: async payload => {
      inviati.push(payload);
    },
  };

  let rimuoviDuranteFetchCanale = false;
  const client = {
    channels: {
      // Canale fuori cache: ogni giro passa dalla fetch, che qui e' la finestra
      // in cui /live rimuovi puo' completare.
      cache: { get: () => undefined },
      fetch: async () => {
        if (rimuoviDuranteFetchCanale) scrivi([]);
        return channel;
      },
    },
  };

  let kickLive = false;
  const fetchImpl = async () => ({
    ok: true,
    async json() {
      return kickLive
        ? { livestream: { session_title: 'Live', viewer_count: 1 }, user: {} }
        : { livestream: null };
    },
  });

  scrivi([{ platform: 'kick', id: 'salvinosalvo' }]);

  const monitor = startLiveMonitor(client, {
    channelId: 'chan-1',
    storePath,
    pollIntervalMs: 15_000,
    fetchImpl,
    skipInitialTick: true,
    setIntervalFn: () => ({ unref() {} }),
    clearIntervalFn: () => {},
  });

  try {
    await monitor._tick(); // seed offline

    kickLive = true;
    rimuoviDuranteFetchCanale = true;
    await monitor._tick();

    assert.equal(inviati.length, 0);
  } finally {
    monitor.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('startLiveMonitor interroga i provider a lotti, senza fila indiana', async () => {
  const channel = { isTextBased: () => true, send: async () => {} };
  const client = {
    channels: {
      cache: { get: () => channel },
      fetch: async () => channel,
    },
  };

  let inVolo = 0;
  let massimoInVolo = 0;
  let completate = 0;

  // Ogni richiesta resta appesa un giro di event loop: se il monitor lavorasse
  // in fila indiana il massimo in volo sarebbe 1, e con 12 account lenti un
  // giro durerebbe 12 timeout invece di 3 lotti.
  const fetchImpl = async () => {
    inVolo += 1;
    massimoInVolo = Math.max(massimoInVolo, inVolo);
    await new Promise(resolve => setTimeout(resolve, 0));
    inVolo -= 1;
    completate += 1;
    return { ok: true, async json() { return { livestream: null }; } };
  };

  const streamers = Array.from({ length: 12 }, (_, i) => ({
    platform: 'kick',
    id: `canale-${String(i).padStart(2, '0')}`,
  }));

  const monitor = startLiveMonitor(client, {
    channelId: 'chan-1',
    streamers,
    pollIntervalMs: 15_000,
    fetchImpl,
    skipInitialTick: true,
    setIntervalFn: () => ({ unref() {} }),
    clearIntervalFn: () => {},
  });

  try {
    await monitor._tick();

    assert.equal(completate, 12);
    assert.ok(massimoInVolo > 1, `atteso piu' di una richiesta in volo, viste ${massimoInVolo}`);
    // E il tetto va rispettato: niente 12 richieste tutte insieme.
    assert.ok(massimoInVolo <= 4, `atteso al massimo 4 richieste in volo, viste ${massimoInVolo}`);
  } finally {
    monitor.stop();
  }
});
