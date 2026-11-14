'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const store = require('../src/lib/matricole-store');
const matricola = require('../src/commands/slash/matricola');

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'matricole-')), 'm.json');

test('assegna 4 cifre, non rigenera e trova in entrambi i versi', () => {
  const p = tmp();
  const a = store.assign('g', 'u1', p);
  assert.ok(a.ok && !a.existing && /^[1-9]\d{3}$/.test(a.numero));
  const again = store.assign('g', 'u1', p);
  assert.deepEqual(again, { ok: true, numero: a.numero, existing: true });
  assert.equal(store.getByUser('g', 'u1', p), a.numero);
  assert.equal(store.getByNumber('g', a.numero, p), 'u1');
  assert.equal(store.getByNumber('g', `#${a.numero}`, p), 'u1');
  assert.equal(store.getByNumber('g', '12', p), null);
});

test('mai lo stesso numero a due persone, anche con random sfortunato', () => {
  const p = tmp();
  const seen = new Set();
  for (let i = 0; i < 9000; i++) {
    const r = store.assign('g', `u${i}`, p, () => 0);
    assert.ok(r.ok);
    assert.ok(!seen.has(r.numero));
    seen.add(r.numero);
  }
  assert.deepEqual(store.assign('g', 'extra', p), { ok: false, reason: 'full' });
  // Server diverso: elenco indipendente.
  assert.ok(store.assign('g2', 'extra', p).ok);
});

test('store corrotto: errore invece di ripartire da vuoto', () => {
  const p = tmp();
  fs.writeFileSync(p, '{tronc');
  assert.throws(() => store.assign('g', 'u', p));
});

test('permessi: Alto comando o admin', () => {
  const fake = (roles, admin = false) => ({
    memberPermissions: { has: () => admin },
    member: { roles: { cache: new Map(roles.map(r => [r, {}])) } },
  });
  assert.equal(matricola.puoUsarlo(fake(['1527671086928498699'])), true);
  assert.equal(matricola.puoUsarlo(fake(['1527670632647495831'])), true);
  assert.equal(matricola.puoUsarlo(fake(['1527671588655333376'])), false);
  assert.equal(matricola.puoUsarlo(fake([], true)), true);
  assert.equal(matricola.puoUsarlo({ member: { roles: ['1527670988769067008'] } }), true);
});
