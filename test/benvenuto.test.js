'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const config = require('../src/config/benvenuto');
const { disegnaCard, inviaBenvenuto, messaggioBenvenuto, scegliFrase } = require('../src/lib/benvenuto');
const guildMemberAdd = require('../src/events/guildMemberAdd');

const isJpeg = buf => Buffer.isBuffer(buf) && buf[0] === 0xff && buf[1] === 0xd8;

test('la card esce per ogni frase, anche lunghissima', async () => {
  for (const frase of [...config.frasi, 'parola '.repeat(40).trim()]) {
    assert.ok(isJpeg(await disegnaCard({ frase })));
  }
});

test('scegliFrase pesca dalla lista', () => {
  assert.equal(scegliFrase(() => 0), config.frasi[0]);
  assert.equal(scegliFrase(() => 0.999), config.frasi.at(-1));
});

function fakeMember({ bot = false, canale, mancanti = [] } = {}) {
  const inviati = [];
  const channel = canale === null ? undefined : {
    name: 'benvenuto',
    isTextBased: () => true,
    permissionsFor: () => ({ missing: () => mancanti }),
    send: async payload => { inviati.push(payload); return payload; },
  };
  const member = {
    id: '42',
    user: { id: '42', bot, toString: () => '<@42>' },
    guild: {
      name: 'LSSD',
      iconURL: () => null,
      members: { me: {} },
      channels: { cache: new Map(channel ? [[config.channelId, channel]] : []) },
    },
  };
  return { member, inviati };
}

test('messaggio: ping solo al nuovo arrivato, card come allegato dell\'embed', async () => {
  const { member } = fakeMember();
  const msg = await messaggioBenvenuto(member);
  assert.equal(msg.content, '<@42>');
  assert.deepEqual(msg.allowedMentions, { users: ['42'] });
  const embed = msg.embeds[0].toJSON();
  assert.equal(embed.image.url, 'attachment://benvenuto.jpg');
  assert.equal(msg.files[0].name, 'benvenuto.jpg');
  assert.ok(isJpeg(msg.files[0].attachment));
  for (const p of config.passi) assert.ok(embed.description.includes(`<#${p.channelId}>`));
});

test('niente benvenuto a bot, senza canale o senza permessi', async () => {
  for (const opts of [{ bot: true }, { canale: null }, { mancanti: ['AttachFiles'] }]) {
    const { member, inviati } = fakeMember(opts);
    assert.equal(await inviaBenvenuto(member), null);
    assert.equal(inviati.length, 0);
  }
  const { member, inviati } = fakeMember();
  await inviaBenvenuto(member);
  assert.equal(inviati.length, 1);
});

test('guildMemberAdd non si blocca se il benvenuto fallisce', async () => {
  const { member } = fakeMember({ bot: true });
  member.guild.channels.cache = { get: () => { throw new Error('boom'); } };
  await guildMemberAdd.execute(member);
});
