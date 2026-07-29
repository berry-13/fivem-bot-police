'use strict';

const { Client, GatewayIntentBits, Collection, Partials } = require('discord.js');
// quiet: true silenzia i suggerimenti promozionali di dotenv nei log.
require('dotenv').config({ quiet: true });

const { requireEnv, optionalEnv } = require('./lib/env');
const { loadSlashCommands, loadPrefixCommands, loadEvents } = require('./lib/loaders');
const { registerShutdown } = require('./lib/shutdown');

// Rete di sicurezza: senza questi handler una promise rifiutata termina il
// processo con uno stack trace grezzo (comportamento di default da Node 15).
process.on('unhandledRejection', error => {
  console.error('Promise rejection non gestita:', error);
});

process.on('uncaughtException', error => {
  console.error('Eccezione non gestita, chiusura:', error);
  process.exit(1);
});

function createClient() {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      // Necessario perche' i partial sotto abbiano senso: senza questo intent
      // i messaggi diretti non arrivano proprio.
      GatewayIntentBits.DirectMessages,
    ],
    // Servono a ricevere i DM in canali non ancora in cache.
    partials: [Partials.Message, Partials.Channel],
  });
}

function registerCommands(client) {
  client.slashCommands = new Collection();
  client.prefixCommands = new Collection();

  const slash = loadSlashCommands();
  for (const command of slash.loaded) {
    client.slashCommands.set(command.data.name, command);
  }

  const prefix = loadPrefixCommands();
  for (const command of prefix.loaded) {
    client.prefixCommands.set(command.name, command);
  }

  // I comandi malformati vengono saltati ma mai in silenzio: un comando che
  // sparisce senza una riga di log e' un'ora persa a caccia del motivo.
  for (const problem of [...slash.problems, ...prefix.problems]) {
    console.warn(`Comando ignorato -> ${problem}`);
  }

  console.log(
    `Caricati ${client.slashCommands.size} slash command e ${client.prefixCommands.size} comandi prefix.`,
  );
}

function registerEvents(client) {
  const { loaded, problems } = loadEvents();

  for (const event of loaded) {
    const handler = (...args) => event.execute(...args, client);
    if (event.once) {
      client.once(event.name, handler);
    } else {
      client.on(event.name, handler);
    }
  }

  for (const problem of problems) {
    console.warn(`Evento ignorato -> ${problem}`);
  }
}

async function main() {
  const token = requireEnv('DISCORD_TOKEN', 'Copia .env.example in .env e inserisci il token del bot.');

  const client = createClient();
  client.prefix = optionalEnv('COMMAND_PREFIX') ?? '!';

  registerCommands(client);
  registerEvents(client);
  registerShutdown(client);

  await client.login(token);
}

main().catch(error => {
  console.error(`Avvio fallito: ${error.message}`);
  process.exit(1);
});
