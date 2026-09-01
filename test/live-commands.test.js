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
const originalWarn = console.warn;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kelp-live-cmd-'));
  storePath = path.join(tmpDir, 'live.json');
  // Il comando usa lo store di default: lo dirottiamo su una cartella usa e getta.
  process.env.LIVE_STORE_PATH = storePath;
  console.warn = () => {};
});

afterEach(() => {
  console.warn = originalWarn;
  if (originalStorePath === undefined) {
    delete process.env.LIVE_STORE_PATH;
  } else {
    process.env.LIVE_STORE_PATH = originalStorePath;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function listaSuDisco() {
  return JSON.parse(fs.readFileSync(storePath, 'utf8')).streamers.map(s => `${s.platform}:${s.id}`);
}

function fakeInteraction(sub, valori = {}) {
  const risposte = [];
  const suggerimenti = [];
  return {
    risposte,
    suggerimenti,
    replied: false,
    deferred: false,
    options: {
      getSubcommand: () => sub,
      getString: nome => valori[nome] ?? null,
      getFocused: () => valori.focused ?? '',
    },
    reply: async payload => {
      risposte.push(payload);
    },
    respond: async choices => {
      suggerimenti.push(...choices);
    },
  };
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
