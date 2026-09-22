'use strict';

const { AuditLogEvent, PermissionFlagsBits } = require('discord.js');

/**
 * Traccia quale invito ha usato chi entra. Discord non lo dice: si tiene una
 * foto degli utilizzi di ogni invito e, a ogni ingresso, si guarda quale e'
 * salito.
 *
 * Casi coperti oltre al banale "un invito e' salito di uno":
 * - URL personalizzato del server (vanity), con i suoi utilizzi a parte;
 * - invito a utilizzi limitati che si esaurisce proprio con questo ingresso:
 *   Discord lo cancella, quindi non sale, sparisce;
 * - ingressi quasi simultanei: i confronti per server sono messi in fila,
 *   altrimenti due ingressi leggerebbero la stessa foto.
 *
 * Serve il permesso Gestire il server (per leggere inviti e vanity) e
 * l'intent GuildInvites (per inviteCreate/inviteDelete).
 */

const foto = new Map(); // guildId -> Map(code -> invito)
const vanity = new Map(); // guildId -> utilizzi del vanity, o null
const eliminati = new Map(); // guildId -> Map(code -> { ...invito, eliminatoIl })
const code = new Map(); // guildId -> promise dell'ultimo confronto in coda
const pendenti = new Map(); // guildId -> { fonti: Map(code -> invito), unita, il }

// Utilizzi gia' visti ma non ancora assegnati: oltre questa eta' l'ingresso a
// cui spettavano e' andato perso (evento mancato) e non vanno regalati a un altro.
const FINESTRA_PENDENTI_MS = 30_000;

// Un invito esaurito da un ingresso viene cancellato un attimo prima che
// arrivi guildMemberAdd: oltre questa finestra non e' piu' un candidato.
const FINESTRA_ELIMINATI_MS = 15_000;

function puoTracciare(guild) {
  return Boolean(guild?.members?.me?.permissions?.has(PermissionFlagsBits.ManageGuild));
}

function istantanea(invite) {
  return {
    code: invite.code,
    uses: invite.uses ?? 0,
    maxUses: invite.maxUses ?? 0,
    inviterId: invite.inviterId ?? invite.inviter?.id ?? null,
  };
}

async function leggiInviti(guild) {
  const inviti = await guild.invites.fetch({ cache: false });
  return new Map([...inviti.values()].map(i => [i.code, istantanea(i)]));
}

async function leggiVanity(guild) {
  if (!guild.vanityURLCode) return null;
  try {
    const dati = await guild.fetchVanityData();
    return dati.uses ?? null;
  } catch {
    return null;
  }
}

/** Foto iniziale, da fare all'avvio: senza, il primo ingresso non e' tracciabile. */
async function initInviteTracking(guild) {
  if (!puoTracciare(guild)) return false;
  try {
    foto.set(guild.id, await leggiInviti(guild));
    vanity.set(guild.id, await leggiVanity(guild));
    return true;
  } catch (error) {
    console.warn(`Tracciamento inviti non disponibile in ${guild.name}: ${error.message}`);
    return false;
  }
}

function onInviteCreate(invite) {
  const guildId = invite.guild?.id;
  foto.get(guildId)?.set(invite.code, istantanea(invite));
}

function onInviteDelete(invite) {
  const guildId = invite.guild?.id;
  const precedente = foto.get(guildId)?.get(invite.code);
  if (!precedente) return;
  foto.get(guildId).delete(invite.code);

  // Lo teniamo per FINESTRA_ELIMINATI_MS: se e' stato cancellato perche'
  // esaurito da un ingresso, quell'ingresso arriva subito dopo e deve trovarlo.
  if (!eliminati.has(guildId)) eliminati.set(guildId, new Map());
  eliminati.get(guildId).set(invite.code, { ...precedente, eliminatoIl: Date.now() });
}

function utilizziTotali(mappa, inviterId) {
  if (!inviterId) return null;
  let totale = 0;
  for (const invito of mappa.values()) {
    if (invito.inviterId === inviterId) totale += invito.uses;
  }
  return totale;
}

/**
 * Codici di inviti cancellati a mano di recente. Un invito esaurito lo
 * cancella Discord senza voce nel registro, uno cancellato da qualcuno la ha:
 * e' l'unico modo per distinguerli. null se il registro non e' leggibile.
 */
async function codiciEliminatiAMano(guild) {
  if (!guild.members.me?.permissions?.has(PermissionFlagsBits.ViewAuditLog)) return null;
  try {
    const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.InviteDelete, limit: 10 });
    const codici = new Set();
    for (const entry of logs.entries.values()) {
      const codice = entry.changes?.find(c => c.key === 'code')?.old;
      if (codice) codici.add(codice);
    }
    return codici;
  } catch {
    return null;
  }
}

