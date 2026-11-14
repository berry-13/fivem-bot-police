'use strict';

const path = require('path');
const { AttachmentBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { GlobalFonts, createCanvas, loadImage } = require('@napi-rs/canvas');

const config = require('../config/benvenuto');

const ASSETS = path.join(__dirname, '..', '..', 'assets');
GlobalFonts.registerFromPath(path.join(ASSETS, 'fonts', 'Cinzel.ttf'), 'Cinzel');
GlobalFonts.registerFromPath(path.join(ASSETS, 'fonts', 'Oswald.ttf'), 'Oswald');

const W = 1200;
const H = 500;
const ORO = '#d4af5a';
const ORO_CHIARO = '#f3dc9b';
const ORO_SCURO = '#8c6a26';
const NOME_FILE = 'benvenuto.jpg';

let distintivo;
function caricaDistintivo() {
  distintivo ??= loadImage(path.join(ASSETS, 'distintivo.png'));
  return distintivo;
}

function gradienteOro(ctx, x0, y0, x1, y1) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, ORO_SCURO);
  g.addColorStop(0.4, ORO_CHIARO);
  g.addColorStop(1, ORO);
  return g;
}

// Testo con spaziatura tra le lettere (canvas non la supporta ovunque).
function testoSpaziato(ctx, testo, x, y, spazio) {
  let cx = x;
  for (const ch of testo) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + spazio;
  }
  return cx - spazio - x;
}

// Riduce il font finche' il testo non entra; poi tronca con i puntini.
function adatta(ctx, testo, maxW, font, size, min) {
  let s = size;
  ctx.font = font(s);
  while (ctx.measureText(testo).width > maxW && s > min) ctx.font = font(--s);
  let t = testo;
  while (ctx.measureText(t).width > maxW && t.length > 1) t = t.slice(0, -2) + '…';
  return t;
}

let foto;
function caricaFoto() {
  foto ??= loadImage(path.join(ASSETS, 'sceriffato.jpg'));
  return foto;
}

// Disegna l'immagine riempiendo il riquadro (come object-fit: cover), con il
// punto (fx, fy) della foto, in frazioni, tenuto il piu' possibile al centro.
function copri(ctx, img, w, h, fx = 0.5, fy = 0.5) {
  const scala = Math.max(w / img.width, h / img.height);
  const sw = w / scala;
  const sh = h / scala;
  const sx = Math.min(Math.max(img.width * fx - sw / 2, 0), img.width - sw);
  const sy = Math.min(Math.max(img.height * fy - sh / 2, 0), img.height - sh);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
}

// Va a capo sulle parole per stare in maxW; al massimo `righe` righe.
function aCapo(ctx, testo, maxW, righe) {
  const parole = testo.split(/\s+/);
  const out = [];
  let riga = '';
  for (const p of parole) {
    const prova = riga ? `${riga} ${p}` : p;
    if (ctx.measureText(prova).width > maxW && riga) {
      out.push(riga);
      riga = p;
    } else {
      riga = prova;
    }
  }
  if (riga) out.push(riga);
  return out.length <= righe ? out : null;
}

// Spezza in due righe dove la piu' lunga e' la piu' corta possibile.
function dueRigheBilanciate(ctx, testo, maxW) {
  const parole = testo.split(/\s+/);
  let migliore = null;
  for (let i = 1; i < parole.length; i++) {
    const a = parole.slice(0, i).join(' ');
    const b = parole.slice(i).join(' ');
    const w = Math.max(ctx.measureText(a).width, ctx.measureText(b).width);
    if (w <= maxW && (!migliore || w < migliore.w)) migliore = { w, righe: [a, b] };
  }
  return migliore?.righe ?? null;
}

/**
 * Card di benvenuto: foto dell'auto dello sceriffato, motto del reparto e
 * frase motivazionale. Uguale per tutti, cambia solo la frase.
 * @param {{ frase: string }} dati
 * @returns {Promise<Buffer>} JPEG
 */
