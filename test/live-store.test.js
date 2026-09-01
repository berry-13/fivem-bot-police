'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const liveConfig = require('../src/config/live');
const {
  MAX_STREAMERS,
  addStreamer,
  extractAccountId,
  listStreamers,
  matchStreamers,
  normalizeStreamer,
  parseAccountInput,
  removeStreamer,
  resolveStreamers,
  saveStreamers,
} = require('../src/lib/live-store');

let tmpDir;
let storePath;
const originalWarn = console.warn;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kelp-live-store-'));
  storePath = path.join(tmpDir, 'live.json');
  console.warn = () => {};
});

afterEach(() => {
  console.warn = originalWarn;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function readFile() {
  return JSON.parse(fs.readFileSync(storePath, 'utf8'));
}

test('extractAccountId accetta username, @handle e link delle piattaforme', () => {
  assert.equal(extractAccountId('SalvinoSalvo'), 'salvinosalvo');
  assert.equal(extractAccountId('  @xx_cicci_xx '), 'xx_cicci_xx');
  assert.equal(extractAccountId('https://www.twitch.tv/SalvinoSalvo'), 'salvinosalvo');
  assert.equal(extractAccountId('twitch.tv/s4k3_tv?sr=a'), 's4k3_tv');
  assert.equal(extractAccountId('<https://kick.com/salvinosalvo>'), 'salvinosalvo');
  // TikTok: l'handle e' il segmento con la chiocciola, non l'ultimo pezzo.
  assert.equal(extractAccountId('https://www.tiktok.com/@xx_cicci_xx/live'), 'xx_cicci_xx');
  // Twitch: /videos e simili non sono lo username.
  assert.equal(extractAccountId('https://m.twitch.tv/ydiablo93/videos'), 'ydiablo93');
});

test('extractAccountId rifiuta i path di domini che non monitoriamo', () => {
  assert.equal(extractAccountId('https://example.com/salvinosalvo'), '');
  assert.equal(extractAccountId(''), '');
  assert.equal(extractAccountId(undefined), '');
});

test('normalizeStreamer valida piattaforma e username', () => {
  assert.deepEqual(normalizeStreamer({ platform: 'Twitch', id: 'https://www.twitch.tv/Foo_Bar' }), {
    ok: true,
    streamer: { platform: 'twitch', id: 'foo_bar' },
  });

  assert.deepEqual(normalizeStreamer({ platform: 'youtube', id: 'tizio' }), {
    ok: false,
    reason: 'platform',
  });

  // Login Twitch troppo corto e caratteri non ammessi.
  assert.deepEqual(normalizeStreamer({ platform: 'twitch', id: 'ab' }), {
    ok: false,
    reason: 'id',
    platform: 'twitch',
  });
  assert.deepEqual(normalizeStreamer({ platform: 'twitch', id: 'ciao mondo' }), {
    ok: false,
    reason: 'id',
    platform: 'twitch',
  });

  const conNome = normalizeStreamer({ platform: 'kick', id: 'Tizio-Caio', displayName: '  Tizio   Caio ' });
  assert.deepEqual(conNome.streamer, { platform: 'kick', id: 'tizio-caio', displayName: 'Tizio Caio' });
});

test('listStreamers al primo avvio parte dal config e lo fissa su disco', () => {
  assert.equal(fs.existsSync(storePath), false);

  const streamers = listStreamers(storePath);

  assert.equal(streamers.length, liveConfig.streamers.length);
  // Senza questa scrittura una rimozione tornerebbe indietro al riavvio.
  assert.equal(fs.existsSync(storePath), true);
  assert.deepEqual(readFile().streamers, streamers);
});

test('addStreamer salva, normalizza e rifiuta i duplicati', () => {
  saveStreamers([], storePath);

  const primo = addStreamer({ platform: 'twitch', id: 'https://www.twitch.tv/NuovoStreamer' }, storePath);
  assert.equal(primo.ok, true);
  assert.deepEqual(primo.streamer, { platform: 'twitch', id: 'nuovostreamer' });
  assert.equal(primo.total, 1);
  assert.deepEqual(readFile().streamers, [{ platform: 'twitch', id: 'nuovostreamer' }]);

  const doppio = addStreamer({ platform: 'twitch', id: 'NUOVOSTREAMER' }, storePath);
  assert.equal(doppio.ok, false);
  assert.equal(doppio.reason, 'duplicate');
  assert.equal(readFile().streamers.length, 1);

  // Stesso username su un'altra piattaforma e' un account diverso.
  const altraPiattaforma = addStreamer({ platform: 'kick', id: 'nuovostreamer' }, storePath);
  assert.equal(altraPiattaforma.ok, true);
  assert.equal(readFile().streamers.length, 2);

  const invalido = addStreamer({ platform: 'tiktok', id: 'a' }, storePath);
  assert.equal(invalido.ok, false);
  assert.equal(invalido.reason, 'id');
  assert.equal(readFile().streamers.length, 2);
});

test('addStreamer si ferma al tetto di account', () => {
  const pieni = Array.from({ length: MAX_STREAMERS }, (_, i) => ({
    platform: 'twitch',
    id: `streamer${String(i).padStart(3, '0')}`,
  }));
  saveStreamers(pieni, storePath);

  const result = addStreamer({ platform: 'twitch', id: 'unoditroppo' }, storePath);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'limit');
  assert.equal(result.limit, MAX_STREAMERS);
  assert.equal(readFile().streamers.length, MAX_STREAMERS);
});

test('removeStreamer toglie solo la voce indicata', () => {
  saveStreamers(
    [
      { platform: 'twitch', id: 'salvinosalvo', displayName: 'SalvinoSalvo' },
      { platform: 'kick', id: 'salvinosalvo' },
      { platform: 'tiktok', id: 'xx_cicci_xx' },
    ],
    storePath,
  );

  const result = removeStreamer({ platform: 'kick', id: 'https://kick.com/SalvinoSalvo' }, storePath);

  assert.equal(result.ok, true);
  assert.deepEqual(result.streamer, { platform: 'kick', id: 'salvinosalvo' });
  assert.equal(result.total, 2);
  assert.deepEqual(
    readFile().streamers.map(s => `${s.platform}:${s.id}`),
    ['twitch:salvinosalvo', 'tiktok:xx_cicci_xx'],
  );

  const assente = removeStreamer({ platform: 'kick', id: 'salvinosalvo' }, storePath);
  assert.equal(assente.ok, false);
  assert.equal(assente.reason, 'missing');

  const piattaformaIgnota = removeStreamer({ platform: 'youtube', id: 'tizio' }, storePath);
  assert.equal(piattaformaIgnota.reason, 'platform');
});

test('matchStreamers distingue le piattaforme e segnala le ambiguita', () => {
  const streamers = [
    { platform: 'twitch', id: 'salvinosalvo', displayName: 'SalvinoSalvo' },
    { platform: 'kick', id: 'salvinosalvo', displayName: 'SalvinoSalvo' },
    { platform: 'tiktok', id: 'xx_cicci_xx' },
  ];

  // Valore dell'autocomplete: una sola voce.
  assert.deepEqual(matchStreamers(streamers, 'kick:salvinosalvo'), [streamers[1]]);

  // Solo lo username: due candidati, il comando deve chiedere quale.
  assert.equal(matchStreamers(streamers, 'salvinosalvo').length, 2);

  // Link: risolto come username.
  assert.equal(matchStreamers(streamers, 'https://www.tiktok.com/@xx_cicci_xx').length, 1);

  // Ricerca parziale su nome e piattaforma (autocomplete mentre si scrive).
  assert.equal(matchStreamers(streamers, 'cicci').length, 1);
  assert.equal(matchStreamers(streamers, 'twitch').length, 1);
  assert.equal(matchStreamers(streamers, 'nessuno').length, 0);
  assert.equal(matchStreamers(streamers, '').length, 3);
});

test('loadStreamers scarta le voci corrotte invece di far cadere il bot', () => {
  fs.writeFileSync(storePath, '{ questo non e json', 'utf8');
  // File illeggibile: si ripiega sul seed del config.
  assert.equal(listStreamers(storePath).length, liveConfig.streamers.length);

  fs.writeFileSync(
    storePath,
    JSON.stringify({ streamers: [{ platform: 'twitch', id: 'valido_1' }, { platform: 'mixer', id: 'tizio' }, 42] }),
    'utf8',
  );
  assert.deepEqual(listStreamers(storePath), [{ platform: 'twitch', id: 'valido_1' }]);
});

test('saveStreamers scrive in modo atomico e non lascia temporanei in giro', () => {
  assert.equal(saveStreamers([{ platform: 'twitch', id: 'salvinosalvo' }], storePath), true);

  // Nessun file di appoggio dimenticato accanto allo store.
  assert.deepEqual(fs.readdirSync(tmpDir), ['live.json']);

  // Un errore di scrittura non lascia lo store a metà: il file precedente resta
  // valido e la funzione dice che non ha salvato.
  const dirComeFile = path.join(tmpDir, 'sottocartella');
  fs.mkdirSync(dirComeFile);
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal(saveStreamers([{ platform: 'kick', id: 'tizio' }], dirComeFile), false);
  } finally {
    console.error = originalError;
  }

  assert.deepEqual(readFile().streamers, [{ platform: 'twitch', id: 'salvinosalvo' }]);
  assert.deepEqual(fs.readdirSync(dirComeFile), []);
});

