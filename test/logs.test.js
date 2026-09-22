'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { AuditLogEvent, ChannelType, Collection, MessageFlags, PermissionFlagsBits } = require('discord.js');

const store = require('../src/lib/logs-store');
const logs = require('../src/lib/logs');
const setupLog = require('../src/commands/slash/setuplog');
const { validateSlashCommand } = require('../src/lib/loaders');
const { creaScheda, testoScheda, LIMITE_TESTO_TOTALE } = require('../src/lib/log-card');

const GUILD_ID = 'guild-1';
const BOT_ID = 'bot-1';

let tmpDir;
const originalWarn = console.warn;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logs-test-'));
  process.env.LOGS_STORE_PATH = path.join(tmpDir, 'logs.json');
  store._resetCache();
  logs._resetState();
  console.warn = () => {};
});

afterEach(() => {
  delete process.env.LOGS_STORE_PATH;
  store._resetCache();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.warn = originalWarn;
});

function fakeChannel(id, { sendImpl, type = ChannelType.GuildText, name = id, parentId = null } = {}) {
  const inviati = [];
  return {
    id,
    name,
    type,
    parentId,
    inviati,
    isTextBased: () => type !== ChannelType.GuildCategory,
    send: sendImpl ?? (async payload => inviati.push(payload)),
    toString: () => `<#${id}>`,
  };
}

function fakeGuild({ channels = [], auditEntries = [], permessi = [PermissionFlagsBits.ViewAuditLog] } = {}) {
  const cache = new Collection(channels.map(c => [c.id, c]));
  const creati = [];
  return {
    id: GUILD_ID,
    name: 'Server di test',
    memberCount: 42,
    creati,
    client: { user: { id: BOT_ID }, users: { fetch: async id => ({ id, tag: `user-${id}` }) } },
    roles: { everyone: { id: GUILD_ID }, cache: new Collection() },
    members: {
      me: {
        id: BOT_ID,
        permissions: {
          has: p => permessi.includes(p),
          missing: richiesti => richiesti.filter(p => !permessi.includes(p)).map(String),
        },
      },
    },
    channels: {
      cache,
      fetch: async id => {
        if (!cache.has(id)) throw new Error('Unknown Channel');
        return cache.get(id);
      },
      create: async opzioni => {
        const channel = fakeChannel(`creato-${creati.length}`, {
          type: opzioni.type,
          name: opzioni.name,
          parentId: opzioni.parent ?? null,
        });
        creati.push(opzioni);
        cache.set(channel.id, channel);
        return channel;
      },
    },
    fetchAuditLogs: async () => ({ entries: new Collection(auditEntries.map(e => [e.id, e])) }),
  };
}

function fakeMessage(guild, overrides = {}) {
  return {
    id: 'msg-1',
    guild,
    channelId: 'generale',
    partial: false,
    system: false,
    webhookId: null,
    content: 'ciao a tutti',
    createdAt: new Date(),
    createdTimestamp: Date.now(),
    editedTimestamp: null,
    url: 'https://discord.com/channels/guild-1/generale/msg-1',
    attachments: new Collection(),
    author: { id: 'user-1', tag: 'mario', bot: false, displayAvatarURL: () => 'https://cdn/avatar.png' },
    ...overrides,
  };
}

const testo = payload => testoScheda(payload);

/* ---------------------------------------------------------------- store */

test('lo store salva, rilegge e rimuove i canali per server', () => {
  store.setChannel(GUILD_ID, 'messaggi', '111');
  store.setChannel(GUILD_ID, 'voce', '222');
  store._resetCache();

  assert.deepEqual(store.getChannels(GUILD_ID), { messaggi: '111', voce: '222' });
  assert.equal(store.removeChannel(GUILD_ID, 'voce'), true);
  assert.equal(store.removeChannel(GUILD_ID, 'voce'), false);
  assert.equal(store.getChannelId(GUILD_ID, 'voce'), null);
  assert.equal(store.getChannelId('altro-server', 'messaggi'), null);
});

