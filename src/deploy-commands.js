'use strict';

const { REST, Routes } = require('discord.js');
require('dotenv').config({ quiet: true });

const { requireEnv, optionalEnv } = require('./lib/env');
const { loadSlashCommands } = require('./lib/loaders');

async function main() {
  const token = requireEnv('DISCORD_TOKEN', 'Copia .env.example in .env e inserisci il token del bot.');
  const clientId = requireEnv('CLIENT_ID', "E' l'Application ID che trovi nel Discord Developer Portal.");
  // Senza GUILD_ID i comandi vengono registrati globalmente (fino a un'ora di
  // propagazione). Con GUILD_ID la registrazione e' immediata: ideale in sviluppo.
  const guildId = optionalEnv('GUILD_ID');

  const { loaded, problems } = loadSlashCommands();

  // A differenza dell'avvio del bot, qui un comando non valido e' fatale: il
  // deploy sostituisce l'intero set su Discord, quindi proseguire significherebbe
  // cancellare in silenzio i comandi che non siamo riusciti a caricare.
  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(`Comando non valido -> ${problem}`);
    }
    throw new Error('Deploy annullato: correggi i comandi elencati sopra.');
  }

  if (loaded.length === 0) {
    throw new Error('Nessuno slash command da registrare.');
  }

  const body = loaded.map(command => command.data.toJSON());
  const rest = new REST().setToken(token);
  const scope = guildId ? `nella guild ${guildId}` : 'globalmente';

  console.log(`Registrazione di ${body.length} slash command ${scope}...`);

  const route = guildId
    ? Routes.applicationGuildCommands(clientId, guildId)
    : Routes.applicationCommands(clientId);

  await rest.put(route, { body });

  console.log(`Slash command registrati con successo ${scope}.`);
}

main().catch(error => {
  console.error(`Deploy fallito: ${error.message}`);
  process.exit(1);
});
