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
const { safeInteractionReply } = require('../../lib/safe-reply');

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

    if (!(await isGuildDelleLive(interaction))) {
      await replyEphemeral(
        interaction,
        '❌ Le notifiche live sono configurate su un altro server: la lista si gestisce da lì.',
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
    const inLista = interaction.inGuild() && (await isGuildDelleLive(interaction));
    const choices = (inLista ? matchStreamers(listStreamers(), focused) : [])
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

function replyEphemeral(interaction, content) {
  return safeInteractionReply(interaction, {
    content,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
}

/**
 * La lista e il canale delle notifiche sono globali al processo, mentre il
 * permesso Administrator vale nel server da cui arriva l'interazione: senza
 * questo controllo l'amministratore di un altro server dove sta il bot
 * potrebbe cambiare gli account annunciati qui.
 * Con LIVE_CHANNEL_ID vuoto (notifiche spente) o con un canale irraggiungibile
 * non c'e' un server da proteggere e il comando resta usabile.
 * @param {import('discord.js').BaseInteraction} interaction
 */
async function isGuildDelleLive(interaction) {
  const channelId = optionalEnv('LIVE_CHANNEL_ID');
  if (!channelId) return true;

  const cached = interaction.client.channels.cache.get(channelId);
  const channel =
    cached ?? (await interaction.client.channels.fetch(channelId).catch(() => null));
  if (!channel?.guildId) return true;

  return channel.guildId === interaction.guildId;
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
        'Puoi incollare anche il link del canale.'
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

  await safeInteractionReply(interaction, {
    embeds: [embed],
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
}
