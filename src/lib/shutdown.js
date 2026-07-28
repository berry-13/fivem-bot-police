'use strict';

/**
 * Chiude la connessione al gateway prima di terminare il processo.
 * Senza questo, "docker compose stop" uccide il bot mentre la websocket e'
 * ancora aperta e Discord lo considera online per qualche minuto.
 *
 * proc e' iniettabile per i test; l'handler viene restituito per lo stesso motivo.
 */
function registerShutdown(client, { proc = process, signals = ['SIGINT', 'SIGTERM'] } = {}) {
  let shuttingDown = false;

  const handleSignal = async signal => {
    // Un secondo segnale mentre stiamo gia' chiudendo non deve far ripartire
    // la procedura da capo.
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`Ricevuto ${signal}, disconnessione in corso...`);

    try {
      await client.destroy();
    } catch (error) {
      console.error('Errore durante la disconnessione:', error);
    }

    proc.exit(0);
  };

  for (const signal of signals) {
    proc.on(signal, () => handleSignal(signal));
  }

  return handleSignal;
}

module.exports = { registerShutdown };
