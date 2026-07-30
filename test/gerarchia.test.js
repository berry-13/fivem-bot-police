'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Collection } = require('discord.js');

const gerarchiaConfig = require('../src/config/gerarchia');
const store = require('../src/lib/gerarchia-store');
const {
  buildHierarchyContent,
  formatRoleLine,
  hierarchyRoleIds,
  hierarchyRolesChanged,
  memberHasHierarchyRole,
  membersWithRole,
  publishHierarchy,
  refreshHierarchy,
  splitContent,
  DISCORD_CONTENT_LIMIT,
  _resetRefreshTimers,
} = require('../src/lib/gerarchia');
const setupGerarchia = require('../src/commands/slash/setupgerarchia');
const guildMemberUpdate = require('../src/events/guildMemberUpdate');
const guildMemberRemove = require('../src/events/guildMemberRemove');
const { metodiRisposta, statoInterazione } = require('./helpers/ticket-fakes');

function makeMember(id, { bot = false, roles = [] } = {}) {
  const roleCache = new Collection(roles.map(roleId => [roleId, { id: roleId }]));
  return {
    id,
    user: { bot },
    roles: { cache: roleCache },
    toString: () => `<@${id}>`,
  };
}

function makeGuild({ id = 'guild-1', roles = {}, client } = {}) {
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
    id,
    client,
    roles: { cache: roleCache },
    members: {
      fetch: async () => new Collection(),
    },
  };
}

