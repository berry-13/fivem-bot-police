'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const clear = require('../src/commands/slash/clear');

test('svuotaCanale elimina a blocchi finche\' un giro non rimuove nulla', async () => {
  const giri = [{ size: 100 }, { size: 40 }, { size: 0 }];
  const channel = { bulkDelete: async (n, filtro) => {
    assert.equal(n, 100);
    assert.equal(filtro, true);
    return giri.shift();
  } };

  assert.equal(await clear.svuotaCanale(channel), 140);
  assert.equal(giri.length, 0);
});

test('svuotaCanale si ferma al tetto di sicurezza', async () => {
  let chiamate = 0;
  const channel = { bulkDelete: async () => { chiamate++; return { size: 100 }; } };

  assert.equal(await clear.svuotaCanale(channel), 5000);
  assert.equal(chiamate, 50);
});

test('/clear richiede il permesso Gestire i messaggi', () => {
  assert.equal(clear.data.toJSON().default_member_permissions, String(1n << 13n));
});
