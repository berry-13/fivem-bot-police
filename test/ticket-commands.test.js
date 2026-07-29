'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const close = require('../src/commands/prefix/close');
const add = require('../src/commands/prefix/add');
const ticketConfig = require('../src/config/tickets');
const {
  CATEGORIA,
  fakeGuild,
  fakeMember,
  fakeMessage,
  fakeTextChannel,
  fakeUserMessage,
  paginatore,
} = require('./helpers/ticket-fakes');

const originalError = console.error;

beforeEach(() => {
  console.error = () => {};
});

afterEach(() => {
  console.error = originalError;
});

const TICKET = 'ticket-richiesta-esame-mario-rossi';

function scenarioTicket({ logChannel, membri = [], editOverwrite } = {}) {
  const log = logChannel ?? fakeTextChannel(ticketConfig.logChannelName);
  const guild = fakeGuild({ logChannel: log, membri });
  const channel = fakeTextChannel(TICKET, { editOverwrite });
  channel.messages = paginatore([[fakeMessage('m1', 'ciao')]]);
  return { guild, channel, log };
}

test('!close rifiuta di lavorare fuori da un canale ticket', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const { guild } = scenarioTicket();
  const channel = fakeTextChannel('generale');
  const message = fakeUserMessage({ channel, guild });

  await close.execute(message, [], {});

  assert.match(message.risposte[0], /solo dentro un canale ticket/);
  t.mock.timers.tick(5000);
  assert.equal(channel.eliminato, false);
});

test('!close non cancella il canale dei log', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  // "ticket-logs" comincia per "ticket-": senza il controllo esplicito questo
  // comando cancellerebbe l'archivio di tutti i ticket.
  const log = fakeTextChannel(ticketConfig.logChannelName);
  const guild = fakeGuild({ logChannel: log });
  const message = fakeUserMessage({ channel: log, guild });

  await close.execute(message, [], {});

  assert.match(message.risposte[0], /solo dentro un canale ticket/);
  t.mock.timers.tick(5000);
  assert.equal(log.eliminato, false);
});

test('!close archivia la trascrizione e poi cancella il canale', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const { guild, channel, log } = scenarioTicket();
  const message = fakeUserMessage({ channel, guild });

  await close.execute(message, [], {});

  assert.equal(log.inviati.length, 1);
  const trascrizione = log.inviati[0].files[0].attachment.toString('utf-8');
  assert.match(trascrizione, /ciao/);

  assert.match(message.risposte[0], /trascrizione è stata salvata/);

  assert.equal(channel.eliminato, false);
  t.mock.timers.tick(5000);
  assert.equal(channel.eliminato, true);
});

test('!close chiude il ticket anche se la trascrizione non parte', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const log = fakeTextChannel(ticketConfig.logChannelName, {
    send: async () => {
      throw new Error('Missing Permissions');
    },
  });
  const { guild, channel } = scenarioTicket({ logChannel: log });
  const message = fakeUserMessage({ channel, guild });

  await assert.doesNotReject(() => close.execute(message, [], {}));

  assert.match(message.risposte[0], /non sono riuscito a salvare la trascrizione/);
  t.mock.timers.tick(5000);
  assert.equal(channel.eliminato, true);
});

test('!close cancella il canale anche se non riesce ad avvisare', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const { guild, channel } = scenarioTicket();
  const message = fakeUserMessage({
    channel,
    guild,
    reply: async () => {
      throw new Error('Missing Permissions');
    },
  });

  await assert.doesNotReject(() => close.execute(message, [], {}));

  t.mock.timers.tick(5000);
  assert.equal(channel.eliminato, true);
});

test('!add rifiuta di lavorare fuori da un canale ticket', async () => {
  const { guild } = scenarioTicket();
  const message = fakeUserMessage({
    channel: fakeTextChannel('generale'),
    guild,
    member: fakeMember({ manageChannels: true }),
  });

  await add.execute(message, ['<@999>'], {});

  assert.match(message.risposte[0], /solo dentro un canale ticket/);
});

test('!add e\' riservato allo staff', async () => {
  const membro = fakeMember({ id: 'user-9', roles: ['Cittadino'] });
  const { guild, channel } = scenarioTicket({ membri: [membro] });
  const message = fakeUserMessage({ channel, guild, member: membro });

  await add.execute(message, ['<@user-9>'], {});

  assert.match(message.risposte[0], /Solo lo staff/);
  assert.equal(channel.permessi.length, 0);
});

test('!add senza argomenti spiega come si usa, con il prefisso giusto', async () => {
  const { guild, channel } = scenarioTicket();
  const message = fakeUserMessage({ channel, guild, member: fakeMember({ manageChannels: true }) });

  await add.execute(message, [], { prefix: '?' });

  assert.match(message.risposte[0], /\?add @utente/);
});

test('!add accetta sia la menzione sia l\'id incollato a mano', async () => {
  const bersaglio = fakeMember({ id: '123456789012345678' });

  for (const argomento of ['<@123456789012345678>', '<@!123456789012345678>', '123456789012345678']) {
    const { guild, channel } = scenarioTicket({ membri: [bersaglio] });
    const message = fakeUserMessage({ channel, guild, member: fakeMember({ manageChannels: true }) });

    await add.execute(message, [argomento], {});

    assert.equal(channel.permessi.length, 1, `argomento non riconosciuto: ${argomento}`);
    assert.equal(channel.permessi[0].id, '123456789012345678');
    assert.deepEqual(channel.permessi[0].opzioni, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
    });
    assert.match(message.risposte[0], /ora ha accesso/);
  }
});

test('!add funziona anche per lo staff che ha solo un ruolo dei ticket', async () => {
  const bersaglio = fakeMember({ id: '123456789012345678' });
  const { guild, channel } = scenarioTicket({ membri: [bersaglio] });
  const message = fakeUserMessage({
    channel,
    guild,
    member: fakeMember({ roles: [CATEGORIA.roles[0]] }),
  });

  await add.execute(message, ['<@123456789012345678>'], {});

  assert.equal(channel.permessi.length, 1);
});

test('!add avvisa se l\'utente non e\' nel server', async () => {
  const { guild, channel } = scenarioTicket({ membri: [] });
  const message = fakeUserMessage({ channel, guild, member: fakeMember({ manageChannels: true }) });

  await assert.doesNotReject(() => add.execute(message, ['<@123456789012345678>'], {}));

  assert.match(message.risposte[0], /Non trovo quell'utente/);
  assert.equal(channel.permessi.length, 0);
});

test('!add spiega il problema se non riesce a dare i permessi', async () => {
  const bersaglio = fakeMember({ id: '123456789012345678' });
  const { guild, channel } = scenarioTicket({
    membri: [bersaglio],
    editOverwrite: async () => {
      throw new Error('Missing Permissions');
    },
  });
  const message = fakeUserMessage({ channel, guild, member: fakeMember({ manageChannels: true }) });

  await assert.doesNotReject(() => add.execute(message, ['<@123456789012345678>'], {}));

  assert.match(message.risposte[0], /Controlla i miei permessi/);
});
