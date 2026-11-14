'use strict';

const config = require('../config/matricole');
const store = require('./matricole-store');
const { splitContent } = require('./gerarchia');

const SEND_OPTIONS = { allowedMentions: { parse: [] } };
// "Unknown Message": il messaggio salvato e' stato cancellato a mano.
const MESSAGGIO_SCONOSCIUTO = 10008;

/**
 * Testo dell'elenco: una riga per matricola, in ordine di numero. Le menzioni
 * mostrano il nome attuale a chi legge, senza notificare nessuno.
 * @param {Record<string, string>} elenco { userId: numero }
 */
function buildBoardContent(elenco, options = {}) {
  const { title = config.title, emptyPlaceholder = config.emptyPlaceholder } = options;
  const righe = Object.entries(elenco ?? {})
    .sort(([, a], [, b]) => Number(a) - Number(b))
    .map(([userId, numero]) => `\`${numero}\` — <@${userId}>`);
  return [title, righe.length ? righe.join('\n') : emptyPlaceholder].filter(Boolean).join('\n\n');
}

async function fetchMessage(channel, id) {
  try {
    return await channel.messages.fetch(id);
  } catch (error) {
    if (error?.code === MESSAGGIO_SCONOSCIUTO) return null;
    throw error;
  }
}

/**
 * Riscrive l'elenco nel canale: modifica i messaggi gia' pubblicati, ne
 * aggiunge se il testo e' cresciuto, toglie quelli in avanzo. Se il canale
 * cambia in config si riparte con messaggi nuovi.
 */
async function aggiornaElenco(client, guildId, deps = {}) {
  const { storePath, boardPath } = deps;
  const channel = await client.channels.fetch(config.boardChannelId);
  if (!channel?.isTextBased?.() || channel.guildId !== guildId) return null;

  const elenco = store.loadStore(storePath)[guildId] ?? {};
  const chunks = splitContent(buildBoardContent(elenco));

  const board = store.getBoard(guildId, boardPath);
  const vecchi = board?.channelId === channel.id ? board.messageIds : [];

  const ids = [];
  for (let i = 0; i < chunks.length; i++) {
    const esistente = vecchi[i] ? await fetchMessage(channel, vecchi[i]) : null;
    if (esistente) {
      if (esistente.content !== chunks[i]) await esistente.edit({ content: chunks[i], ...SEND_OPTIONS });
      ids.push(esistente.id);
    } else {
      const nuovo = await channel.send({ content: chunks[i], ...SEND_OPTIONS });
      ids.push(nuovo.id);
    }
  }
  for (const id of vecchi.slice(chunks.length)) {
    const msg = await fetchMessage(channel, id);
    if (msg) await msg.delete().catch(() => {});
  }

  store.setBoard(guildId, { channelId: channel.id, messageIds: ids }, boardPath);
  return ids;
}

// Un aggiornamento alla volta per server: due /matricola genera di fila non
// devono pubblicare due copie dell'elenco.
const code = new Map();

function refreshMatricoleBoard(client, guildId, deps = {}) {
  const precedente = code.get(guildId) ?? Promise.resolve();
  const prossimo = precedente
    .catch(() => {})
    .then(() => aggiornaElenco(client, guildId, deps))
    .catch(error => {
      console.error(`Elenco matricole non aggiornato (${guildId}): ${error.message}`);
      return null;
    });
  code.set(guildId, prossimo);
  return prossimo;
}

module.exports = {
  buildBoardContent,
  refreshMatricoleBoard,
};
