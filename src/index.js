const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Collection, Partials } = require('discord.js');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Message, Partials.Channel],
});

// Collection per gli slash command
client.slashCommands = new Collection();
// Collection per i comandi prefix (!comando)
client.prefixCommands = new Collection();

const PREFIX = '!';
client.prefix = PREFIX;

// Carica gli slash command
const slashPath = path.join(__dirname, 'commands', 'slash');
if (fs.existsSync(slashPath)) {
  const slashFiles = fs.readdirSync(slashPath).filter(file => file.endsWith('.js'));
  for (const file of slashFiles) {
    const command = require(path.join(slashPath, file));
    if (command.data && command.execute) {
      client.slashCommands.set(command.data.name, command);
    }
  }
}

// Carica i comandi prefix
const prefixPath = path.join(__dirname, 'commands', 'prefix');
if (fs.existsSync(prefixPath)) {
  const prefixFiles = fs.readdirSync(prefixPath).filter(file => file.endsWith('.js'));
  for (const file of prefixFiles) {
    const command = require(path.join(prefixPath, file));
    if (command.name && command.execute) {
      client.prefixCommands.set(command.name, command);
    }
  }
}

// Carica gli eventi
const eventsPath = path.join(__dirname, 'events');
if (fs.existsSync(eventsPath)) {
  const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));
  for (const file of eventFiles) {
    const event = require(path.join(eventsPath, file));
    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args, client));
    } else {
      client.on(event.name, (...args) => event.execute(...args, client));
    }
  }
}

client.login(process.env.DISCORD_TOKEN);