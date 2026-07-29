'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { Collection, MessageFlags, ChannelType } = require('discord.js');

const interactionCreate = require('../src/events/interactionCreate');
const setupTicket = require('../src/commands/slash/setupticket');
const ticketConfig = require('../src/config/tickets');

const originalError = console.error;
const originalWarn = console.warn;

beforeEach(() => {
  // Diversi test provocano errori di proposito: silenziamo i log per non
  // sporcare l'output del runner.
  console.error = () => {};
  console.warn = () => {};
});

afterEach(() => {
  console.error = originalError;
  console.warn = originalWarn;
});

const CATEGORIA = ticketConfig.categories[0];

function fakeTextChannel(name, { send } = {}) {
  const inviati = [];
  const channel = {
    name,
    type: ChannelType.GuildText,
    inviati,
    eliminato: false,
    toString: () => `<#${name}>`,
    send: async payload => {
      if (send) return send(payload);
      inviati.push(payload);
      return payload;
    },
    delete: async () => {
      channel.eliminato = true;
    },
  };
  return channel;
}

function fakeGuild({ createChannel, logChannel } = {}) {
  const creati = [];
  return {
    creati,
    roles: {
      everyone: { id: 'everyone' },
      cache: CATEGORIA.roles.map((name, i) => ({ id: `role-${i}`, name })),
    },
    channels: {
      cache: logChannel ? [logChannel] : [],
      create: async options => {
        creati.push(options);
        return createChannel ? createChannel(options) : fakeTextChannel(options.name);
      },
    },
  };
}

function statoInterazione() {
  return { replies: [], edits: [], deferred: false, replied: false };
}

function metodiRisposta(stato, { deferReply } = {}) {
  return {
    reply: async payload => {
      stato.replied = true;
      stato.replies.push(payload);
    },
    followUp: async payload => {
      stato.replies.push(payload);
    },
    editReply: async payload => {
      stato.replied = true;
      stato.edits.push(payload);
      return payload;
    },
    deferReply: async () => {
      if (deferReply) return deferReply();
      stato.deferred = true;
    },
    get replied() {
      return stato.replied;
    },
    get deferred() {
      return stato.deferred;
    },
  };
}

function fakeSelectInteraction({ value = CATEGORIA.value, guild, customId = 'ticket-select', deferReply } = {}) {
  const stato = statoInterazione();
  return {
    stato,
    isChatInputCommand: () => false,
    isStringSelectMenu: () => true,
    isButton: () => false,
    customId,
    values: [value],
    user: { id: 'user-1', username: 'Mario.Rossi', tag: 'mario#0001', toString: () => '<@user-1>' },
    client: { user: { id: 'bot-1' } },
    guild,
    ...metodiRisposta(stato, { deferReply }),
  };
}

function fakeCloseInteraction({ guild, channel }) {
  const stato = statoInterazione();
  return {
    stato,
    isChatInputCommand: () => false,
    isStringSelectMenu: () => false,
    isButton: () => true,
    customId: 'ticket-close',
    user: { id: 'user-1', tag: 'mario#0001', toString: () => '<@user-1>' },
    client: { user: { id: 'bot-1' } },
    guild,
    channel,
    ...metodiRisposta(stato),
  };
}

function fakeMessage(id, content) {
  return { id, content, createdTimestamp: 0, author: { tag: 'mario#0001' } };
}

// Discord restituisce le pagine dalla piu' recente alla piu' vecchia.
function paginatore(pagine) {
  let i = 0;
  const chiamate = [];
  return {
    chiamate,
    fetch: async options => {
      chiamate.push(options);
      const pagina = pagine[i] ?? [];
      i += 1;
      return new Collection(pagina.map(m => [m.id, m]));
    },
  };
}

test('interactionCreate ignora i select menu di altri componenti', async () => {
  const guild = fakeGuild();
  const interaction = fakeSelectInteraction({ guild, customId: 'altro-menu' });

  await assert.doesNotReject(() => interactionCreate.execute(interaction, {}));

  assert.equal(guild.creati.length, 0);
  assert.equal(interaction.stato.replies.length, 0);
});

test('un ticket con categoria sconosciuta viene rifiutato senza creare canali', async () => {
  const guild = fakeGuild();
  const interaction = fakeSelectInteraction({ guild, value: 'categoria-che-non-esiste' });

  await interactionCreate.execute(interaction, {});

  assert.equal(guild.creati.length, 0);
  assert.equal(interaction.stato.replies.length, 1);
  assert.match(interaction.stato.replies[0].content, /Categoria non valida/);
  assert.equal(interaction.stato.replies[0].flags, MessageFlags.Ephemeral);
});

test("l'apertura crea il canale, avvisa i ruoli e comunica il ticket all'utente", async () => {
  const guild = fakeGuild();
  const interaction = fakeSelectInteraction({ guild });

  await interactionCreate.execute(interaction, {});

  assert.equal(guild.creati.length, 1);
  const creato = guild.creati[0];
  // Il nome passa da "Mario.Rossi" a una forma accettata da Discord.
  assert.equal(creato.name, 'ticket-mario-rossi');
  assert.equal(creato.type, ChannelType.GuildText);

  const permessi = creato.permissionOverwrites.map(p => p.id);
  assert.deepEqual(permessi, ['everyone', 'user-1', 'bot-1', 'role-0']);

  assert.equal(interaction.stato.edits.length, 1);
  assert.match(interaction.stato.edits[0].content, /Ticket creato/);
});