async function disegnaCard({ frase }) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const [img, badge] = await Promise.all([caricaFoto(), caricaDistintivo()]);

  copri(ctx, img, W, H, 0.5, 0.5);

  // Velatura blu notte da sinistra: li' stanno intestazione e frase, mentre
  // l'auto a destra resta pulita. Un filo di scuro anche in alto e in basso.
  const sinistra = ctx.createLinearGradient(0, 0, W * 0.68, 0);
  sinistra.addColorStop(0, 'rgba(8,14,28,0.88)');
  sinistra.addColorStop(0.55, 'rgba(8,14,28,0.55)');
  sinistra.addColorStop(1, 'rgba(8,14,28,0)');
  ctx.fillStyle = sinistra;
  ctx.fillRect(0, 0, W, H);
  const alto = ctx.createLinearGradient(0, 0, 0, H * 0.3);
  alto.addColorStop(0, 'rgba(8,14,28,0.55)');
  alto.addColorStop(1, 'rgba(8,14,28,0)');
  ctx.fillStyle = alto;
  ctx.fillRect(0, 0, W, H * 0.3);
  const basso = ctx.createLinearGradient(0, H * 0.7, 0, H);
  basso.addColorStop(0, 'rgba(8,14,28,0)');
  basso.addColorStop(1, 'rgba(8,14,28,0.6)');
  ctx.fillStyle = basso;
  ctx.fillRect(0, H * 0.7, W, H * 0.3);

  const x = 56;
  ctx.textBaseline = 'alphabetic';

  // Intestazione: distintivo + nome del reparto.
  ctx.drawImage(badge, x, 30, 50, 50);
  ctx.font = '500 24px Oswald';
  ctx.fillStyle = ORO_CHIARO;
  testoSpaziato(ctx, "LOS SANTOS SHERIFF'S DEPARTMENT", x + 64, 64, 5);

  // Frase, grande, al massimo due righe.
  // Colonna di sinistra: la frase non deve finire sopra l'auto.
  const maxW = 640;
  // Prima si prova su una riga rimpicciolendo un po'; se non basta, due righe
  // bilanciate (niente parola orfana sotto).
  let size = 58;
  let righe = null;
  for (; size >= 46 && !righe; size -= 2) {
    ctx.font = `600 ${size}px Oswald`;
    righe = aCapo(ctx, frase, maxW, 1);
  }
  if (righe) size += 2;
  else {
    for (size = 58; size > 30 && !righe; size -= 2) {
      ctx.font = `600 ${size}px Oswald`;
      righe = dueRigheBilanciate(ctx, frase, maxW);
    }
    if (righe) size += 2;
    else righe = [adatta(ctx, frase, maxW, s => `600 ${s}px Oswald`, 30, 20)];
  }
  const interlinea = size * 1.18;
  let y = H - 48 - (righe.length - 1) * interlinea;

  ctx.font = '700 26px Cinzel';
  ctx.fillStyle = gradienteOro(ctx, x, 0, x + 260, 0);
  testoSpaziato(ctx, 'BENVENUTO', x, y - size - 18, 8);

  ctx.font = `600 ${size + 2}px Oswald`;
  ctx.fillStyle = '#ffffff';
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 16;
  for (const r of righe) {
    ctx.fillText(r, x, y);
    y += interlinea;
  }
  ctx.restore();

  // Filo oro in fondo.
  ctx.fillStyle = gradienteOro(ctx, 0, 0, W, 0);
  ctx.fillRect(0, H - 6, W, 6);

  return canvas.encode('jpeg', 88);
}

function scegliFrase(random = Math.random) {
  return config.frasi[Math.floor(random() * config.frasi.length)];
}

/**
 * Messaggio completo (testo, embed, card) per un membro appena entrato.
 * @param {import('discord.js').GuildMember} member
 */
async function messaggioBenvenuto(member) {
  const user = member.user;
  const png = await disegnaCard({ frase: scegliFrase() });

  const passi = config.passi.map(p => `${p.emoji} ${p.testo} <#${p.channelId}>`).join('\n');
  const embed = new EmbedBuilder()
    .setColor(config.color)
    .setAuthor({ name: member.guild.name, iconURL: member.guild.iconURL() ?? undefined })
    .setTitle('Un nuovo volto al Dipartimento')
    .setDescription(
      `Benvenuto ${user}. Prima di metterti in servizio:\n\n` +
        passi,
    )
    .setImage(`attachment://${NOME_FILE}`)
    .setFooter({ text: config.footer })
    .setTimestamp();

  return {
    content: `${user}`,
    embeds: [embed],
    files: [new AttachmentBuilder(png, { name: NOME_FILE })],
    // Il ping arriva solo al nuovo arrivato.
    allowedMentions: { users: [user.id] },
  };
}

const PERMESSI = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
];

async function inviaBenvenuto(member) {
  if (member.user.bot) return null;
  const channel = member.guild.channels.cache.get(config.channelId);
  if (!channel?.isTextBased?.()) {
    console.warn(`Benvenuto: canale ${config.channelId} non trovato o non testuale.`);
    return null;
  }
  const mancanti = channel.permissionsFor?.(member.guild.members.me)?.missing(PERMESSI) ?? [];
  if (mancanti.length > 0) {
    console.warn(`Benvenuto: al bot mancano i permessi in #${channel.name}: ${mancanti.join(', ')}.`);
    return null;
  }
  return channel.send(await messaggioBenvenuto(member));
}

module.exports = {
  disegnaCard,
  inviaBenvenuto,
  scegliFrase,
  messaggioBenvenuto,
};
