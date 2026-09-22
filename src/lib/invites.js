'use strict';

const { PermissionFlagsBits } = require('discord.js');

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

const FINESTRA_ELIMINATI_MS = 60_000;

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

  // Lo teniamo un minuto: se e' stato cancellato perche' esaurito da un
  // ingresso, quell'ingresso arriva subito dopo e deve poterlo trovare.
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

async function confronta(guild) {
  if (!puoTracciare(guild)) return { stato: 'permessi' };

  const prima = foto.get(guild.id);
  const vanityPrima = vanity.get(guild.id);

  let dopo;
  try {
    dopo = await leggiInviti(guild);
  } catch {
    return { stato: 'errore' };
  }
  const vanityDopo = await leggiVanity(guild);
  foto.set(guild.id, dopo);
  vanity.set(guild.id, vanityDopo);

  // Nessuna foto precedente (avvio fallito, server nuovo): questa diventa la base.
  if (!prima) return { stato: 'sconosciuto' };

  const cresciuti = [...dopo.values()].filter(i => i.uses > (prima.get(i.code)?.uses ?? 0));
  if (cresciuti.length === 1) {
    const [invito] = cresciuti;
    return { stato: 'invito', invito, totaleInvitante: utilizziTotali(dopo, invito.inviterId) };
  }
  if (cresciuti.length > 1) return { stato: 'ambiguo', candidati: cresciuti };

  if (vanityPrima !== null && vanityPrima !== undefined && vanityDopo !== null && vanityDopo > vanityPrima) {
    return { stato: 'vanity', code: guild.vanityURLCode, uses: vanityDopo };
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
  if (candidati.size === 1) {
    const [invito] = candidati.values();
    recenti.delete(invito.code);
    return { stato: 'invito', invito: { ...invito, uses: invito.uses + 1 }, esaurito: true };
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
  },
};
