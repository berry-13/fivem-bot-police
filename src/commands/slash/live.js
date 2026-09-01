'use strict';

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  EmbedBuilder,
  InteractionContextType,
} = require('discord.js');
const {
  MAX_STREAMERS,
  PLATFORMS,
  addStreamer,
  listStreamers,
  matchStreamers,
  platformLabel,
  profileUrl,
  removeStreamer,
  resolveStreamers,
  streamerKey,
} = require('../../lib/live-store');
const { optionalEnv } = require('../../lib/env');
const { safeDeferReply, safeInteractionReply } = require('../../lib/safe-reply');

const PLATFORM_CHOICES = Object.entries(PLATFORMS).map(([value, meta]) => ({
  name: meta.label,
  value,
}));

// Limiti di Discord: 25 scelte per autocomplete, 1024 caratteri per campo embed.
const MAX_AUTOCOMPLETE_CHOICES = 25;
const MAX_FIELD_CHARS = 1024;

const COLOR_LISTA = 0x5865f2;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('live')
    .setDescription('Gestisci gli account monitorati per le notifiche live')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    // Solo dentro un server: in DM il controllo Administrator non si applica e
    // chiunque potrebbe riscrivere la lista.
    .setContexts(InteractionContextType.Guild)
    .addSubcommand(sub =>
      sub
        .setName('aggiungi')
        .setDescription('Aggiungi un account da monitorare')
        .addStringOption(option =>
          option
            .setName('piattaforma')
            .setDescription('Dove trasmette')
            .setRequired(true)
            .addChoices(...PLATFORM_CHOICES),
        )
        .addStringOption(option =>
          option
            .setName('account')
            .setDescription('Username o link del canale')
            .setRequired(true),
        )
        .addStringOption(option =>
          option
            .setName('nome')
            .setDescription('Nome da mostrare nella notifica (default: lo username)'),
        ),
    )
    .addSubcommand(sub =>
      sub
        .setName('rimuovi')
        .setDescription('Togli un account dalla lista')
        .addStringOption(option =>
          option
            .setName('account')
            .setDescription('Scegli dalla lista, o scrivi piattaforma:username')
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand(sub => sub.setName('lista').setDescription('Mostra gli account monitorati')),

  async execute(interaction) {
    // setContexts esclude i DM lato Discord, ma un comando registrato prima di
    // questa modifica resta come era: meglio ricontrollare qui.
    if (!interaction.inGuild()) {
      await replyEphemeral(interaction, '❌ Questo comando funziona solo in un server.');
      return;
    }

    // Ack immediato: se il canale delle notifiche non e' in cache il controllo
    // qui sotto fa una fetch a Discord, e i 3 secondi dell'interazione
    // scadrebbero prima di qualunque risposta.
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const stato = await statoGuildDelleLive(interaction);

    if (stato === 'altro-server') {
      await replyEphemeral(
        interaction,
        '❌ Le notifiche live sono configurate su un altro server: la lista si gestisce da lì.',
      );
      return;
    }

    if (stato === 'non-verificabile') {
      await replyEphemeral(
        interaction,
        '❌ Non riesco a risalire al server del canale delle notifiche (`LIVE_CHANNEL_ID`): ' +
          'controlla che l\'id sia giusto e che il bot veda quel canale. ' +
          'Finche\' non e\' verificabile la lista non si tocca.',
      );
      return;
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'aggiungi') {
      await handleAdd(interaction);
      return;
    }

    if (sub === 'rimuovi') {
      await handleRemove(interaction);
      return;
    }

    await handleList(interaction);
  },

  /**
   * Suggerisce solo gli account davvero in lista: il valore inviato e'
   * "piattaforma:username", cosi' due account omonimi su piattaforme diverse
   * restano distinguibili.
   */
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused();
    // Qui non si puo' fare defer e la finestra e' di pochi secondi: controllo
    // solo sulla cache, senza fetch. Canale non in cache = nessun suggerimento.
    const consentito =
      interaction.inGuild() && (await statoGuildDelleLive(interaction, { soloCache: true })) === 'ok';
    const choices = (consentito ? matchStreamers(listStreamers(), focused) : [])
      .slice(0, MAX_AUTOCOMPLETE_CHOICES)
      .map(streamer => ({
        name: `${platformLabel(streamer.platform)}: ${streamer.displayName || streamer.id}`.slice(0, 100),
        value: streamerKey(streamer),
      }));

    try {
      await interaction.respond(choices);
    } catch (error) {
      // La finestra di autocomplete dura pochi secondi: se e' già scaduta non
      // c'e' niente da recuperare, basta non far cadere l'handler.
      console.warn(`Autocomplete /live: risposta non consegnata: ${error.message}`);
    }
  },
};

