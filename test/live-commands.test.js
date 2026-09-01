'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const live = require('../src/commands/slash/live');
const { saveStreamers } = require('../src/lib/live-store');

let tmpDir;
let storePath;
const originalStorePath = process.env.LIVE_STORE_PATH;
const originalChannelId = process.env.LIVE_CHANNEL_ID;
const originalWarn = console.warn;

function restoreEnv(key, value) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kelp-live-cmd-'));
  storePath = path.join(tmpDir, 'live.json');
  // Il comando usa lo store di default: lo dirottiamo su una cartella usa e getta.
  process.env.LIVE_STORE_PATH = storePath;
  // Con un canale configurato il comando controlla di essere nel server giusto.
  process.env.LIVE_CHANNEL_ID = 'chan-1';
  console.warn = () => {};
});

afterEach(() => {
  console.warn = originalWarn;
  restoreEnv('LIVE_STORE_PATH', originalStorePath);
  restoreEnv('LIVE_CHANNEL_ID', originalChannelId);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function listaSuDisco() {
  return JSON.parse(fs.readFileSync(storePath, 'utf8')).streamers.map(s => `${s.platform}:${s.id}`);
}

function fakeInteraction(sub, valori = {}, opzioni = {}) {
  const risposte = [];
  const suggerimenti = [];
  const dimenticati = [];
  const guildId = opzioni.guildId ?? 'guild-1';
  // Il canale delle notifiche decide quale server puo' gestire la lista.
  const liveChannel = 'liveChannel' in opzioni ? opzioni.liveChannel : { guildId: 'guild-1' };

  const interaction = {
    risposte,
    suggerimenti,
    dimenticati,
    replied: false,
    deferred: false,
    guildId,
    inGuild: () => opzioni.inGuild ?? true,
    client: {
      channels: {
        cache: { get: () => (opzioni.inCache === false ? undefined : liveChannel ?? undefined) },
        fetch: async () => {
          if (opzioni.fetchFallisce) throw new Error('Missing Access');
          return liveChannel;
        },
      },
      liveMonitor: {
        forget: streamer => dimenticati.push(streamer),
      },
    },
    options: {
      getSubcommand: () => sub,
      getString: nome => valori[nome] ?? null,
      getFocused: () => valori.focused ?? '',
    },
    deferReply: async () => {
      interaction.deferred = true;
    },
    editReply: async payload => {
      risposte.push(payload);
    },
    reply: async payload => {
      risposte.push(payload);
    },
    respond: async choices => {
      suggerimenti.push(...choices);
    },
  };

  return interaction;
}

test('/live aggiungi accetta il link del canale e salva su disco', async () => {
  saveStreamers([], storePath);

  const interaction = fakeInteraction('aggiungi', {
    piattaforma: 'twitch',
    account: 'https://www.twitch.tv/NuovoStreamer',
    nome: 'Nuovo Streamer',
  });

  await live.execute(interaction);

  assert.match(interaction.risposte[0].content, /^✅ Aggiunto \*\*Twitch\*\* Nuovo Streamer \(nuovostreamer\)/);
  assert.deepEqual(listaSuDisco(), ['twitch:nuovostreamer']);
});

test('/live aggiungi non duplica un account già in lista', async () => {
  saveStreamers([{ platform: 'kick', id: 'salvinosalvo' }], storePath);

  const interaction = fakeInteraction('aggiungi', {
    piattaforma: 'kick',
    account: 'https://kick.com/SalvinoSalvo',
  });

  await live.execute(interaction);

  assert.match(interaction.risposte[0].content, /già in lista/);
  assert.deepEqual(listaSuDisco(), ['kick:salvinosalvo']);
});

test('/live aggiungi rifiuta uno username impossibile per la piattaforma', async () => {
  saveStreamers([], storePath);

  const interaction = fakeInteraction('aggiungi', { piattaforma: 'twitch', account: 'ab' });

  await live.execute(interaction);

  assert.match(interaction.risposte[0].content, /Username non valido per Twitch/);
  assert.deepEqual(listaSuDisco(), []);
});

test('/live rimuovi toglie la voce scelta dai suggerimenti', async () => {
  saveStreamers(
    [
      { platform: 'twitch', id: 'salvinosalvo', displayName: 'SalvinoSalvo' },
      { platform: 'kick', id: 'salvinosalvo' },
    ],
    storePath,
  );

  const interaction = fakeInteraction('rimuovi', { account: 'kick:salvinosalvo' });

  await live.execute(interaction);

  assert.match(interaction.risposte[0].content, /^✅ Rimosso \*\*Kick\*\* salvinosalvo/);
  assert.deepEqual(listaSuDisco(), ['twitch:salvinosalvo']);
});

test('/live rimuovi con username ambiguo chiede la piattaforma e non tocca la lista', async () => {
  saveStreamers(
    [
      { platform: 'twitch', id: 'salvinosalvo' },
      { platform: 'kick', id: 'salvinosalvo' },
    ],
    storePath,
  );

  const interaction = fakeInteraction('rimuovi', { account: 'salvinosalvo' });

  await live.execute(interaction);

  assert.match(interaction.risposte[0].content, /corrisponde a 2 account/);
  assert.match(interaction.risposte[0].content, /`twitch:salvinosalvo`, `kick:salvinosalvo`/);
  assert.deepEqual(listaSuDisco(), ['twitch:salvinosalvo', 'kick:salvinosalvo']);
});

test('/live rimuovi avvisa se l\'account non e\' monitorato', async () => {
  saveStreamers([{ platform: 'twitch', id: 'salvinosalvo' }], storePath);

  const interaction = fakeInteraction('rimuovi', { account: 'tizio_random' });

  await live.execute(interaction);

  assert.match(interaction.risposte[0].content, /Nessun account in lista corrisponde/);
  assert.deepEqual(listaSuDisco(), ['twitch:salvinosalvo']);
});

test('/live lista raggruppa gli account per piattaforma', async () => {
  saveStreamers(
    [
      { platform: 'twitch', id: 'salvinosalvo', displayName: 'SalvinoSalvo' },
      { platform: 'twitch', id: 'ydiablo93' },
      { platform: 'tiktok', id: 'xx_cicci_xx' },
    ],
    storePath,
  );

  const interaction = fakeInteraction('lista');

  await live.execute(interaction);

  const embed = interaction.risposte[0].embeds[0].data;
  assert.equal(embed.fields.length, 2);
  assert.equal(embed.fields[0].name, 'Twitch (2)');
  assert.equal(
    embed.fields[0].value,
    '- [SalvinoSalvo](https://www.twitch.tv/salvinosalvo)\n- [ydiablo93](https://www.twitch.tv/ydiablo93)',
  );
  assert.equal(embed.fields[1].name, 'TikTok (1)');
  assert.match(embed.fields[1].value, /https:\/\/www\.tiktok\.com\/@xx_cicci_xx/);
});

test('/live lista con nessun account spiega come aggiungerne uno', async () => {
  saveStreamers([], storePath);

  const interaction = fakeInteraction('lista');

  await live.execute(interaction);

  assert.match(interaction.risposte[0].content, /\/live aggiungi/);
});

test('/live autocomplete suggerisce solo gli account in lista', async () => {
  saveStreamers(
    [
      { platform: 'twitch', id: 'salvinosalvo', displayName: 'SalvinoSalvo' },
      { platform: 'kick', id: 'salvinosalvo' },
      { platform: 'tiktok', id: 'xx_cicci_xx' },
    ],
    storePath,
  );

  const interaction = fakeInteraction('rimuovi', { focused: 'salvi' });

  await live.autocomplete(interaction);

  assert.deepEqual(interaction.suggerimenti, [
    { name: 'Twitch: SalvinoSalvo', value: 'twitch:salvinosalvo' },
    { name: 'Kick: salvinosalvo', value: 'kick:salvinosalvo' },
  ]);
});

test('/live aggiungi rifiuta il link di una piattaforma diversa da quella scelta', async () => {
  saveStreamers([], storePath);

  const interaction = fakeInteraction('aggiungi', {
    piattaforma: 'twitch',
    account: 'https://kick.com/salvinosalvo',
  });

  await live.execute(interaction);

  assert.match(interaction.risposte[0].content, /link e' di Kick, ma hai scelto Twitch/);
  assert.deepEqual(listaSuDisco(), []);
});

test('/live rimuovi non cancella niente con un valore parziale', async () => {
  saveStreamers([{ platform: 'twitch', id: 'salvinosalvo', displayName: 'SalvinoSalvo' }], storePath);

  // "salvi" e' l'unico match tollerante: rimuovere su questa base cancellerebbe
  // un account che nessuno ha indicato per davvero.
  const interaction = fakeInteraction('rimuovi', { account: 'salvi' });

  await live.execute(interaction);

  assert.match(interaction.risposte[0].content, /corrisponde esattamente/);
  assert.deepEqual(listaSuDisco(), ['twitch:salvinosalvo']);
});

test('/live rifiuta chi scrive da un altro server', async () => {
  saveStreamers([{ platform: 'twitch', id: 'salvinosalvo' }], storePath);

  // Bot su piu' server e comandi globali: l'admin del server B non deve poter
  // cambiare gli annunci del server A.
  const interaction = fakeInteraction(
    'rimuovi',
    { account: 'twitch:salvinosalvo' },
    { guildId: 'guild-2' },
  );

  await live.execute(interaction);

  assert.match(interaction.risposte[0].content, /configurate su un altro server/);
  assert.deepEqual(listaSuDisco(), ['twitch:salvinosalvo']);
});

test('/live rifiuta le interazioni fuori da un server', async () => {
  saveStreamers([{ platform: 'twitch', id: 'salvinosalvo' }], storePath);

  const interaction = fakeInteraction('lista', {}, { inGuild: false });

  await live.execute(interaction);

  assert.match(interaction.risposte[0].content, /solo in un server/);
});

test('/live autocomplete non suggerisce niente da un altro server', async () => {
  saveStreamers([{ platform: 'twitch', id: 'salvinosalvo' }], storePath);

  const interaction = fakeInteraction('rimuovi', { focused: '' }, { guildId: 'guild-2' });

  await live.autocomplete(interaction);

  assert.deepEqual(interaction.suggerimenti, []);
});

test('/live si blocca se non riesce a verificare il canale delle notifiche', async () => {
  saveStreamers([{ platform: 'twitch', id: 'salvinosalvo' }], storePath);

  // Canale fuori cache e fetch che fallisce: senza fail closed questa finestra
  // sarebbe il momento in cui un altro server puo' riscrivere la lista.
  const interaction = fakeInteraction(
    'rimuovi',
    { account: 'twitch:salvinosalvo' },
    { guildId: 'guild-2', inCache: false, fetchFallisce: true },
  );

  await live.execute(interaction);

  assert.match(interaction.risposte[0].content, /non riesco a risalire al server/i);
  assert.deepEqual(listaSuDisco(), ['twitch:salvinosalvo']);
});

test('/live autocomplete resta muto se il canale non e\' verificabile', async () => {
  saveStreamers([{ platform: 'twitch', id: 'salvinosalvo' }], storePath);

  const interaction = fakeInteraction(
    'rimuovi',
    { focused: '' },
    { inCache: false, liveChannel: null },
  );

  await live.autocomplete(interaction);

  assert.deepEqual(interaction.suggerimenti, []);
});

test('/live fa defer prima di andare a chiedere il canale a Discord', async () => {
  saveStreamers([], storePath);

  // Canale fuori cache: il controllo fa una fetch, e senza ack i 3 secondi
  // dell'interazione possono finire prima di qualunque risposta.
  const interaction = fakeInteraction(
    'lista',
    {},
    { inCache: false, liveChannel: { guildId: 'guild-1' } },
  );

  await live.execute(interaction);

  assert.equal(interaction.deferred, true);
  // Dopo il defer il messaggio si modifica: niente flag ephemeral di nuovo.
  assert.equal('flags' in interaction.risposte[0], false);
});

test('/live azzera lo stato del monitor su aggiunta e rimozione', async () => {
  saveStreamers([], storePath);

  const aggiunta = fakeInteraction('aggiungi', { piattaforma: 'kick', account: 'salvinosalvo' });
  await live.execute(aggiunta);
  assert.deepEqual(aggiunta.dimenticati, [{ platform: 'kick', id: 'salvinosalvo' }]);

  const rimozione = fakeInteraction('rimuovi', { account: 'kick:salvinosalvo' });
  await live.execute(rimozione);
  assert.deepEqual(rimozione.dimenticati, [{ platform: 'kick', id: 'salvinosalvo' }]);
});

test('/live non tocca la lista se Discord non riconosce l\'interazione', async () => {
  saveStreamers([{ platform: 'twitch', id: 'salvinosalvo' }], storePath);

  const originalError = console.error;
  console.error = () => {};

  // 10062: interazione già scaduta. Senza l'uscita anticipata la lista
  // cambierebbe senza che l'admin possa vedere nessuna conferma.
  const interaction = fakeInteraction('rimuovi', { account: 'twitch:salvinosalvo' });
  interaction.deferReply = async () => {
    const error = new Error('Unknown interaction');
    error.code = 10062;
    throw error;
  };

  try {
    await live.execute(interaction);
  } finally {
    console.error = originalError;
  }

  assert.deepEqual(interaction.risposte, []);
  assert.deepEqual(listaSuDisco(), ['twitch:salvinosalvo']);
});