test('parseAccountInput riconosce la piattaforma del link incollato', () => {
  assert.deepEqual(parseAccountInput('https://www.twitch.tv/SalvinoSalvo'), {
    id: 'salvinosalvo',
    platform: 'twitch',
  });
  assert.deepEqual(parseAccountInput('https://www.tiktok.com/@xx_cicci_xx/live'), {
    id: 'xx_cicci_xx',
    platform: 'tiktok',
  });
  assert.deepEqual(parseAccountInput('kick.com/salvinosalvo'), {
    id: 'salvinosalvo',
    platform: 'kick',
  });
  // Username secco: nessuna piattaforma da dedurre.
  assert.deepEqual(parseAccountInput('@SalvinoSalvo'), { id: 'salvinosalvo', platform: null });
});

test('normalizeStreamer rifiuta il link di una piattaforma diversa da quella scelta', () => {
  // Lo username sarebbe valido anche su Twitch: senza il controllo sull'host
  // finirebbe in lista come twitch:salvinosalvo e il bot guarderebbe il
  // servizio sbagliato.
  assert.deepEqual(normalizeStreamer({ platform: 'twitch', id: 'https://kick.com/salvinosalvo' }), {
    ok: false,
    reason: 'mismatch',
    platform: 'twitch',
    detected: 'kick',
  });

  assert.equal(normalizeStreamer({ platform: 'kick', id: 'https://kick.com/salvinosalvo' }).ok, true);
});