test('uno store corrotto spegne i log invece di lanciare', () => {
  fs.writeFileSync(process.env.LOGS_STORE_PATH, '{non json');
  assert.deepEqual(store.getChannels(GUILD_ID), {});
});

/* ------------------------------------------------------------- sendLog */

test('sendLog non fa nulla se il tipo non e\' configurato', async () => {
  const canale = fakeChannel('log-msg');
  const guild = fakeGuild({ channels: [canale] });

  assert.equal(await logs.sendLog(guild, 'messaggi', { content: 'x' }), false);
  assert.equal(canale.inviati.length, 0);
});

test('sendLog manda nel canale configurato senza ping', async () => {
  const canale = fakeChannel('log-msg');
  const guild = fakeGuild({ channels: [canale] });
  store.setChannel(GUILD_ID, 'messaggi', 'log-msg');

  assert.equal(await logs.sendLog(guild, 'messaggi', { content: '<@&123>' }), true);
  assert.deepEqual(canale.inviati[0].allowedMentions, { parse: [] });
});

test('sendLog non lancia se il canale e\' stato eliminato o la send fallisce', async () => {
  const rotto = fakeChannel('log-rotto', {
    sendImpl: async () => {
      throw new Error('Missing Permissions');
    },
  });
  const guild = fakeGuild({ channels: [rotto] });
  store.setChannel(GUILD_ID, 'messaggi', 'log-rotto');
  store.setChannel(GUILD_ID, 'voce', 'cancellato');

  assert.equal(await logs.sendLog(guild, 'messaggi', { content: 'x' }), false);
  assert.equal(await logs.sendLog(guild, 'voce', { content: 'x' }), false);
});

/* ------------------------------------------------------------ messaggi */

