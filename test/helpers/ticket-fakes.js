'use strict';

/**
 * Finti oggetti Discord condivisi dai test dei ticket. Non e' un file .test.js
 * apposta: il runner carica solo "test/**\/*.test.js".
 */

const { Collection, ChannelType, PermissionFlagsBits } = require('discord.js');
const ticketConfig = require('../../src/config/tickets');

const CATEGORIA = ticketConfig.categories[0];

function fakeTextChannel(name, { send, editOverwrite } = {}) {
  const inviati = [];
  const permessi = [];

  const channel = {
    name,
    type: ChannelType.GuildText,
    inviati,
    permessi,
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
    permissionOverwrites: {
      edit: async (id, opzioni) => {
        if (editOverwrite) return editOverwrite(id, opzioni);
        permessi.push({ id, opzioni });
      },
    },
  };

  return channel;
}

function fakeMember({ id = 'user-2', tag = 'luigi#0002', roles = [], manageChannels = false } = {}) {
  return {
    id,
    tag,
    toString: () => `<@${id}>`,
    permissions: {
      has: flag => manageChannels && flag === PermissionFlagsBits.ManageChannels,
    },
    roles: {
      cache: roles.map((name, i) => ({ id: `role-membro-${i}`, name })),
    },
  };
}

function fakeGuild({ createChannel, logChannel, membri = [] } = {}) {
  const creati = [];

  return {
    creati,
    roles: {
      everyone: { id: 'everyone' },
      cache: CATEGORIA.roles.map((name, i) => ({ id: `role-${i}`, name })),
    },
    members: {
      fetch: async id => {
        const membro = membri.find(m => m.id === id);
        if (!membro) throw new Error('Unknown Member');
        return membro;
      },
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

function fakeUserMessage({ channel, guild, member, reply } = {}) {
  const risposte = [];
  return {
    risposte,
    channel,
    guild,
    member,
    author: { id: 'user-1', tag: 'mario#0001', toString: () => '<@user-1>' },
    reply: async payload => {
      if (reply) return reply(payload);
      risposte.push(payload);
      return payload;
    },
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

module.exports = {
  CATEGORIA,
  fakeCloseInteraction,
  fakeGuild,
  fakeMember,
  fakeMessage,
  fakeSelectInteraction,
  fakeTextChannel,
  fakeUserMessage,
  metodiRisposta,
  paginatore,
  statoInterazione,
};
