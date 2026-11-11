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

function fakeInteraction({ perms, channelId = 'c1' }) {
  const risposte = [];
  return {
    risposte,
    guild: { id: 'g-clear', members: { me: {} } },
    channel: { id: channelId, bulkDelete: async () => ({ size: 0 }), permissionsFor: () => ({ missing: () => [] }) },
    memberPermissions: { has: bit => perms.includes(bit) },
    deferred: false,
    replied: false,
    reply: async p => risposte.push(p),
    deferReply: async () => {},
    editReply: async p => risposte.push(p),
  };
}

test('/clear rifiuta chi non ha Gestire i messaggi nel canale', async () => {
  const i = fakeInteraction({ perms: [] });
  await clear.execute(i);
  assert.match(i.risposte[0].content, /Gestire i messaggi/);
});

test('/clear in un canale di log richiede Amministratore', async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const store = require('../src/lib/logs-store');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clear-'));
  const file = path.join(dir, 'logs.json');
  store.setChannel('g-clear', 'messaggi', 'chan-log', file);
  const prima = process.env.LOGS_STORE_PATH;
  process.env.LOGS_STORE_PATH = file;
  store._resetCache();
  try {
    const { PermissionFlagsBits } = require('discord.js');
    const i = fakeInteraction({ perms: [PermissionFlagsBits.ManageMessages], channelId: 'chan-log' });
    await clear.execute(i);
    assert.match(i.risposte[0].content, /amministratore/);
  } finally {
    if (prima === undefined) delete process.env.LOGS_STORE_PATH;
    else process.env.LOGS_STORE_PATH = prima;
    store._resetCache();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