test('un messaggio eliminato viene loggato con autore, canale e contenuto', async () => {
  const canale = fakeChannel('log-msg');
  const guild = fakeGuild({ channels: [canale] });
  store.setChannel(GUILD_ID, 'messaggi', 'log-msg');

  await logs.logMessageDelete(fakeMessage(guild), { attesaMs: 0 });

  const payload = canale.inviati[0];
  assert.equal(payload.flags, MessageFlags.IsComponentsV2);
  assert.equal(payload.embeds, undefined);
  const t = testo(payload);
  assert.match(t, /### Messaggio eliminato/);
  assert.match(t, /> ciao a tutti/);
  assert.match(t, /\*\*Autore:\*\* <@user-1>/);
  assert.match(t, /\*\*Canale:\*\* <#generale>/);
});

test('i messaggi eliminati nei canali di log e quelli dei bot non vengono loggati', async () => {
  const canale = fakeChannel('log-msg');
  const guild = fakeGuild({ channels: [canale] });
  store.setChannel(GUILD_ID, 'messaggi', 'log-msg');

  await logs.logMessageDelete(fakeMessage(guild, { channelId: 'log-msg' }), { attesaMs: 0 });
  await logs.logMessageDelete(
    fakeMessage(guild, { author: { id: 'b', bot: true } }),
    { attesaMs: 0 },
  );

  assert.equal(canale.inviati.length, 0);
});

test('un messaggio non in cache viene loggato dicendo che il contenuto manca', async () => {
  const canale = fakeChannel('log-msg');
  const guild = fakeGuild({ channels: [canale] });
  store.setChannel(GUILD_ID, 'messaggi', 'log-msg');

  await logs.logMessageDelete(
    fakeMessage(guild, { partial: true, content: null, author: null }),
    { attesaMs: 0 },
  );

  assert.match(testo(canale.inviati[0]), /non era in cache/);
});

test('chi ha eliminato il messaggio viene preso dall\'audit log quando la voce e\' nuova', async () => {
  const guild = fakeGuild({
    auditEntries: [
      {
        id: 'entry-1',
        targetId: 'user-1',
        executorId: 'mod-1',
        executor: { id: 'mod-1' },
        createdTimestamp: Date.now(),
        extra: { channel: { id: 'generale' }, count: 1 },
      },
    ],
  });

  const deleter = await logs.findMessageDeleter(fakeMessage(guild), { attesaMs: 0 });
  assert.equal(deleter.id, 'mod-1');
});

test('una voce di audit log vecchia e invariata non viene attribuita alla nuova eliminazione', async () => {
  const entry = {
    id: 'entry-1',
    targetId: 'user-1',
    executorId: 'mod-1',
    createdTimestamp: Date.now() - 60_000,
    extra: { channel: { id: 'generale' }, count: 3 },
  };
  const guild = fakeGuild({ auditEntries: [entry] });

  assert.equal(await logs.findMessageDeleter(fakeMessage(guild), { attesaMs: 0 }), null);

  // Lo stesso moderatore elimina un altro messaggio: Discord incrementa count.
  entry.extra.count = 4;
  const deleter = await logs.findMessageDeleter(fakeMessage(guild), { attesaMs: 0 });
  assert.equal(deleter.id, 'mod-1');
});

test('senza permesso sul registro non si interroga l\'audit log', async () => {
  const guild = fakeGuild({ permessi: [] });
  guild.fetchAuditLogs = async () => {
    throw new Error('non deve essere chiamato');
  };
  assert.equal(await logs.findMessageDeleter(fakeMessage(guild), { attesaMs: 0 }), null);
});

test('una modifica viene loggata con prima e dopo', async () => {
  const canale = fakeChannel('log-msg');
  const guild = fakeGuild({ channels: [canale] });
  store.setChannel(GUILD_ID, 'messaggi', 'log-msg');

  const vecchio = fakeMessage(guild, { content: 'prima' });
  const nuovo = fakeMessage(guild, { content: 'dopo', editedTimestamp: Date.now(), editedAt: new Date() });
  await logs.logMessageUpdate(vecchio, nuovo);

  const t = testo(canale.inviati[0]);
  assert.match(t, /\*\*Prima\*\*\n> prima/);
  assert.match(t, /\*\*Dopo\*\*\n> dopo/);
  const json = canale.inviati[0].components[0].toJSON();
  const pulsante = json.components.find(c => c.type === 1).components[0];
  assert.equal(pulsante.url, nuovo.url);
});

test('le anteprime dei link e i contenuti identici non contano come modifiche', async () => {
  const canale = fakeChannel('log-msg');
  const guild = fakeGuild({ channels: [canale] });
  store.setChannel(GUILD_ID, 'messaggi', 'log-msg');

  // Anteprima: nessun editedTimestamp.
  await logs.logMessageUpdate(fakeMessage(guild), fakeMessage(guild, { content: 'altro' }));
  // Stesso testo con editedTimestamp (es. embed soppresso).
  await logs.logMessageUpdate(fakeMessage(guild), fakeMessage(guild, { editedTimestamp: Date.now() }));

  assert.equal(canale.inviati.length, 0);
});

test('l\'eliminazione di massa allega la trascrizione dei messaggi in cache', async () => {
  const canale = fakeChannel('log-msg');
  const guild = fakeGuild({ channels: [canale] });
  store.setChannel(GUILD_ID, 'messaggi', 'log-msg');

  const messaggi = new Collection([
    ['a', fakeMessage(guild, { id: 'a', content: 'secondo', createdTimestamp: 2000 })],
    ['b', fakeMessage(guild, { id: 'b', content: 'primo', createdTimestamp: 1000 })],
    ['c', { id: 'c', partial: true }],
  ]);
  await logs.logMessageDeleteBulk(messaggi, { id: 'generale', name: 'generale', guild });

  const payload = canale.inviati[0];
  assert.match(testo(payload), /\*\*3\*\* messaggi/);
  const trascrizione = payload.files[0].attachment.toString('utf8');
  assert.ok(trascrizione.indexOf('primo') < trascrizione.indexOf('secondo'), 'ordine cronologico');
  // Il file e' mostrato dentro la scheda, non come allegato staccato.
  const json = payload.components[0].toJSON();
  assert.ok(json.components.some(c => c.type === 13 && c.file.url === `attachment://${payload.files[0].name}`));
});

/* --------------------------------------------------------------- membri */

test('l\'ingresso di un account appena creato viene segnalato', () => {
  const guild = fakeGuild();
  const t = testo(logs
    .buildMemberJoinCard({
      guild,
      user: {
        id: 'u1',
        tag: 'nuovo',
        bot: false,
        createdAt: new Date(),
        createdTimestamp: Date.now() - 1000,
        displayAvatarURL: () => 'https://cdn/a.png',
      },
    }, { stato: 'invito', invito: { code: 'abc', uses: 3, maxUses: 0, inviterId: 'mod-1' }, totaleInvitante: 7 }));

  assert.match(t, /### Nuovo membro/);
  assert.match(t, /\*\*Attenzione:\*\*/);
  assert.match(t, /discord\.gg\/abc/);
  assert.match(t, /<@mod-1>, 7 ingressi/);
});

test('l\'uscita elenca i ruoli senza @everyone', () => {
  const guild = fakeGuild();
  const ruoli = new Collection([
    [GUILD_ID, { id: GUILD_ID, position: 0 }],
    ['r1', { id: 'r1', position: 5 }],
  ]);
  const t = testo(logs
    .buildMemberLeaveCard({
      id: 'u1',
      guild,
      joinedAt: new Date(),
      user: { id: 'u1', tag: 'mario', displayAvatarURL: () => 'https://cdn/a.png' },
      roles: { cache: ruoli },
    }));

  assert.match(t, /\*\*Ruoli \(1\):\*\* <@&r1>/);
  assert.doesNotMatch(t, new RegExp(`<@&${GUILD_ID}>`));
});

/* ----------------------------------------------------------------- voce */

test('voce: ingresso, uscita e spostamento, niente per mute o stream', () => {
  const stato = channelId => ({ channelId, id: 'u1', member: { id: 'u1', user: { tag: 'mario' } } });

  assert.match(testo(logs.buildVoiceCard(stato(null), stato('v1'))), /### Entrato in vocale/);
  assert.match(testo(logs.buildVoiceCard(stato('v1'), stato(null))), /### Uscito dalla vocale/);
  assert.match(testo(logs.buildVoiceCard(stato('v1'), stato('v2'))), /<#v1> → <#v2>/);
  assert.equal(logs.buildVoiceCard(stato('v1'), stato('v1')), null);
});

/* ------------------------------------------------------------ audit log */

test('un MemberUpdate con nickname e timeout finisce in due canali diversi', () => {
  const voci = logs.instradaVoceAudit({
    action: AuditLogEvent.MemberUpdate,
    changes: [
      { key: 'nick', old: 'a', new: 'b' },
      { key: 'communication_disabled_until', old: undefined, new: new Date(Date.now() + 60_000).toISOString() },
    ],
  });

  assert.deepEqual(
    voci.map(v => [v.tipo, v.titolo]),
    [
      ['moderazione', 'Membro in timeout'],
      ['membri', 'Nickname cambiato'],
    ],
  );
});

test('le azioni non previste vengono ignorate', () => {
  assert.deepEqual(logs.instradaVoceAudit({ action: AuditLogEvent.OnboardingUpdate, changes: [] }), []);
});

test('i permessi di un ruolo vengono mostrati come differenza', () => {
  const prima = PermissionFlagsBits.SendMessages;
  const dopo = PermissionFlagsBits.SendMessages | PermissionFlagsBits.BanMembers;
  assert.equal(logs.formattaPermessi(String(prima), String(dopo)), '+ `BanMembers`');
});

test('un ban viene loggato in moderazione con esecutore e motivo', async () => {
  const canale = fakeChannel('log-mod');
  const guild = fakeGuild({ channels: [canale] });
  store.setChannel(GUILD_ID, 'moderazione', 'log-mod');

  await logs.logAuditEntry(
    {
      action: AuditLogEvent.MemberBanAdd,
      targetType: 'User',
      targetId: 'u1',
      target: { id: 'u1', tag: 'mario' },
      executorId: 'mod-1',
      reason: 'spam',
      changes: [],
      createdAt: new Date(),
    },
    guild,
  );

  const t = testo(canale.inviati[0]);
  assert.match(t, /### Membro bannato\n-# da user-mod-1/);
  assert.match(t, /\*\*Eseguito da:\*\* <@mod-1>/);
  assert.match(t, /\*\*Motivo\*\*\n> spam/);
});

test('le azioni del bot stesso non vengono loggate', async () => {
  const canale = fakeChannel('log-server');
  const guild = fakeGuild({ channels: [canale] });
  store.setChannel(GUILD_ID, 'server', 'log-server');

  await logs.logAuditEntry(
    { action: AuditLogEvent.ChannelCreate, executorId: BOT_ID, targetType: 'Channel', changes: [] },
    guild,
  );

  assert.equal(canale.inviati.length, 0);
});

test('un canale eliminato viene mostrato per nome', () => {
  const guild = fakeGuild();
  const bersaglio = logs.descriviBersaglio(
    { targetType: 'Channel', targetId: 'c9', target: { id: 'c9' }, changes: [{ key: 'name', old: 'vecchio' }] },
    guild,
  );
  assert.equal(bersaglio, '#vecchio');
});

/* ---------------------------------------------------------------- setup */

test('setup-log e\' uno slash command valido', () => {
  assert.equal(validateSlashCommand(setupLog), null);
  const json = setupLog.data.toJSON();
  assert.deepEqual(
    json.options.map(o => o.name),
    ['crea', 'imposta', 'disattiva', 'stato'],
  );
});

test('crea genera categoria e canali mancanti e riusa quelli gia\' configurati', async () => {
  const esistente = fakeChannel('gia-mio');
  const guild = fakeGuild({
    channels: [esistente],
    permessi: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles],
  });
  store.setChannel(GUILD_ID, 'voce', 'gia-mio');

  const { creati, riusati } = await logs.createLogChannels(guild);

  assert.equal(riusati.length, 1);
  assert.equal(riusati[0].tipo.value, 'voce');
  assert.equal(creati.length, logs.TIPI.length - 1);
  assert.equal(guild.creati[0].type, ChannelType.GuildCategory);
  for (const tipo of logs.TIPI) assert.ok(store.getChannelId(GUILD_ID, tipo));

  // Una seconda esecuzione non crea nulla di nuovo.
  const secondo = await logs.createLogChannels(guild);
  assert.equal(secondo.creati.length, 0);
});

test('crea si rifiuta con un errore leggibile se mancano i permessi', async () => {
  const guild = fakeGuild({ permessi: [] });
  await assert.rejects(() => logs.createLogChannels(guild), { code: 'LOG_MISSING_PERMISSIONS' });
});

/* ---------------------------------------------------------------- scheda */

test('la scheda resta sotto il limite di testo dei componenti V2 anche con un corpo enorme', () => {
  const payload = creaScheda({
    colore: 0xff0000,
    titolo: 'Prova',
    corpo: 'riga\n'.repeat(3000),
    cita: true,
    campi: [{ nome: 'Lungo', valore: 'x'.repeat(5000) }],
  });
  assert.ok(testo(payload).length <= LIMITE_TESTO_TOTALE, `testo di ${testo(payload).length} caratteri`);
});

test('la scheda senza immagine non crea una sezione senza accessorio', () => {
  const json = creaScheda({ colore: 1, titolo: 'Senza avatar' }).components[0].toJSON();
  assert.equal(json.components[0].type, 10);
  const conAvatar = creaScheda({ colore: 1, titolo: 'Con', immagine: 'https://cdn/a.png' }).components[0].toJSON();
  assert.equal(conAvatar.components[0].type, 9);
  assert.equal(conAvatar.components[0].accessory.media.url, 'https://cdn/a.png');
});

test('durata leggibile con le due unita\' piu\' grandi', () => {
  const giorno = 24 * 60 * 60 * 1000;
  assert.equal(logs.durata(400 * giorno), '1 anno e 1 mese');
  assert.equal(logs.durata(3 * giorno + 2 * 60 * 60 * 1000), '3 giorni e 2 ore');
  assert.equal(logs.durata(1000), 'meno di un minuto');
});
