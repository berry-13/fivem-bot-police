'use strict';

const {
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ThumbnailBuilder,
  TimestampStyles,
  time,
} = require('discord.js');

/**
 * Scheda di log con i componenti V2 di Discord: un container con il bordo
 * colorato, intestazione con avatar, corpo, campi, piede in piccolo e pulsanti.
 *
 * Con IsComponentsV2 il messaggio non puo' avere content ne' embed, e tutto il
 * testo dei TextDisplay insieme non puo' superare 4000 caratteri: la scheda
 * accorcia il corpo per restare sotto, invece di far fallire la send.
 */
const LIMITE_TESTO_TOTALE = 4000;
const MARGINE = 100;
const LIMITE_CAMPO = 1000;

// Un campo corto sta su una riga ("**Canale:** #generale"), uno lungo, su
// piu' righe o citato va in un blocco suo: "> " vale solo a inizio riga.
const CAMPO_CORTO = 80;

function tronca(testo, max) {
  if (testo === undefined || testo === null) return testo;
  const stringa = String(testo);
  if (max <= 0) return '';
  return stringa.length > max ? `${stringa.slice(0, max - 1)}…` : stringa;
}

/** Testo in blockquote, riga per riga: un "> " solo vale solo per la prima. */
function citazione(testo) {
  return String(testo)
    .split('\n')
    .map(riga => `> ${riga}`)
    .join('\n');
}

function isCorto(campo) {
  return (
    !campo.valore.includes('\n') &&
    !campo.valore.startsWith('> ') &&
    campo.nome.length + campo.valore.length <= CAMPO_CORTO
  );
}

function blocchiCampi(campi) {
  const blocchi = [];
  let corti = [];

  const chiudiCorti = () => {
    if (corti.length === 0) return;
    blocchi.push(corti.map(c => `**${c.nome}:** ${c.valore}`).join('\n'));
    corti = [];
  };

  for (const campo of campi) {
    if (isCorto(campo)) {
      corti.push(campo);
    } else {
      chiudiCorti();
      blocchi.push(`**${campo.nome}**\n${campo.valore}`);
    }
  }
  chiudiCorti();
  return blocchi;
}

/**
 * @param {object} scheda
 * @param {number} scheda.colore Colore del bordo.
 * @param {string} scheda.titolo
 * @param {string} [scheda.sottotitolo] Riga piccola sotto il titolo.
 * @param {string} [scheda.immagine] URL della miniatura accanto al titolo.
 * @param {string} [scheda.corpo] Testo principale.
 * @param {boolean} [scheda.cita] Mostra il corpo in blockquote (contenuti utente).
 * @param {{nome: string, valore: string}[]} [scheda.campi]
 * @param {string[]} [scheda.piede] Pezzi del piede, uniti da un punto.
 * @param {Date} [scheda.quando] Momento dell'evento, in fondo al piede.
 * @param {{label: string, url: string}[]} [scheda.pulsanti] Pulsanti link.
 * @param {{nome: string, contenuto: string}} [scheda.file] File allegato mostrato nella scheda.
 */
function creaScheda({
  colore,
  titolo,
  sottotitolo,
  immagine,
  corpo,
  cita = false,
  campi = [],
  piede = [],
  quando = new Date(),
  pulsanti = [],
  file,
}) {
  const testata = [`### ${titolo}`, sottotitolo && `-# ${sottotitolo}`].filter(Boolean).join('\n');
  const blocchi = blocchiCampi(
    campi
      .filter(c => c && c.valore !== undefined && c.valore !== null && c.valore !== '')
      .map(c => ({ nome: c.nome, valore: tronca(c.valore, LIMITE_CAMPO) })),
  );
  const piedeTesto = `-# ${[...piede.filter(Boolean), time(quando, TimestampStyles.ShortDateTime)].join(' · ')}`;

  // Il corpo prende quello che resta del budget dopo il resto della scheda.
  const occupato = [testata, piedeTesto, ...blocchi].reduce((tot, t) => tot + t.length, 0);
  let corpoTesto = null;
  if (corpo) {
    const spazio = LIMITE_TESTO_TOTALE - MARGINE - occupato;
    // Il blockquote aggiunge due caratteri per riga: li togliamo dal budget.
    const righe = String(corpo).split('\n').length;
    corpoTesto = cita ? citazione(tronca(corpo, spazio - righe * 2)) : tronca(corpo, spazio);
  }

  const container = new ContainerBuilder().setAccentColor(colore);

  if (immagine) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(testata))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(immagine)),
    );
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(testata));
  }

  const separatore = () =>
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

  if (corpoTesto) {
    separatore();
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(corpoTesto));
  }

  if (blocchi.length > 0) {
    separatore();
    for (const blocco of blocchi) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(blocco));
    }
  }

  const files = [];
  if (file) {
    files.push(new AttachmentBuilder(Buffer.from(file.contenuto, 'utf8'), { name: file.nome }));
    container.addFileComponents(f => f.setURL(`attachment://${file.nome}`));
  }

  separatore();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(piedeTesto));

  const link = pulsanti.filter(p => p?.url).slice(0, 5);
  if (link.length > 0) {
    container.addActionRowComponents(row =>
      row.addComponents(
        link.map(p => new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(p.label).setURL(p.url)),
      ),
    );
  }

  const payload = { components: [container], flags: MessageFlags.IsComponentsV2 };
  if (files.length > 0) payload.files = files;
  return payload;
}

/** Tutto il testo visibile di una scheda, utile nei test e nei log in console. */
function testoScheda(payload) {
  const testi = [];
  const visita = nodo => {
    if (!nodo || typeof nodo !== 'object') return;
    if (typeof nodo.content === 'string') testi.push(nodo.content);
    for (const valore of Object.values(nodo)) {
      if (Array.isArray(valore)) valore.forEach(visita);
      else if (valore && typeof valore === 'object') visita(valore);
    }
  };
  for (const componente of payload.components ?? []) {
    visita(typeof componente.toJSON === 'function' ? componente.toJSON() : componente);
  }
  return testi.join('\n');
}

module.exports = {
  LIMITE_TESTO_TOTALE,
  citazione,
  creaScheda,
  testoScheda,
  tronca,
};