/**
 * Risposta solo per chi ha lanciato il comando. Dopo un defer il messaggio si
 * modifica (ed e' già ephemeral): rimandare il flag farebbe litigare l'API.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {string | object} payload testo o corpo completo
 */
function replyEphemeral(interaction, payload) {
  const corpo = typeof payload === 'string' ? { content: payload } : payload;
  const finale = { allowedMentions: { parse: [] }, ...corpo };
  if (!interaction.deferred && !interaction.replied) {
    finale.flags = MessageFlags.Ephemeral;
  }
  return safeInteractionReply(interaction, finale);
}

/**
 * La lista e il canale delle notifiche sono globali al processo, mentre il
 * permesso Administrator vale nel server da cui arriva l'interazione: senza
 * questo controllo l'amministratore di un altro server dove sta il bot
 * potrebbe cambiare gli account annunciati qui.
 * Con LIVE_CHANNEL_ID vuoto le notifiche sono spente e non c'e' niente da
 * proteggere; se invece il canale e' configurato ma non si riesce a risalire al
 * suo server si chiude (fail closed): un errore temporaneo di Discord non deve
 * diventare la finestra in cui un altro server riscrive la lista.
 * @param {import('discord.js').BaseInteraction} interaction
 * @returns {Promise<'ok' | 'altro-server' | 'non-verificabile'>}
 */
async function statoGuildDelleLive(interaction, { soloCache = false } = {}) {
  const channelId = optionalEnv('LIVE_CHANNEL_ID');
  if (!channelId) return 'ok';

  const cached = interaction.client.channels.cache.get(channelId);
  const channel =
    cached ??
    (soloCache ? null : await interaction.client.channels.fetch(channelId).catch(() => null));
  if (!channel?.guildId) return 'non-verificabile';

  return channel.guildId === interaction.guildId ? 'ok' : 'altro-server';
}

function formatStreamer(streamer) {
  const name = streamer.displayName ? `${streamer.displayName} (${streamer.id})` : streamer.id;
  return `**${platformLabel(streamer.platform)}** ${name}`;
}

function addErrorMessage(result) {
  switch (result.reason) {
    case 'platform':
      return '❌ Piattaforma non valida. Scegli tra Twitch, TikTok e Kick.';
    case 'id':
      return (
        `❌ Username non valido per ${platformLabel(result.platform)}: serve ${PLATFORMS[result.platform].idHint}. ` +
        `Va bene anche il link del canale (${PLATFORMS[result.platform].profileUrl('nome')}), ` +
        'ma non quello di un video, di una clip o di una sezione del sito.'
      );
    case 'mismatch':
      return (
        `❌ Quel link e' di ${platformLabel(result.detected)}, ma hai scelto ${platformLabel(result.platform)}. ` +
        `Cambia piattaforma o incolla il link ${platformLabel(result.platform)} giusto.`
      );
    case 'duplicate':
      return `ℹ️ ${formatStreamer(result.streamer)} e' già in lista.`;
    case 'limit':
      return `❌ Lista piena (${result.limit} account). Togline uno con \`/live rimuovi\` prima di aggiungere.`;
    default:
      return '❌ Lista non salvata su disco: controlla i log del bot e i permessi della cartella `data/`.';
  }
}

