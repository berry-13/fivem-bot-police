'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Collection } = require('discord.js');

const config = require('../src/config/reparti');
const {
  _resetReparti,
  buildRepartoContent,
  getBoard,
  memberHasRepartoRole,
  refreshReparti,
  repartiRolesChanged,
  trackedRoleIds,
} = require('../src/lib/reparti');

const BOARD = {
  key: 'prova',
  channelId: 'chan-1',
  title: '# **REPARTI PROVA**',
  groups: [
    { roles: ['r1', 'r2'] },
    { roles: ['r3'], footer: 'f3' },
  ],
};

function member(id, roles = [], bot = false) {
  return { id, user: { bot }, roles: { cache: new Collection(roles.map(r => [r, { id: r }])) } };
}

function makeGuild(roleMembers, client) {
  const roles = new Collection();
  const members = new Collection();
  for (const [roleId, list] of Object.entries(roleMembers)) {
    roles.set(roleId, { id: roleId, members: new Collection(list.map(m => [m.id, m])) });
    for (const m of list) members.set(m.id, m);
  }
  return {
    id: 'guild-1',
    client,
    memberCount: members.size,
    roles: { cache: roles },
    members: { cache: members, fetch: async () => members },
  };
}

function makeChannel() {
  const messages = new Map();
  let next = 1;
  const channel = {
    id: 'chan-1',
    guildId: 'guild-1',
    isTextBased: () => true,
    sent: 0,
    edited: 0,
    messages: {
      fetch: async id => {
        const msg = messages.get(id);
        if (!msg) throw Object.assign(new Error('Unknown Message'), { code: 10008 });
        return msg;
      },
    },
    send: async ({ content }) => {
      channel.sent++;
      const msg = {
        id: `m${next++}`,
        content,
        edit: async ({ content: c }) => { channel.edited++; msg.content = c; },
        delete: async () => { messages.delete(msg.id); },
      };
      messages.set(msg.id, msg);
      return msg;
    },
    _messages: messages,
  };
  return channel;
}

function tmpStore() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reparti-')), 'reparti.json');
}

test.afterEach(() => _resetReparti());

test('buildRepartoContent: stesso formato dei messaggi a mano', () => {
  const guild = makeGuild({ r1: [member('u1'), member('bot', [], true)], r3: [member('u2'), member('u3')] });
  const sep = config.separator;
  assert.equal(
    buildRepartoContent(guild, BOARD),
    [
      '# **REPARTI PROVA**',
      sep,
      '- <@&r1> <@u1>\n- <@&r2> //',
      sep,
      '- <@&r3> <@u2> <@u3>',
      '- <@&f3>',
    ].join('\n\n'),
  );
});

test('buildRepartoContent: gruppo con solo il ruolo di reparto', () => {
  const guild = makeGuild({});
  const board = { title: '', groups: [{ roles: ['r1'] }, { roles: [], footer: 'f9' }] };
  assert.equal(buildRepartoContent(guild, board), ['- <@&r1> //', config.separator, '- <@&f9>'].join('\n\n'));
});

test('refreshReparti: pubblica la prima volta, poi edita lo stesso messaggio', async () => {
  const channel = makeChannel();
  const client = { channels: { fetch: async () => channel } };
  const r1 = [member('u1')];
  const guild = makeGuild({ r1 }, client);
  const storePath = tmpStore();

  await refreshReparti(guild, { boards: [BOARD], storePath });
  assert.equal(channel.sent, 1);
  const saved = getBoard('guild-1', 'prova', storePath);
  assert.deepEqual(saved, { channelId: 'chan-1', messageIds: ['m1'] });

  // Nessun cambio: niente edit inutili.
  await refreshReparti(guild, { boards: [BOARD], storePath });
  assert.equal(channel.sent, 1);
  assert.equal(channel.edited, 0);

  guild.roles.cache.get('r1').members.set('u9', member('u9'));
  await refreshReparti(guild, { boards: [BOARD], storePath });
  assert.equal(channel.sent, 1);
  assert.equal(channel.edited, 1);
  assert.match(channel._messages.get('m1').content, /<@&r1> <@u1> <@u9>/);
});

test('refreshReparti: messaggio cancellato a mano -> ne manda uno nuovo', async () => {
  const channel = makeChannel();
  const client = { channels: { fetch: async () => channel } };
  const guild = makeGuild({}, client);
  const storePath = tmpStore();

  await refreshReparti(guild, { boards: [BOARD], storePath });
  channel._messages.clear();
  await refreshReparti(guild, { boards: [BOARD], storePath });
  assert.equal(channel.sent, 2);
  assert.deepEqual(getBoard('guild-1', 'prova', storePath).messageIds, ['m2']);
});

test('repartiRolesChanged / memberHasRepartoRole guardano anche il footer', () => {
  const before = member('u1', ['altro']);
  assert.equal(repartiRolesChanged(before, member('u1', ['altro', 'f3']), [BOARD]), true);
  assert.equal(repartiRolesChanged(before, member('u1', ['altro', 'x']), [BOARD]), false);
  assert.equal(memberHasRepartoRole(member('u1', ['r2']), [BOARD]), true);
  assert.equal(memberHasRepartoRole(member('u1', ['x']), [BOARD]), false);
});

test('config reparti: ruoli unici per lista e canale impostato', () => {
  for (const board of config.boards) {
    assert.ok(board.key && /^\d+$/.test(board.channelId));
    const all = board.groups.flatMap(g => [...g.roles, ...(g.footer ? [g.footer] : [])]);
    assert.equal(new Set(all).size, all.length, `ruolo duplicato in ${board.key}`);
  }
  assert.ok(trackedRoleIds().size > 0);
});
