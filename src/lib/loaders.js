'use strict';

const fs = require('fs');
const path = require('path');

const COMMANDS_ROOT = path.join(__dirname, '..', 'commands');

const SLASH_DIR = path.join(COMMANDS_ROOT, 'slash');
const PREFIX_DIR = path.join(COMMANDS_ROOT, 'prefix');
const EVENTS_DIR = path.join(__dirname, '..', 'events');

/**
 * Carica ogni modulo .js di una cartella applicando lo stesso controllo di
 * forma. Restituisce sempre { loaded, problems }: chi chiama decide se un
 * problema e' fatale (deploy) o solo da segnalare (avvio del bot).
 */
function loadModules(dir, validate) {
  const loaded = [];
  const problems = [];

  if (!fs.existsSync(dir)) {
    return { loaded, problems };
  }

  const files = fs.readdirSync(dir).filter(file => file.endsWith('.js'));

  for (const file of files) {
    const fullPath = path.join(dir, file);
    let mod;

    try {
      mod = require(fullPath);
    } catch (error) {
      problems.push(`${file}: impossibile caricare il modulo (${error.message})`);
      continue;
    }

    const reason = validate(mod);
    if (reason) {
      problems.push(`${file}: ${reason}`);
      continue;
    }

    loaded.push(mod);
  }

  return { loaded, problems };
}

function validateSlashCommand(mod) {
  if (!mod?.data?.name) return 'manca "data" (SlashCommandBuilder) o il suo nome';
  if (typeof mod.data.toJSON !== 'function') return '"data" non e\' un SlashCommandBuilder';
  if (typeof mod.execute !== 'function') return 'manca "execute"';
  return null;
}

function validatePrefixCommand(mod) {
  if (!mod?.name) return 'manca "name"';
  if (typeof mod.execute !== 'function') return 'manca "execute"';
  return null;
}

function validateEvent(mod) {
  if (!mod?.name) return 'manca "name"';
  if (typeof mod.execute !== 'function') return 'manca "execute"';
  return null;
}

const loadSlashCommands = (dir = SLASH_DIR) => loadModules(dir, validateSlashCommand);
const loadPrefixCommands = (dir = PREFIX_DIR) => loadModules(dir, validatePrefixCommand);
const loadEvents = (dir = EVENTS_DIR) => loadModules(dir, validateEvent);

module.exports = {
  SLASH_DIR,
  PREFIX_DIR,
  EVENTS_DIR,
  loadModules,
  loadSlashCommands,
  loadPrefixCommands,
  loadEvents,
  validateSlashCommand,
  validatePrefixCommand,
  validateEvent,
};
