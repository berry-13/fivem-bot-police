'use strict';

const {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');
const logConfig = require('../../config/logs');
const store = require('../../lib/logs-store');
const { COLORI, createLogChannels, missingPermissions, sendLog } = require('../../lib/logs');
const { creaScheda } = require('../../lib/log-card');
const { puoTracciare } = require('../../lib/invites');
const { safeDeferReply, safeInteractionReply } = require('../../lib/safe-reply');

const SCELTE_TIPO = logConfig.tipi.map(t => ({ name: t.label, value: t.value }));

// Tipi che dipendono dall'audit log: senza il permesso restano muti.
const TIPI_AUDIT = new Set(['moderazione', 'server', 'membri']);

function etichetta(tipo) {
  return logConfig.tipi.find(t => t.value === tipo)?.label ?? tipo;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup-log')
    .setDescription('Configura i canali di log del server')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
      sub
        .setName('crea')
        .setDescription('Crea una categoria privata con un canale per ogni tipo di log')
        .addRoleOption(opt =>
          opt.setName('staff').setDescription('Ruolo che puo\' leggere i log (in sola lettura)'),
        ),
    )
    .addSubcommand(sub =>
      sub
        .setName('imposta')
        .setDescription('Usa un canale esistente per un tipo di log')
        .addStringOption(opt =>
          opt.setName('tipo').setDescription('Tipo di log').setRequired(true).addChoices(...SCELTE_TIPO),
        )
        .addChannelOption(opt =>
          opt
            .setName('canale')
            .setDescription('Canale dove mandare i log')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        ),
    )
    .addSubcommand(sub =>
      sub
        .setName('disattiva')
        .setDescription('Smetti di mandare un tipo di log (il canale non viene eliminato)')
        .addStringOption(opt =>
          opt
            .setName('tipo')
            .setDescription('Tipo di log')
            .setRequired(true)
            .addChoices(...SCELTE_TIPO, { name: 'Tutti', value: 'tutti' }),
        ),
    )
    .addSubcommand(sub => sub.setName('stato').setDescription('Mostra la configurazione e i permessi mancanti')),

  async execute(interaction) {
    // Ack subito: "crea" puo' richiedere diverse chiamate a Discord.
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const guild = interaction.guild;
    if (!guild) {
      await safeInteractionReply(interaction, {
        content: 'Questo comando funziona solo in un server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const sub = interaction.options.getSubcommand();
    const handler = { crea, imposta, disattiva, stato }[sub];
    await handler(interaction, guild);
  },
};

async function crea(interaction, guild) {
  const staffRole = interaction.options.getRole('staff');

  let risultato;
  try {
    risultato = await createLogChannels(guild, { staffRole });
  } catch (error) {
    if (error.code !== 'LOG_MISSING_PERMISSIONS') console.error('Errore nella creazione dei canali di log:', error);
    await safeInteractionReply(interaction, {
      content:
        `Impossibile creare i canali di log: ${error.message}.\n` +
        'Al bot servono i permessi **Gestire i canali** e **Gestire i ruoli**.',
    });
    return;
  }

  const righe = [
    ...risultato.creati.map(({ tipo, channel }) => `**${tipo.label}**: ${channel} (nuovo)`),
    ...risultato.riusati.map(({ tipo, channel }) => `**${tipo.label}**: ${channel} (gia' presente, permessi aggiornati)`),
    ...risultato.esterni.map(
      ({ tipo, channel }) => `**${tipo.label}**: ${channel} (scelto con imposta, permessi non toccati)`,
    ),
  ];

  await safeInteractionReply(
    interaction,
    creaScheda({
      colore: COLORI.entrato,
      titolo: 'Log configurati',
      sottotitolo: `Categoria ${risultato.categoria.name}`,
      corpo: righe.join('\n') + avvisoAuditLog(guild),
      piede: [staffRole ? `Lettura per ${staffRole.name}` : 'Visibili solo agli amministratori'],
    }),
  );
}

async function imposta(interaction, guild) {
  const tipo = interaction.options.getString('tipo', true);
  const channel = interaction.options.getChannel('canale', true);

  const mancanti = missingPermissions(channel, guild.members.me);
  if (mancanti.length > 0) {
    await safeInteractionReply(interaction, {
      content: `Non posso scrivere log in ${channel}: mi mancano ${mancanti.map(p => `\`${p}\``).join(', ')}.`,
    });
    return;
  }

  store.setChannel(guild.id, tipo, channel.id);

  // Conferma nel canale stesso: prova che il bot ci scrive davvero.
  await sendLog(
    guild,
    tipo,
    creaScheda({
      colore: COLORI.info,
      titolo: `Log ${etichetta(tipo).toLowerCase()} attivi`,
      corpo: `Da ora questo canale riceve i log di tipo **${etichetta(tipo)}**.`,
      piede: [`Configurato da ${interaction.user.tag}`],
    }),
  );

  await safeInteractionReply(interaction, {
    content: `Log **${etichetta(tipo)}** impostati in ${channel}.${TIPI_AUDIT.has(tipo) ? avvisoAuditLog(guild) : ''}`,
  });
}

async function disattiva(interaction, guild) {
  const tipo = interaction.options.getString('tipo', true);
  const tipi = tipo === 'tutti' ? logConfig.tipi.map(t => t.value) : [tipo];

  const rimossi = tipi.filter(t => store.removeChannel(guild.id, t));
  const content =
    rimossi.length > 0
      ? `Log disattivati: ${rimossi.map(t => `**${etichetta(t)}**`).join(', ')}. I canali non sono stati eliminati.`
      : 'Nessun log da disattivare: non era configurato.';

  await safeInteractionReply(interaction, { content });
}

async function stato(interaction, guild) {
  const canali = store.getChannels(guild.id);
  const me = guild.members.me;

  const righe = logConfig.tipi.map(tipo => {
    const channelId = canali[tipo.value];
    if (!channelId) return `**${tipo.label}**: non configurato`;

    const channel = guild.channels.cache.get(channelId);
    if (!channel) return `**${tipo.label}**: canale eliminato (${channelId}), rilancia \`/setup-log crea\``;

    const mancanti = me ? missingPermissions(channel, me) : [];
    if (mancanti.length > 0) {
      return `**${tipo.label}**: ${channel}, permessi mancanti ${mancanti.map(p => `\`${p}\``).join(', ')}`;
    }
    return `**${tipo.label}**: ${channel}`;
  });

  const audit = me?.permissions?.has(PermissionFlagsBits.ViewAuditLog);
  const scheda = creaScheda({
    colore: COLORI.info,
    titolo: 'Configurazione log',
    sottotitolo: guild.name,
    immagine: guild.iconURL?.({ size: 128 }) ?? undefined,
    corpo: righe.join('\n'),
    campi: [
      {
        nome: 'Registro attivita\'',
        valore: audit
          ? 'Accessibile: moderazione, ruoli, nickname e modifiche al server arrivano con autore.'
          : 'Manca **Visualizzare il registro attivita\'**: moderazione, ruoli, nickname e ' +
            'modifiche al server non verranno loggati.',
      },
      {
        nome: 'Inviti',
        valore: puoTracciare(guild)
          ? 'Tracciati: il log degli ingressi dice quale invito e\' stato usato.'
          : 'Manca **Gestire il server**: il log degli ingressi non puo\' dire quale invito e\' stato usato.',
      },
    ],
  });

  await safeInteractionReply(interaction, scheda);
}

function avvisoAuditLog(guild) {
  if (guild.members.me?.permissions?.has(PermissionFlagsBits.ViewAuditLog)) return '';
  return (
    '\n\nAttenzione: senza il permesso **Visualizzare il registro attivita\'** i log di moderazione, ' +
    'ruoli, nickname e server restano vuoti.'
  );
}