async function handleAdd(interaction) {
  const platform = interaction.options.getString('piattaforma', true);
  const account = interaction.options.getString('account', true);
  const displayName = interaction.options.getString('nome');

  const result = addStreamer({ platform, id: account, displayName });

  if (!result.ok) {
    await replyEphemeral(interaction, addErrorMessage(result));
    return;
  }

  // Lo stato in memoria del monitor puo' avere ancora la voce di un giro
  // precedente (tipico: rimosso e riaggiunto per cambiare il nome mostrato).
  // Azzerarla e' quello che tiene la promessa: chi entra viene solo fotografato,
  // non annunciato se e' già in live.
  interaction.client.liveMonitor?.forget?.(result.streamer);

  await replyEphemeral(
    interaction,
    `✅ Aggiunto ${formatStreamer(result.streamer)} <${profileUrl(result.streamer)}>\n` +
      `Account monitorati: ${result.total}. La notifica parte al primo passaggio offline -> live ` +
      'dopo il prossimo controllo (nessun annuncio se e\' già in live adesso).',
  );
}

async function handleRemove(interaction) {
  const query = interaction.options.getString('account', true);
  const streamers = listStreamers();

  if (streamers.length === 0) {
    await replyEphemeral(interaction, 'ℹ️ La lista e\' già vuota: non c\'e\' niente da rimuovere.');
    return;
  }

  // Match esatto, non quello tollerante dei suggerimenti: "salvi" non deve
  // cancellare "salvinosalvo" solo perche' e' l'unico che gli somiglia.
  const matches = resolveStreamers(streamers, query);

  if (matches.length === 0) {
    await replyEphemeral(
      interaction,
      `❌ Nessun account in lista corrisponde esattamente a "${query}". ` +
        'Scegli una voce dai suggerimenti, oppure scrivi lo username esatto, ' +
        'il link del canale o `piattaforma:username`. La lista e\' in `/live lista`.',
    );
    return;
  }

  if (matches.length > 1) {
    // Stesso username su piattaforme diverse: chiediamo quale, invece di
    // togliere quello sbagliato.
    const elenco = matches.map(streamer => `\`${streamerKey(streamer)}\``).join(', ');
    await replyEphemeral(
      interaction,
      `❌ "${query}" corrisponde a ${matches.length} account: ${elenco}.\n` +
        'Riprova indicando anche la piattaforma (o scegli una voce dai suggerimenti).',
    );
    return;
  }

  const result = removeStreamer(matches[0]);

  if (!result.ok) {
    await replyEphemeral(
      interaction,
      result.reason === 'missing'
        ? `❌ ${formatStreamer(matches[0])} non e' più in lista.`
        : '❌ Lista non salvata su disco: controlla i log del bot e i permessi della cartella `data/`.',
    );
    return;
  }

  // Via anche lo stato in memoria: un giro in corso non lo annuncia (controlla
  // la lista prima di inviare) e una riaggiunta ripartirebbe da zero comunque.
  interaction.client.liveMonitor?.forget?.(result.streamer);

  await replyEphemeral(
    interaction,
    `✅ Rimosso ${formatStreamer(result.streamer)}. Account monitorati: ${result.total}.`,
  );
}

/**
 * Righe di un campo embed senza sfondare i 1024 caratteri: con la lista piena
 * i link farebbero saltare l'invio dell'embed.
 * @param {string[]} lines
 */
function clampField(lines) {
  const kept = [];
  let length = 0;

  for (const line of lines) {
    const cost = line.length + 1;
    if (length + cost > MAX_FIELD_CHARS - 24) break;
    kept.push(line);
    length += cost;
  }

  const hidden = lines.length - kept.length;
  if (hidden > 0) kept.push(`… e altri ${hidden}`);
  return kept.join('\n');
}

async function handleList(interaction) {
  const streamers = listStreamers();

  if (streamers.length === 0) {
    await replyEphemeral(
      interaction,
      'ℹ️ Nessun account monitorato. Aggiungine uno con `/live aggiungi`.',
    );
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle('Account monitorati per le notifiche live')
    .setColor(COLOR_LISTA)
    .setFooter({ text: `${streamers.length}/${MAX_STREAMERS} account - gestisci con /live aggiungi e /live rimuovi` });

  for (const platform of Object.keys(PLATFORMS)) {
    const perPlatform = streamers.filter(streamer => streamer.platform === platform);
    if (perPlatform.length === 0) continue;

    embed.addFields({
      name: `${platformLabel(platform)} (${perPlatform.length})`,
      value: clampField(
        perPlatform.map(
          streamer => `- [${streamer.displayName || streamer.id}](${profileUrl(streamer)})`,
        ),
      ),
    });
  }

  await replyEphemeral(interaction, { embeds: [embed] });
}