test('resolveStreamers pretende un match esatto', () => {
  const streamers = [
    { platform: 'twitch', id: 'salvinosalvo', displayName: 'SalvinoSalvo' },
    { platform: 'kick', id: 'salvinosalvo' },
    { platform: 'tiktok', id: 'xx_cicci_xx' },
  ];

  // Valore dell'autocomplete e username esatto.
  assert.deepEqual(resolveStreamers(streamers, 'kick:salvinosalvo'), [streamers[1]]);
  assert.equal(resolveStreamers(streamers, 'salvinosalvo').length, 2);

  // Il link identifica anche la piattaforma.
  assert.deepEqual(resolveStreamers(streamers, 'https://kick.com/salvinosalvo'), [streamers[1]]);

  // Nessun match parziale: qui sta la differenza con matchStreamers, che
  // suggerisce e non cancella niente.
  assert.deepEqual(resolveStreamers(streamers, 'salvi'), []);
  assert.deepEqual(resolveStreamers(streamers, 'cicci'), []);
  assert.deepEqual(resolveStreamers(streamers, 'twitch'), []);
  assert.deepEqual(resolveStreamers(streamers, ''), []);
  assert.equal(matchStreamers(streamers, 'salvi').length, 2);
});

test('parseAccountInput accetta solo i link che sono davvero profili', () => {
  // Sezioni del sito: "1234567890" passerebbe come login Twitch valido.
  assert.deepEqual(parseAccountInput('https://www.twitch.tv/videos/1234567890'), {
    id: '',
    platform: 'twitch',
  });
  // Host che non ospita profili.
  assert.deepEqual(parseAccountInput('https://clips.twitch.tv/FancyClipSlug'), {
    id: '',
    platform: 'twitch',
  });
  // Su TikTok il profilo e' /@handle: un video non e' un account.
  assert.deepEqual(parseAccountInput('https://www.tiktok.com/video/7300000000000000000'), {
    id: '',
    platform: 'tiktok',
  });
  assert.deepEqual(parseAccountInput('https://kick.com/categories/gta-v'), {
    id: '',
    platform: 'kick',
  });
  // Dominio senza path: sappiamo la piattaforma, non il canale.
  assert.deepEqual(parseAccountInput('twitch.tv'), { id: '', platform: 'twitch' });

  // I link di profilo continuano a funzionare, anche con una sezione in coda.
  assert.deepEqual(parseAccountInput('https://m.twitch.tv/ydiablo93/videos'), {
    id: 'ydiablo93',
    platform: 'twitch',
  });
  assert.deepEqual(parseAccountInput('https://www.tiktok.com/@xx_cicci_xx/live'), {
    id: 'xx_cicci_xx',
    platform: 'tiktok',
  });
});