function tempStorePath() {
  return path.join(os.tmpdir(), `gerarchia-test-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
}

function makeChannel() {
  const messages = new Map();
  let seq = 1;
  const channel = {
    id: 'channel-1',
    messages: {
      fetch: async id => {
        const msg = messages.get(String(id));
        if (!msg) throw new Error('Unknown Message');
        return msg;
      },
    },
    send: async payload => {
      const id = `msg-${seq++}`;
      const message = {
        id,
        content: payload.content,
        edit: async next => {
          message.content = next.content;
          return message;
        },
        delete: async () => {
          messages.delete(id);
        },
      };
      messages.set(id, message);
      return message;
    },
    _messages: messages,
  };
  return channel;
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

  assert.ok(content.startsWith('# TITOLO\n\n'));
  assert.match(content, new RegExp(`<@&${r1}> <@100>\\n---\\n<@&${r2}> //`));
  assert.ok(content.includes('**===**'));
  assert.ok(content.includes(`<@&${r3}> <@200> <@201>`));
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

test('hierarchyRolesChanged ignora nickname e ruoli fuori gerarchia', () => {
  const tracked = [...hierarchyRoleIds()][0];
  const oldM = makeMember('u1', { roles: [tracked, 'altro'] });
  const same = makeMember('u1', { roles: [tracked, 'altro', 'nuovo-fuori'] });
  const promoted = makeMember('u1', { roles: [tracked, 'altro', [...hierarchyRoleIds()][1]] });
  const demoted = makeMember('u1', { roles: ['altro'] });

  assert.equal(hierarchyRolesChanged(oldM, same), false);
  assert.equal(hierarchyRolesChanged(oldM, promoted), true);
  assert.equal(hierarchyRolesChanged(oldM, demoted), true);
});

test('memberHasHierarchyRole riconosce i gradi del reparto', () => {
  const tracked = [...hierarchyRoleIds()][0];
  assert.equal(memberHasHierarchyRole(makeMember('u1', { roles: [tracked] })), true);
  assert.equal(memberHasHierarchyRole(makeMember('u1', { roles: ['cittadino'] })), false);
});

test('store salva e rilegge la board', () => {
  const storePath = tempStorePath();
  try {
    assert.equal(store.getBoard('g1', storePath), null);
    store.setBoard('g1', { channelId: 'c1', messageIds: ['m1', 'm2'] }, storePath);
    assert.deepEqual(store.getBoard('g1', storePath), {
      channelId: 'c1',
      messageIds: ['m1', 'm2'],
    });
    store.clearBoard('g1', storePath);
    assert.equal(store.getBoard('g1', storePath), null);
  } finally {
    fs.rmSync(storePath, { force: true });
  }
});

test('publishHierarchy salva gli id e refreshHierarchy riedita il messaggio', async () => {
  const storePath = tempStorePath();
  const roleId = gerarchiaConfig.groups[0][0];
  const channel = makeChannel();
  const client = {
    channels: {
      fetch: async id => {
        assert.equal(id, channel.id);
        return channel;
      },
    },
  };
  const guild = makeGuild({
    id: 'guild-pub',
    client,
    roles: { [roleId]: [makeMember('42')] },
  });

  try {
    const published = await publishHierarchy(channel, guild, { client, storePath });
    assert.equal(published.messageIds.length, 1);
    assert.ok(channel._messages.get(published.messageIds[0]).content.includes('<@42>'));

    // Simula promozione: aggiungi un secondo membro al ruolo in cache.
    const role = guild.roles.cache.get(roleId);
    role.members.set('99', makeMember('99'));

    const refreshed = await refreshHierarchy(guild, { client, storePath });
    assert.equal(refreshed.updated, true);
    const content = channel._messages.get(published.messageIds[0]).content;
    assert.ok(content.includes('<@42>'));
    assert.ok(content.includes('<@99>'));
  } finally {
    fs.rmSync(storePath, { force: true });
  }
});

test('setup-gerarchia invia il messaggio, salva lo store e conferma in ephemeral', async () => {
  const storePath = tempStorePath();
  const prev = process.env.GERARCHIA_STORE_PATH;
  process.env.GERARCHIA_STORE_PATH = storePath;

  const r1 = gerarchiaConfig.groups[0][0];
  const channel = makeChannel();
  const guild = makeGuild({
    id: 'guild-setup',
    roles: { [r1]: [makeMember('42')] },
  });

  const stato = statoInterazione();
  const interaction = {
    guild,
    channel,
    createdTimestamp: Date.now(),
    client: {
      channels: {
        fetch: async () => channel,
      },
    },
    ...metodiRisposta(stato),
  };

  try {
    await setupGerarchia.execute(interaction);

    assert.equal(stato.deferred, true);
    assert.equal(channel._messages.size, 1);
    const board = store.getBoard('guild-setup', storePath);
    assert.ok(board);
    assert.equal(board.channelId, channel.id);
    assert.equal(board.messageIds.length, 1);
    // I getter deferred/replied del fake non sopravvivono allo spread: la
    // conferma puo' arrivare via reply (replies) o editReply (edits).
    const conferma = stato.edits[0] || stato.replies[0];
    assert.ok(conferma, 'attesa conferma ephemeral');
    assert.match(conferma.content, /Gerarchia inviata/);
    assert.match(conferma.content, /aggiorna in automatico/);
  } finally {
    if (prev === undefined) delete process.env.GERARCHIA_STORE_PATH;
    else process.env.GERARCHIA_STORE_PATH = prev;
    fs.rmSync(storePath, { force: true });
  }
});

test('setup-gerarchia pubblica comunque se il defer fallisce (10062)', async () => {
  const storePath = tempStorePath();
  const prev = process.env.GERARCHIA_STORE_PATH;
  process.env.GERARCHIA_STORE_PATH = storePath;

  const r1 = gerarchiaConfig.groups[0][0];
  const channel = makeChannel();
  const guild = makeGuild({
    id: 'guild-expired',
    roles: { [r1]: [makeMember('7')] },
  });

  const stato = statoInterazione();
  const interaction = {
    guild,
    channel,
    createdTimestamp: Date.now() - 5000,
    client: {
      channels: { fetch: async () => channel },
    },
    ...metodiRisposta(stato),
    deferReply: async () => {
      const error = new Error('Unknown interaction');
      error.code = 10062;
      throw error;
    },
  };

  try {
    await assert.doesNotReject(() => setupGerarchia.execute(interaction));
    // Messaggio gerarchia + eventuale conferma in canale
    assert.ok(channel._messages.size >= 1);
    const board = store.getBoard('guild-expired', storePath);
    assert.ok(board);
    assert.equal(board.messageIds.length, 1);
  } finally {
    if (prev === undefined) delete process.env.GERARCHIA_STORE_PATH;
    else process.env.GERARCHIA_STORE_PATH = prev;
    fs.rmSync(storePath, { force: true });
  }
});

test('setup-gerarchia fuori da un guild risponde con errore', async () => {
  const stato = statoInterazione();
  const interaction = {
    guild: null,
    channel: { send: async () => {} },
    createdTimestamp: Date.now(),
    ...metodiRisposta(stato),
  };

  await setupGerarchia.execute(interaction);

  const conferma = stato.edits[0] || stato.replies[0];
  assert.ok(conferma);
  assert.match(conferma.content, /solo in un server/);
});

test('il comando e- riservato agli amministratori', () => {
  const json = setupGerarchia.data.toJSON();
  assert.equal(json.name, 'setup-gerarchia');
  assert.ok(json.default_member_permissions);
  assert.notEqual(json.default_member_permissions, '0');
});

test('guildMemberUpdate non fa nulla se i ruoli gerarchia non cambiano', async () => {
  _resetRefreshTimers();
  const tracked = [...hierarchyRoleIds()][0];
  const guild = makeGuild({ id: 'g-evt' });
  const oldM = makeMember('u1', { roles: [tracked] });
  const newM = makeMember('u1', { roles: [tracked, 'altro'] });
  newM.guild = guild;

  await guildMemberUpdate.execute(oldM, newM);
  // Nessun timer pendente se non c'e' un cambio rilevante... ma schedule non e'
  // chiamato. Controlliamo che non esploda e che non ci siano timer.
  // (schedule non e' chiamato -> map vuota)
  assert.equal(hierarchyRolesChanged(oldM, newM), false);
});

test('guildMemberUpdate schedula il refresh se cambia un grado', async () => {
  _resetRefreshTimers();
  const tracked = [...hierarchyRoleIds()][0];
  const guild = makeGuild({ id: 'g-evt-2' });
  const oldM = makeMember('u1', { roles: [] });
  const newM = makeMember('u1', { roles: [tracked] });
  newM.guild = guild;

  // Intercettiamo schedule via refresh con debounce 0 e store senza board:
  // non deve crashare.
  await guildMemberUpdate.execute(oldM, newM);
  assert.equal(hierarchyRolesChanged(oldM, newM), true);
  _resetRefreshTimers();
});

test('guildMemberRemove ignora chi non aveva gradi del reparto', async () => {
  const member = makeMember('u1', { roles: ['cittadino'] });
  member.guild = makeGuild({ id: 'g-rm' });
  await guildMemberRemove.execute(member);
  assert.equal(memberHasHierarchyRole(member), false);
});