test('se il messaggio di benvenuto fallisce il ticket viene comunque comunicato', async () => {
  const guild = fakeGuild({
    createChannel: options =>
      fakeTextChannel(options.name, {
        send: async () => {
          throw new Error('Missing Permissions');
        },
      }),
  });
  const interaction = fakeSelectInteraction({ guild });

  await assert.doesNotReject(() => interactionCreate.execute(interaction, {}));

  assert.equal(interaction.stato.edits.length, 1);
  assert.match(interaction.stato.edits[0].content, /Ticket creato/);
});

test("un errore imprevisto nell'apertura non diventa una unhandled rejection", async () => {
  const guild = fakeGuild();
  const interaction = fakeSelectInteraction({
    guild,
    deferReply: () => {
      throw new Error('Unknown interaction');
    },
  });

  await assert.doesNotReject(() => interactionCreate.execute(interaction, {}));

  assert.equal(interaction.stato.replies.length, 1);
  assert.match(interaction.stato.replies[0].content, /Errore durante l'apertura/);
  assert.equal(interaction.stato.replies[0].flags, MessageFlags.Ephemeral);
});

test('la chiusura salva la trascrizione nel canale di log e poi elimina il canale', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const logChannel = fakeTextChannel(ticketConfig.logChannelName);
  const guild = fakeGuild({ logChannel });
  const channel = fakeTextChannel('ticket-mario-rossi');
  channel.messages = paginatore([[fakeMessage('m2', 'secondo'), fakeMessage('m1', 'primo')]]);

  const interaction = fakeCloseInteraction({ guild, channel });

  await interactionCreate.execute(interaction, {});

  assert.equal(guild.creati.length, 0, 'il canale di log esisteva gia\'');
  assert.equal(logChannel.inviati.length, 1);

  const trascrizione = logChannel.inviati[0].files[0].attachment.toString('utf-8');
  // Il file va letto dal piu' vecchio al piu' recente, non nell'ordine di fetch.
  assert.match(trascrizione, /primo[\s\S]*secondo/);

  assert.equal(interaction.stato.edits.length, 1);
  assert.match(interaction.stato.edits[0], /trascrizione è stata salvata/);

  assert.equal(channel.eliminato, false, 'il canale sopravvive fino allo scadere dei 5 secondi');
  t.mock.timers.tick(5000);
  assert.equal(channel.eliminato, true);
});

test('se la trascrizione non parte il ticket si chiude lo stesso, dicendolo', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const logChannel = fakeTextChannel(ticketConfig.logChannelName, {
    send: async () => {
      throw new Error('Request entity too large');
    },
  });
  const guild = fakeGuild({ logChannel });
  const channel = fakeTextChannel('ticket-mario-rossi');
  channel.messages = paginatore([[fakeMessage('m1', 'ciao')]]);

  const interaction = fakeCloseInteraction({ guild, channel });

  await assert.doesNotReject(() => interactionCreate.execute(interaction, {}));

  assert.equal(interaction.stato.edits.length, 1);
  assert.match(interaction.stato.edits[0], /non sono riuscito a salvare la trascrizione/);

  t.mock.timers.tick(5000);
  assert.equal(channel.eliminato, true);
});

test('la trascrizione non si blocca se Discord continua a restituire la stessa pagina', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const logChannel = fakeTextChannel(ticketConfig.logChannelName);
  const guild = fakeGuild({ logChannel });
  const channel = fakeTextChannel('ticket-mario-rossi');

  // Pagina piena e sempre identica: l'id piu' vecchio non avanza mai.
  const paginaFissa = Array.from({ length: 100 }, (_, i) => fakeMessage(`m${i}`, `riga ${i}`));
  const chiamate = [];
  channel.messages = {
    fetch: async options => {
      chiamate.push(options);
      assert.ok(chiamate.length < 10, 'fetchAllMessages sta ciclando all\'infinito');
      return new Collection(paginaFissa.map(m => [m.id, m]));
    },
  };

  const interaction = fakeCloseInteraction({ guild, channel });

  await interactionCreate.execute(interaction, {});

  assert.equal(chiamate.length, 2);
  assert.equal(interaction.stato.edits.length, 1);
  t.mock.timers.tick(5000);
});

test('la trascrizione si ferma al tetto massimo su un canale sterminato', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const logChannel = fakeTextChannel(ticketConfig.logChannelName);
  const guild = fakeGuild({ logChannel });
  const channel = fakeTextChannel('ticket-mario-rossi');

  let seq = 0;
  const chiamate = [];
  channel.messages = {
    fetch: async options => {
      chiamate.push(options);
      assert.ok(chiamate.length <= 50, 'fetchAllMessages ha superato il tetto di 5000 messaggi');
      const pagina = Array.from({ length: 100 }, () => {
        seq += 1;
        return fakeMessage(`m${seq}`, `riga ${seq}`);
      });
      return new Collection(pagina.map(m => [m.id, m]));
    },
  };

  const interaction = fakeCloseInteraction({ guild, channel });

  await interactionCreate.execute(interaction, {});

  // 5000 messaggi / 100 per pagina: si ferma li' invece di scorrere all'infinito.
  assert.equal(chiamate.length, 50);
  assert.equal(interaction.stato.edits.length, 1);
  t.mock.timers.tick(5000);
});

test('setup-ticket risponde in ephemeral con flags, non con la vecchia opzione', async () => {
  const stato = statoInterazione();
  const canale = fakeTextChannel('generale');
  const interaction = { channel: canale, ...metodiRisposta(stato) };

  await setupTicket.execute(interaction);

  assert.equal(canale.inviati.length, 1);
  assert.equal(canale.inviati[0].components.length, 1);

  assert.equal(stato.replies.length, 1);
  assert.equal(stato.replies[0].flags, MessageFlags.Ephemeral);
  assert.equal('ephemeral' in stato.replies[0], false);
});