test('addStreamer rifiuta un link che non e\' un profilo', () => {
  saveStreamers([], storePath);

  const result = addStreamer(
    { platform: 'twitch', id: 'https://www.twitch.tv/videos/1234567890' },
    storePath,
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'id');
  assert.deepEqual(readFile().streamers, []);
});

test('parseAccountInput rifiuta le pagine del sito che sembrano nomi', () => {
  // "login" e "auth" passerebbero come username validi.
  assert.deepEqual(parseAccountInput('https://www.twitch.tv/login'), {
    id: '',
    platform: 'twitch',
  });
  assert.deepEqual(parseAccountInput('https://kick.com/auth/login'), {
    id: '',
    platform: 'kick',
  });
  assert.deepEqual(parseAccountInput('https://www.twitch.tv/settings/profile'), {
    id: '',
    platform: 'twitch',
  });
  // Path piu' profondo del canale: non e' un profilo.
  assert.deepEqual(parseAccountInput('https://kick.com/salvinosalvo/videos/123'), {
    id: '',
    platform: 'kick',
  });

  // Il canale e le sue sottopagine restano validi.
  assert.equal(parseAccountInput('https://www.twitch.tv/salvinosalvo').id, 'salvinosalvo');
  assert.equal(parseAccountInput('https://www.twitch.tv/salvinosalvo/videos').id, 'salvinosalvo');
  assert.equal(parseAccountInput('https://kick.com/salvinosalvo/clips').id, 'salvinosalvo');
});

test('resolveStreamers rifiuta un prefisso che contraddice il link', () => {
  const streamers = [
    { platform: 'twitch', id: 'foo_bar' },
    { platform: 'kick', id: 'foo_bar' },
  ];

  // Il prefisso dice Twitch, il link dice Kick: rimuovere "quello del prefisso"
  // vorrebbe dire togliere un account che l'utente non ha indicato.
  assert.deepEqual(resolveStreamers(streamers, 'twitch:https://kick.com/foo_bar'), []);

  // Prefisso e link d'accordo: risolve.
  assert.deepEqual(resolveStreamers(streamers, 'kick:https://kick.com/foo_bar'), [streamers[1]]);
});
