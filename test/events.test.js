'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { Collection, MessageFlags } = require('discord.js');

const messageCreate = require('../src/events/messageCreate');
const interactionCreate = require('../src/events/interactionCreate');

const originalError = console.error;

beforeEach(() => {
  console.error = () => {};
});

afterEach(() => {
  console.error = originalError;
});

function clientConComando(nome, execute) {
  const client = {
    prefix: '!',
    prefixCommands: new Collection(),
    slashCommands: new Collection(),
  };
  if (nome) {
    client.prefixCommands.set(nome, { name: nome, execute });
    client.slashCommands.set(nome, { data: { name: nome }, execute });
  }
  return client;
}

function fakeMessage(content) {
  const risposte = [];
  return {
    content,
    author: { bot: false },
    risposte,
    reply: async payload => risposte.push(payload),
  };
}

test('messageCreate ignora i messaggi dei bot', async () => {
  let chiamato = false;
  const client = clientConComando('ping', () => {
    chiamato = true;
  });
  const message = fakeMessage('!ping');
  message.author.bot = true;

  await messageCreate.execute(message, client);

  assert.equal(chiamato, false);
});

test('messageCreate esegue il comando passando gli argomenti', async () => {
  let ricevuti = null;
  const client = clientConComando('echo', (_message, args) => {
    ricevuti = args;
  });

  await messageCreate.execute(fakeMessage('!echo uno  due'), client);

  assert.deepEqual(ricevuti, ['uno', 'due']);
});

test('messageCreate ignora il solo prefisso senza comando', async () => {
  const client = clientConComando('ping', () => {
    throw new Error('non deve essere chiamato');
  });

  await assert.doesNotReject(() => messageCreate.execute(fakeMessage('!'), client));
});

test('messageCreate sopravvive a un comando che lancia', async () => {
  const client = clientConComando('boom', () => {
    throw new Error('boom');
  });
  const message = fakeMessage('!boom');

  await assert.doesNotReject(() => messageCreate.execute(message, client));
  assert.deepEqual(message.risposte, ["Errore durante l'esecuzione del comando."]);
});

test('messageCreate non crasha se anche la risposta di errore fallisce', async () => {
  const client = clientConComando('boom', () => {
    throw new Error('boom');
  });
  const message = fakeMessage('!boom');
  message.reply = async () => {
    throw new Error('Missing Permissions');
  };

  await assert.doesNotReject(() => messageCreate.execute(message, client));
});

test('interactionCreate risponde in ephemeral con flags, non con la vecchia opzione', async () => {
  const inviati = [];
  const client = clientConComando('boom', () => {
    throw new Error('boom');
  });
  const interaction = {
    isChatInputCommand: () => true,
    commandName: 'boom',
    replied: false,
    deferred: false,
    reply: async payload => inviati.push(payload),
    followUp: async payload => inviati.push(payload),
  };

  await assert.doesNotReject(() => interactionCreate.execute(interaction, client));

  assert.equal(inviati.length, 1);
  assert.equal(inviati[0].flags, MessageFlags.Ephemeral);
  assert.equal('ephemeral' in inviati[0], false);
});

test('interactionCreate ignora le interazioni che non sono comandi', async () => {
  const client = clientConComando('ping', () => {
    throw new Error('non deve essere chiamato');
  });
  const interaction = {
    isChatInputCommand: () => false,
    isStringSelectMenu: () => false,
    isButton: () => false,
  };

  await assert.doesNotReject(() => interactionCreate.execute(interaction, client));
});
