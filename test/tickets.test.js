'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { Collection, MessageFlags, ChannelType } = require('discord.js');

const interactionCreate = require('../src/events/interactionCreate');
const setupTicket = require('../src/commands/slash/setupticket');
const ticketConfig = require('../src/config/tickets');
const { buildTicketChannelName, isTicketChannel, isTicketStaff } = require('../src/lib/tickets');
const {
  CATEGORIA,
  fakeCloseInteraction,
  fakeGuild,
  fakeMember,
  fakeMessage,
  fakeSelectInteraction,
  fakeTextChannel,
  metodiRisposta,
  paginatore,
  statoInterazione,
} = require('./helpers/ticket-fakes');

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

test('il nome del canale porta la categoria, non solo il nome utente', () => {
  assert.equal(buildTicketChannelName(CATEGORIA, 'Mario.Rossi'), 'ticket-richiesta-esame-mario-rossi');
});

test('ogni categoria produce un nome di canale valido per Discord', () => {
  for (const categoria of ticketConfig.categories) {
    const nome = buildTicketChannelName(categoria, 'Mario.Rossi');
    assert.match(nome, /^[a-z0-9-]+$/, `nome non valido per ${categoria.value}`);
    assert.ok(nome.length <= 90);
    assert.ok(nome.includes('mario-rossi'), `manca l'utente in ${nome}`);
  }
});

test('un nome utente lunghissimo viene accorciato senza mangiare la categoria', () => {
  const nome = buildTicketChannelName(CATEGORIA, 'x'.repeat(200));

  assert.ok(nome.length <= 90);
  assert.ok(nome.startsWith('ticket-richiesta-esame-'));
});

test('un nome utente fatto di soli simboli non lascia il canale senza nome', () => {
  assert.equal(buildTicketChannelName(CATEGORIA, '???'), 'ticket-richiesta-esame-utente');
});

test('il canale dei log non viene scambiato per un ticket', () => {
  // Si chiama "ticket-logs": senza il controllo esplicito un !close dato li'
  // dentro cancellerebbe l'archivio di tutti i ticket.
  assert.equal(isTicketChannel({ name: ticketConfig.logChannelName }), false);
  assert.equal(isTicketChannel({ name: 'ticket-richiesta-esame-mario-rossi' }), true);
  assert.equal(isTicketChannel({ name: 'generale' }), false);
  assert.equal(isTicketChannel(undefined), false);
});

test('e\' staff chi gestisce i canali o ha un ruolo dei ticket', () => {
  assert.equal(isTicketStaff(fakeMember({ manageChannels: true })), true);
  assert.equal(isTicketStaff(fakeMember({ roles: [CATEGORIA.roles[0]] })), true);
  assert.equal(isTicketStaff(fakeMember({ roles: ['Cittadino'] })), false);
  assert.equal(isTicketStaff(null), false);
});

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

test("l'apertura crea il canale con la categoria nel nome e avvisa i ruoli", async () => {
  const guild = fakeGuild();
  const interaction = fakeSelectInteraction({ guild });

  await interactionCreate.execute(interaction, {});

  assert.equal(guild.creati.length, 1);
  const creato = guild.creati[0];
  assert.equal(creato.name, 'ticket-richiesta-esame-mario-rossi');
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
  const channel = fakeTextChannel('ticket-richiesta-esame-mario-rossi');
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
  const channel = fakeTextChannel('ticket-richiesta-esame-mario-rossi');
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
  const channel = fakeTextChannel('ticket-richiesta-esame-mario-rossi');

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
  const channel = fakeTextChannel('ticket-richiesta-esame-mario-rossi');

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

test('il pannello rimanda a un superiore in generale, non a un modulo', async () => {
  const stato = statoInterazione();
  const canale = fakeTextChannel('generale');

  await setupTicket.execute({ channel: canale, ...metodiRisposta(stato) });

  const descrizione = canale.inviati[0].embeds[0].data.description;
  assert.match(descrizione, /scrivere in generale per contattare un superiore/);
  assert.equal(/Modulo Assistenza/.test(descrizione), false);
});
