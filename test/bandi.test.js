'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType } = require('discord.js');

const bandoConfig = require('../src/config/bandi');
const interactionCreate = require('../src/events/interactionCreate');
const setupBando = require('../src/commands/slash/setupbando');
const { isTicketStaff } = require('../src/lib/tickets');
const {
  fakeGuild,
  fakeMember,
  fakeSelectInteraction,
  fakeTextChannel,
  metodiRisposta,
  statoInterazione,
} = require('./helpers/ticket-fakes');

const BANDO = bandoConfig.categories[0];

test('ogni bando ha due ruoli e valori unici', () => {
  const valori = new Set();

  for (const c of bandoConfig.categories) {
    assert.equal(c.roles.length, 2, `${c.value} deve avere Capo e Vice Capo Reparto`);
    assert.ok(!valori.has(c.value), `value duplicato: ${c.value}`);
    valori.add(c.value);

    // Limiti di Discord per le opzioni di un select menu.
    assert.ok(c.label.length <= 100);
    assert.ok(c.description.length <= 100);
    assert.ok(c.value.length <= 100);
  }
});

test('i bandi stanno in un solo select menu', () => {
  assert.ok(bandoConfig.categories.length <= 25);
});

test('candidarsi a un bando apre un ticket con i due Capo Reparto dentro', async () => {
  const guild = fakeGuild({ ruoli: BANDO.roles });
  const interaction = fakeSelectInteraction({
    guild,
    customId: 'bando-select',
    value: BANDO.value,
  });

  await interactionCreate.execute(interaction, {});

  assert.equal(guild.creati.length, 1);
  const creato = guild.creati[0];
  assert.equal(creato.name, 'ticket-bando-risorse-umane-mario-rossi');
  assert.equal(creato.type, ChannelType.GuildText);

  // everyone negato, poi utente, bot e i due ruoli del reparto.
  const permessi = creato.permissionOverwrites.map(p => p.id);
  assert.deepEqual(permessi, ['everyone', 'user-1', 'bot-1', 'role-0', 'role-1']);

  assert.match(interaction.stato.edits[0].content, /Ticket creato/);
});

test('un bando inesistente non crea canali', async () => {
  const guild = fakeGuild({ ruoli: BANDO.roles });
  const interaction = fakeSelectInteraction({
    guild,
    customId: 'bando-select',
    value: 'bando_inventato',
  });

  await interactionCreate.execute(interaction, {});

  assert.equal(guild.creati.length, 0);
  assert.match(interaction.stato.replies[0].content, /Categoria non valida/);
});

test('il menu dei bandi non risponde ai valori dei ticket generali', async () => {
  const guild = fakeGuild({ ruoli: BANDO.roles });
  const interaction = fakeSelectInteraction({
    guild,
    customId: 'bando-select',
    value: 'richiesta_esame',
  });

  await interactionCreate.execute(interaction, {});

  assert.equal(guild.creati.length, 0);
});

test('un Capo Reparto e- staff e puo- chiudere il ticket del suo bando', () => {
  assert.equal(isTicketStaff(fakeMember({ roles: [BANDO.roles[0]] })), true);
  assert.equal(isTicketStaff(fakeMember({ roles: [BANDO.roles[1]] })), true);
  assert.equal(isTicketStaff(fakeMember({ roles: ['Cittadino'] })), false);
});

test('setup-bando manda il pannello e conferma in ephemeral', async () => {
  const canale = fakeTextChannel('candidature');
  const stato = statoInterazione();
  const interaction = { channel: canale, ...metodiRisposta(stato) };

  await setupBando.execute(interaction);

  assert.equal(canale.inviati.length, 1);
  const inviato = canale.inviati[0];
  const menu = inviato.components[0].toJSON().components[0];

  assert.equal(menu.custom_id, 'bando-select');
  assert.equal(menu.options.length, bandoConfig.categories.length);

  assert.match(stato.replies[0].content, /Pannello bandi inviato/);
});
