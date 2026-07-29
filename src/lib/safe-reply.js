'use strict';

/**
 * Le risposte a Discord possono fallire per cause fuori dal nostro controllo
 * (permessi mancanti, canale cancellato, interazione scaduta). Questi helper
 * assorbono il rejection: un errore mentre segnaliamo un errore non deve
 * diventare una unhandled rejection e buttare giu' il processo.
 */

async function safeReply(message, payload) {
  try {
    await message.reply(payload);
  } catch (error) {
    console.error('Impossibile rispondere al messaggio:', error);
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
    console.error("Impossibile rispondere all'interazione:", error);
  }
}

module.exports = { safeReply, safeInteractionReply };
