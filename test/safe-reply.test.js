'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  isDeadInteractionError,
  safeDeferReply,
  safeInteractionReply,
  safeReply,
} = require('../src/lib/safe-reply');

const originalError = console.error;

beforeEach(() => {
  // I test provocano errori di proposito: silenziamo il log per non sporcare
  // l'output, ma teniamo traccia delle chiamate.
  console.error = () => {};
});

afterEach(() => {
  console.error = originalError;
});

test('safeReply inoltra il payload al messaggio', async () => {
  const inviati = [];
  const message = { reply: async payload => inviati.push(payload) };

  await safeReply(message, 'ciao');

  assert.deepEqual(inviati, ['ciao']);
});

test('safeReply non propaga il rejection di reply', async () => {
  const message = {
    reply: async () => {
      throw new Error('Missing Permissions');
    },
  };

  await assert.doesNotReject(() => safeReply(message, 'ciao'));
});

test('safeInteractionReply usa reply quando l\'interazione e\' intatta', async () => {
  const chiamate = [];
  const interaction = {
    replied: false,
    deferred: false,
    reply: async () => chiamate.push('reply'),
    followUp: async () => chiamate.push('followUp'),
  };

  await safeInteractionReply(interaction, { content: 'ok' });

  assert.deepEqual(chiamate, ['reply']);
});

test('safeInteractionReply usa followUp se ha gia\' risposto', async () => {
  const chiamate = [];
  const interaction = {
    replied: true,
    deferred: false,
    reply: async () => chiamate.push('reply'),
    followUp: async () => chiamate.push('followUp'),
  };

  await safeInteractionReply(interaction, { content: 'ok' });

  assert.deepEqual(chiamate, ['followUp']);
});

test('safeInteractionReply usa editReply dopo un defer, per chiudere lo spinner', async () => {
  const chiamate = [];
  const interaction = {
    replied: false,
    deferred: true,
    reply: async () => chiamate.push('reply'),
    followUp: async () => chiamate.push('followUp'),
    editReply: async () => chiamate.push('editReply'),
  };

  await safeInteractionReply(interaction, { content: 'ok' });

  assert.deepEqual(chiamate, ['editReply']);
});

test('safeInteractionReply non propaga il rejection (interazione scaduta)', async () => {
  const interaction = {
    replied: false,
    deferred: false,
    reply: async () => {
      throw new Error('Unknown interaction');
    },
    followUp: async () => {},
  };

  await assert.doesNotReject(() => safeInteractionReply(interaction, { content: 'ok' }));
});

test('isDeadInteractionError riconosce 10062 e 40060', () => {
  assert.equal(isDeadInteractionError({ code: 10062 }), true);
  assert.equal(isDeadInteractionError({ code: 40060 }), true);
  assert.equal(isDeadInteractionError({ code: 50013 }), false);
  assert.equal(isDeadInteractionError(null), false);
});

test('safeDeferReply torna true se il defer riesce', async () => {
  let chiamato = false;
  const interaction = {
    deferReply: async () => {
      chiamato = true;
    },
  };

  assert.equal(await safeDeferReply(interaction, { flags: 64 }), true);
  assert.equal(chiamato, true);
});

test('safeDeferReply torna false e non rilancia su Unknown interaction', async () => {
  const interaction = {
    deferReply: async () => {
      const error = new Error('Unknown interaction');
      error.code = 10062;
      throw error;
    },
  };

  await assert.doesNotReject(async () => {
    assert.equal(await safeDeferReply(interaction), false);
  });
});
