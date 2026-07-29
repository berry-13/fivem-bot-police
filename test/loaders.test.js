'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  loadModules,
  loadSlashCommands,
  loadPrefixCommands,
  loadEvents,
  validateSlashCommand,
  validatePrefixCommand,
} = require('../src/lib/loaders');

/** Crea una cartella temporanea con i moduli indicati e la registra per la pulizia. */
function fixtureDir(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-loader-'));
  for (const [name, source] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), source);
  }
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('loadModules restituisce liste vuote se la cartella non esiste', () => {
  const { loaded, problems } = loadModules('/percorso/che/non/esiste', () => null);

  assert.deepEqual(loaded, []);
  assert.deepEqual(problems, []);
});

test('loadModules segnala i moduli non validi invece di saltarli in silenzio', t => {
  const dir = fixtureDir(t, {
    'buono.js': 'module.exports = { name: "buono", execute() {} };',
    'senza-nome.js': 'module.exports = { execute() {} };',
    'note.txt': 'questo file non e\' un modulo',
  });

  const { loaded, problems } = loadModules(dir, validatePrefixCommand);

  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].name, 'buono');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /senza-nome\.js: manca "name"/);
});

test('loadModules cattura i moduli che esplodono al require', t => {
  const dir = fixtureDir(t, {
    'buono.js': 'module.exports = { name: "buono", execute() {} };',
    'rotto.js': 'throw new Error("boom");',
  });

  const { loaded, problems } = loadModules(dir, validatePrefixCommand);

  assert.equal(loaded.length, 1);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /rotto\.js: impossibile caricare il modulo \(boom\)/);
});

test('validateSlashCommand pretende un data con toJSON e un execute', () => {
  assert.match(validateSlashCommand({ execute() {} }), /manca "data"/);
  assert.match(validateSlashCommand({ data: { name: 'x' } }), /non e' un SlashCommandBuilder/);
  assert.match(
    validateSlashCommand({ data: { name: 'x', toJSON: () => ({}) } }),
    /manca "execute"/,
  );
  assert.equal(
    validateSlashCommand({ data: { name: 'x', toJSON: () => ({}) }, execute() {} }),
    null,
  );
});

test('i comandi e gli eventi reali del progetto si caricano senza problemi', () => {
  const slash = loadSlashCommands();
  const prefix = loadPrefixCommands();
  const events = loadEvents();

  assert.deepEqual(slash.problems, []);
  assert.deepEqual(prefix.problems, []);
  assert.deepEqual(events.problems, []);

  assert.ok(slash.loaded.some(command => command.data.name === 'ping'));
  assert.ok(prefix.loaded.some(command => command.name === 'ping'));
  assert.ok(events.loaded.some(event => event.name === 'clientReady'));
});
