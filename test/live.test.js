'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  streamerKey,
  createTwitchAuth,
  fetchTwitchLive,
  parseTikTokRoomPayload,
  parseKickChannelPayload,
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
