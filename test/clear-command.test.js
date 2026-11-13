'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { Collection } = require('discord.js');

const clear = require('../src/commands/slash/clear');

// Canale finto: `messaggi` va dal piu' recente al piu' vecchio come su Discord.
function fakeCanale(messaggi, { stantii = [] } = {}) {
  const vivi = new Map(messaggi.map(m => [m.id, m]));
  const fetch = [];
  const canale = {
    fetch,
    vivi,
    messages: {
      fetch: async ({ limit, before }) => {
        fetch.push(before);
        let elenco = messaggi.filter(m => vivi.has(m.id) || stantii.includes(m.id));
        if (before) elenco = elenco.slice(elenco.findIndex(m => m.id === before) + 1);
        return new Collection(elenco.slice(0, limit).map(m => [m.id, m]));
      },
      delete: async id => {
        if (!vivi.delete(id)) throw Object.assign(new Error('Unknown Message'), { code: 10008 });
      },
    },
    bulkDelete: async ids => {
      if (ids.some(id => !vivi.has(id))) throw Object.assign(new Error('Unknown Message'), { code: 10008 });
      for (const id of ids) vivi.delete(id);
    },
  };
  return canale;
}

const ora = Date.now();
const recente = i => ({ id: `m${String(i).padStart(5, '0')}`, createdTimestamp: ora - i * 1000 });

test('svuotaCanale elimina a blocchi scorrendo all\'indietro', async () => {
  const messaggi = Array.from({ length: 140 }, (_, i) => recente(i));
  const canale = fakeCanale(messaggi);
  assert.equal(await clear.svuotaCanale(canale), 140);
  assert.equal(canale.vivi.size, 0);
  assert.deepEqual(canale.fetch, [undefined, 'm00099']);
});

test('svuotaCanale elimina uno alla volta i messaggi piu\' vecchi di 14 giorni', async () => {
  const vecchio = id => ({ id, createdTimestamp: ora - 15 * 24 * 60 * 60 * 1000 });
  const canale = fakeCanale([recente(0), recente(1), vecchio('v1'), vecchio('v2')]);
  const bulk = [];
  const originale = canale.bulkDelete;
  canale.bulkDelete = async ids => { bulk.push(ids); return originale(ids); };
  assert.equal(await clear.svuotaCanale(canale), 4);
  assert.equal(canale.vivi.size, 0);
  assert.deepEqual(bulk, [['m00000', 'm00001']]);
});

test('svuotaCanale ignora un messaggio gia\' eliminato (errore 10008)', async () => {
  const fantasma = recente(0);
  const canale = fakeCanale([fantasma, recente(1)], { stantii: [fantasma.id] });
  canale.vivi.delete(fantasma.id);
  assert.equal(await clear.svuotaCanale(canale), 1);
  assert.equal(canale.vivi.size, 0);
});

test('svuotaCanale si ferma al tetto di sicurezza', async () => {
  const canale = fakeCanale(Array.from({ length: 6000 }, (_, i) => ({ id: `m${String(i).padStart(5, '0')}`, createdTimestamp: ora })));
  assert.equal(await clear.svuotaCanale(canale), 5000);
  assert.equal(canale.fetch.length, 50);
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
