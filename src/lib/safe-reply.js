'use strict';

/**
 * Le risposte a Discord possono fallire per cause fuori dal nostro controllo
 * (permessi mancanti, canale cancellato, interazione scaduta). Questi helper
 * assorbono il rejection: un errore mentre segnaliamo un errore non deve
 * diventare una unhandled rejection e buttare giu' il processo.
 */

// 10062 = interazione scaduta / sconosciuta (>3s senza ack, o token morto)
// 40060 = interazione gia' riconosciuta (es. due istanze del bot)
const DEAD_INTERACTION_CODES = new Set([10062, 40060]);

function isDeadInteractionError(error) {
  return DEAD_INTERACTION_CODES.has(error?.code);
}

async function safeReply(message, payload) {
  try {
    await message.reply(payload);
  } catch (error) {
    console.error('Impossibile rispondere al messaggio:', error);
  }
}

/**
 * Defer entro la finestra dei 3 secondi. Torna true se l'ack e' andato a buon
 * fine: se fallisce (interazione gia' morta) il chiamante puo' comunque fare
 * lavoro utile via channel.send senza rilanciare l'errore.
 */
async function safeDeferReply(interaction, options = {}) {
  try {
    await interaction.deferReply(options);
    return true;
  } catch (error) {
    if (isDeadInteractionError(error)) {
      console.warn(
        `deferReply fallito (interazione non piu' valida, code ${error.code}): ` +
          `${error.message}`,
      );
    } else {
      console.error('Impossibile fare defer dell\'interazione:', error);
    }
    return false;
  }
}

async function safeInteractionReply(interaction, payload) {
  try {
    if (interaction.deferred && !interaction.replied) {
      // Dopo un deferReply l'utente vede "sta pensando" finche' qualcuno non
      // riempie quella risposta: followUp manda un secondo messaggio e lascia
      // lo spinner appeso fino al timeout, editReply lo chiude.
      await interaction.editReply(payload);
    } else if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  } catch (error) {
    // Niente di utile da fare se Discord non accetta piu' risposte su questa
    // interazione: logghiamo corto per non riempire i log di stack trace.
    if (isDeadInteractionError(error)) {
      console.warn(`Risposta interazione saltata (code ${error.code}): ${error.message}`);
      return;
    }
    console.error("Impossibile rispondere all'interazione:", error);
  }
}

module.exports = {
  DEAD_INTERACTION_CODES,
  isDeadInteractionError,
  safeDeferReply,
  safeInteractionReply,
  safeReply,
};
