'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { registerShutdown } = require('../src/lib/shutdown');

const originalLog = console.log;
const originalError = console.error;

beforeEach(() => {
  console.log = () => {};
  console.error = () => {};
});

afterEach(() => {
  console.log = originalLog;
  console.error = originalError;
});

/** Finto process che registra i listener e le chiamate a exit. */
function fakeProc() {
  return {
    listeners: {},
    exitCodes: [],
    on(signal, handler) {
      this.listeners[signal] = handler;
    },
    exit(code) {
      this.exitCodes.push(code);
    },
  };
}

test('registerShutdown si aggancia a SIGINT e SIGTERM', () => {
  const proc = fakeProc();

  registerShutdown({ destroy: async () => {} }, { proc });

  assert.deepEqual(Object.keys(proc.listeners).sort(), ['SIGINT', 'SIGTERM']);
});

test('alla ricezione del segnale chiude il client e poi esce con 0', async () => {
  const proc = fakeProc();
  let distrutto = 0;

  const handle = registerShutdown({ destroy: async () => { distrutto += 1; } }, { proc });
  await handle('SIGTERM');

  assert.equal(distrutto, 1);
  assert.deepEqual(proc.exitCodes, [0]);
});

test('un secondo segnale non riavvia la procedura di chiusura', async () => {
  const proc = fakeProc();
  let distrutto = 0;

  const handle = registerShutdown({ destroy: async () => { distrutto += 1; } }, { proc });
  await handle('SIGTERM');
  await handle('SIGINT');

  assert.equal(distrutto, 1);
  assert.deepEqual(proc.exitCodes, [0]);
});

test('se destroy fallisce il processo esce comunque', async () => {
  const proc = fakeProc();

  const handle = registerShutdown(
    { destroy: async () => { throw new Error('websocket gia\' chiusa'); } },
    { proc },
  );

  await assert.doesNotReject(() => handle('SIGTERM'));
  assert.deepEqual(proc.exitCodes, [0]);
});
