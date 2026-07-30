'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Collection } = require('discord.js');

const gerarchiaConfig = require('../src/config/gerarchia');
const {
  buildHierarchyContent,
  formatRoleLine,
  membersWithRole,
  splitContent,
  DISCORD_CONTENT_LIMIT,
} = require('../src/lib/gerarchia');
const setupGerarchia = require('../src/commands/slash/setupgerarchia');
const { metodiRisposta, statoInterazione } = require('./helpers/ticket-fakes');

function makeMember(id, { bot = false } = {}) {
  return {
    id,
    user: { bot },
    toString: () => `<@${id}>`,
  };
}

function makeGuild({ roles = {} } = {}) {
  // roles: { roleId: [member, ...] }
  const roleCache = new Collection();
  for (const [roleId, members] of Object.entries(roles)) {
    const memberCache = new Collection(members.map(m => [m.id, m]));
    roleCache.set(roleId, {
      id: roleId,
      members: memberCache,
    });
  }

  return {
    roles: { cache: roleCache },
    members: {
      fetch: async () => new Collection(),
    },
  };
}

test('formatRoleLine: ruolo vuoto usa il placeholder //', () => {
  assert.equal(formatRoleLine('111', []), '<@&111> //');
});

test('formatRoleLine: ruolo con membri elenca i ping', () => {
  assert.equal(
    formatRoleLine('111', ['aaa', 'bbb']),
    '<@&111> <@aaa> <@bbb>',
  );
});

test('membersWithRole esclude i bot', () => {
  const guild = makeGuild({
    roles: {
      '111': [makeMember('u1'), makeMember('bot1', { bot: true }), makeMember('u2')],
    },
  });

  assert.deepEqual(membersWithRole(guild, '111'), ['u1', 'u2']);
  assert.deepEqual(membersWithRole(guild, 'inesistente'), []);
});

test('buildHierarchyContent rispetta gruppi, separatori e footer', () => {
  const r1 = '1527670632647495831';
  const r2 = '1527670734615351348';
  const r3 = '1527671139600568430';
  const footer = '1527672537012637886';

  const guild = makeGuild({
    roles: {
      [r1]: [makeMember('100')],
      [r2]: [],
      [r3]: [makeMember('200'), makeMember('201')],
      [footer]: [makeMember('999')],
    },
  });

  const content = buildHierarchyContent(guild, {
    title: '# TITOLO',
    separator: '---',
    groupSeparator: '**===**',
    groups: [[r1, r2], [r3]],
    footerRoles: [footer],
  });

  // Titolo in cima
  assert.ok(content.startsWith('# TITOLO\n\n'));

  // Primo gruppo: ruolo pieno, separatore, ruolo vuoto
  assert.match(content, new RegExp(`<@&${r1}> <@100>\\n---\\n<@&${r2}> //`));

  // Separatore di gruppo in grassetto
  assert.ok(content.includes('**===**'));

  // Secondo gruppo con due membri
  assert.ok(content.includes(`<@&${r3}> <@200> <@201>`));

  // Footer solo come menzione ruolo (senza lista membri)
  assert.ok(content.trimEnd().endsWith(`<@&${footer}>`));
});

test('buildHierarchyContent con la config di produzione produce il layout atteso', () => {
  const top = gerarchiaConfig.groups[0][0];
  const empty = gerarchiaConfig.groups[0][1];
  const footer = gerarchiaConfig.footerRoles[0];

  const guild = makeGuild({
    roles: {
      [top]: [makeMember('1369337840198226033')],
      [empty]: [],
    },
  });

  const content = buildHierarchyContent(guild);

  assert.ok(content.startsWith(gerarchiaConfig.title));
  assert.ok(content.includes(`<@&${top}> <@1369337840198226033>`));
  assert.ok(content.includes(`<@&${empty}> //`));
  assert.ok(content.includes(gerarchiaConfig.groupSeparator));
  assert.ok(content.includes(gerarchiaConfig.separator));
  assert.ok(content.includes(`<@&${footer}>`));
});

test('splitContent non spezza sotto il limite', () => {
  assert.deepEqual(splitContent('ciao'), ['ciao']);
});

test('splitContent spezza sulle righe se supera il limite', () => {
  const parts = splitContent('aaa\nbbb\nccc', 7);
  assert.deepEqual(parts, ['aaa\nbbb', 'ccc']);
  for (const p of parts) {
    assert.ok(p.length <= 7);
  }
});

test('splitContent spezza a forza una riga più lunga del limite', () => {
  const long = 'x'.repeat(DISCORD_CONTENT_LIMIT + 50);
  const parts = splitContent(long);
  assert.ok(parts.length >= 2);
  assert.equal(parts.join(''), long);
  for (const p of parts) {
    assert.ok(p.length <= DISCORD_CONTENT_LIMIT);
  }
});

test('setup-gerarchia invia il messaggio e conferma in ephemeral', async () => {
  const r1 = gerarchiaConfig.groups[0][0];
  const guild = makeGuild({
    roles: {
      [r1]: [makeMember('42')],
    },
  });

  const inviati = [];
  const stato = statoInterazione();
  const interaction = {
    guild,
    channel: {
      send: async payload => {
        inviati.push(payload);
        return payload;
      },
    },
    ...metodiRisposta(stato),
  };

  await setupGerarchia.execute(interaction);

  assert.equal(stato.deferred, true);
  assert.equal(inviati.length, 1);
  assert.ok(inviati[0].content.includes(gerarchiaConfig.title));
  assert.ok(inviati[0].content.includes(`<@&${r1}> <@42>`));
  // Nessun ping reale: allowedMentions vuoto
  assert.deepEqual(inviati[0].allowedMentions, { parse: [] });
  assert.match(stato.edits[0].content, /Gerarchia inviata/);
});

test('setup-gerarchia fuori da un guild risponde con errore', async () => {
  const stato = statoInterazione();
  const interaction = {
    guild: null,
    channel: { send: async () => {} },
    ...metodiRisposta(stato),
  };

  await setupGerarchia.execute(interaction);

  assert.match(stato.edits[0].content, /solo in un server/);
});

test('il comando e- riservato agli amministratori', () => {
  const json = setupGerarchia.data.toJSON();
  assert.equal(json.name, 'setup-gerarchia');
  // default_member_permissions e' una stringa bitmask in discord.js
  assert.ok(json.default_member_permissions);
  assert.notEqual(json.default_member_permissions, '0');
});