async function confronta(guild) {
  if (!puoTracciare(guild)) return { stato: 'permessi' };

  const prima = foto.get(guild.id);
  const vanityPrima = vanity.get(guild.id);

  let dopo;
  try {
    dopo = await leggiInviti(guild);
  } catch {
    // L'ingresso di adesso ha gia' fatto salire un contatore che non abbiamo
    // visto: confrontare il prossimo con la foto vecchia gli attribuirebbe
    // quell'invito. Buttiamo foto e sospesi; la prossima lettura riuscita fa
    // da nuova base.
    foto.delete(guild.id);
    vanity.delete(guild.id);
    pendenti.delete(guild.id);
    return { stato: 'errore' };
  }
  const vanityDopo = await leggiVanity(guild);
  foto.set(guild.id, dopo);
  vanity.set(guild.id, vanityDopo);

  // Nessuna foto precedente (avvio fallito, server nuovo): questa diventa la base.
  if (!prima) return { stato: 'sconosciuto' };

  // Piu' persone entrate prima che il primo confronto finisca: il fetch vede
  // i contatori salire di piu' di uno. Ogni ingresso consuma un'unita'; le
  // altre restano in sospeso, con le fonti possibili, per i successivi in coda.
  const inSospeso = pendenti.get(guild.id);
  pendenti.delete(guild.id);
  const sospesoValido = inSospeso && Date.now() - inSospeso.il < FINESTRA_PENDENTI_MS;

  const fonti = new Map(sospesoValido ? inSospeso.fonti : []);
  let unita = sospesoValido ? inSospeso.unita : 0;
  for (const invito of dopo.values()) {
    const delta = invito.uses - (prima.get(invito.code)?.uses ?? 0);
    if (delta > 0) {
      fonti.set(invito.code, invito);
      unita += delta;
    }
  }
  // L'URL personalizzato e' una fonte come le altre: se sale insieme a un
  // invito normale nello stesso confronto, gli ingressi non vanno confusi.
  if (vanityPrima !== null && vanityPrima !== undefined && vanityDopo !== null && vanityDopo > vanityPrima) {
    fonti.set(guild.vanityURLCode, {
      code: guild.vanityURLCode,
      uses: vanityDopo,
      maxUses: 0,
      inviterId: null,
      vanity: true,
    });
    unita += vanityDopo - vanityPrima;
  }

  if (unita > 0 && fonti.size > 0) {
    if (unita > 1) pendenti.set(guild.id, { fonti, unita: unita - 1, il: Date.now() });
    if (fonti.size === 1) {
      const [invito] = fonti.values();
      if (invito.vanity) return { stato: 'vanity', code: invito.code, uses: invito.uses };
      return { stato: 'invito', invito, totaleInvitante: utilizziTotali(dopo, invito.inviterId) };
    }
    // Piu' fonti diverse salite insieme: non si puo' sapere chi ha usato quale.
    return { stato: 'ambiguo', candidati: [...fonti.values()] };
  }

  // Inviti a utilizzi limitati spariti al posto di salire: sia quelli di cui e'
  // gia' arrivato inviteDelete, sia quelli per cui arrivera' dopo.
  const adesso = Date.now();
  const recenti = eliminati.get(guild.id) ?? new Map();
  for (const [codice, invito] of recenti) {
    if (adesso - invito.eliminatoIl > FINESTRA_ELIMINATI_MS) recenti.delete(codice);
  }
  const candidati = new Map();
  for (const invito of [...prima.values(), ...recenti.values()]) {
    if (dopo.has(invito.code)) continue;
    if (invito.maxUses > 0 && invito.uses + 1 >= invito.maxUses) candidati.set(invito.code, invito);
  }
  if (candidati.size === 0) return { stato: 'sconosciuto' };

  const aMano = await codiciEliminatiAMano(guild);
  if (aMano) {
    for (const codice of aMano) candidati.delete(codice);
  }
  if (candidati.size === 1) {
    const [invito] = candidati.values();
    recenti.delete(invito.code);
    const usato = { ...invito, uses: invito.uses + 1 };
    // Senza registro non possiamo escludere che l'abbia cancellato qualcuno:
    // lo diciamo come ipotesi, senza attribuire l'ingresso a chi l'ha creato.
    if (!aMano) return { stato: 'probabile', invito: usato };
    return { stato: 'invito', invito: usato, esaurito: true };
  }

  return { stato: 'sconosciuto' };
}

/**
 * Quale invito ha usato chi e' appena entrato. Non lancia mai: nel peggiore
 * dei casi torna { stato: 'sconosciuto' | 'permessi' | 'errore' }.
 */
function trovaInvitoUsato(guild) {
  const precedente = code.get(guild.id) ?? Promise.resolve();
  const turno = precedente.then(() => confronta(guild)).catch(() => ({ stato: 'errore' }));
  code.set(guild.id, turno);
  return turno;
}

module.exports = {
  initInviteTracking,
  onInviteCreate,
  onInviteDelete,
  puoTracciare,
  trovaInvitoUsato,
  _resetState() {
    foto.clear();
    vanity.clear();
    eliminati.clear();
    code.clear();
    pendenti.clear();
  },
};
