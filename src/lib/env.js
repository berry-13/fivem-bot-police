'use strict';

/**
 * Legge una variabile d'ambiente obbligatoria.
 * Fallisce subito con un messaggio leggibile invece di lasciar propagare
 * errori opachi dalle API di Discord.
 */
function requireEnv(name, hint) {
  const value = process.env[name]?.trim();
  if (!value) {
    const suffix = hint ? ` ${hint}` : '';
    throw new Error(`Variabile d'ambiente mancante: ${name}.${suffix}`);
  }
  return value;
}

/** Legge una variabile opzionale, normalizzando i valori vuoti a undefined. */
function optionalEnv(name) {
  return process.env[name]?.trim() || undefined;
}

module.exports = { requireEnv, optionalEnv };
