'use strict';

const { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const config = require('../../config/matricole');
const store = require('../../lib/matricole-store');
const { refreshMatricoleBoard } = require('../../lib/matricole-board');
const { safeInteractionReply } = require('../../lib/safe-reply');

const PRIVATO = { flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };

function puoUsarlo(interaction) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  // member.roles e' un GuildMemberRoleManager, o un array di id se il membro
  // arriva grezzo dall'API.
  const ruoli = interaction.member?.roles;
  const ids = Array.isArray(ruoli) ? ruoli : [...(ruoli?.cache?.keys() ?? [])];
  return ids.some(id => config.allowedRoles.includes(id));
}

async function genera(interaction) {
  const utente = interaction.options.getUser('utente', true);
  if (utente.bot) {
    await safeInteractionReply(interaction, { content: '❌ I bot non hanno una matricola.', ...PRIVATO });
    return;
  }

  const result = store.assign(interaction.guild.id, utente.id);
  if (!result.ok) {
    await safeInteractionReply(interaction, {
      content: '❌ Matricole esaurite: tutti i numeri a 4 cifre sono gia\' assegnati.',
      ...PRIVATO,
    });
    return;
  }

  if (result.existing) {
    await safeInteractionReply(interaction, {
      content: `ℹ️ ${utente} ha gia' la matricola **${result.numero}**: non viene rigenerata.`,
      ...PRIVATO,
    });
    return;
  }

  console.log(`/matricola: ${interaction.user.tag} ha assegnato ${result.numero} a ${utente.tag} (${utente.id}).`);
  await safeInteractionReply(interaction, {
    content: `✅ Matricola **${result.numero}** assegnata a ${utente}.`,
    ...PRIVATO,
  });
  // Dopo la risposta: l'elenco pubblico non deve far scadere l'interazione.
  await refreshMatricoleBoard(interaction.client, interaction.guild.id);
}

async function cerca(interaction) {
  const numeroRaw = interaction.options.getString('numero');
  const utente = interaction.options.getUser('utente');
  const guildId = interaction.guild.id;

  if (!numeroRaw === !utente) {
    await safeInteractionReply(interaction, {
      content: '❌ Indica **una** delle due opzioni: `numero` oppure `utente`.',
      ...PRIVATO,
    });
    return;
  }

  if (utente) {
    const numero = store.getByUser(guildId, utente.id);
    await safeInteractionReply(interaction, {
      content: numero
        ? `🔎 ${utente} ha la matricola **${numero}**.`
        : `🔎 ${utente} non ha ancora una matricola.`,
      ...PRIVATO,
    });
    return;
  }

  const numero = store.normalizzaNumero(numeroRaw);
  if (!numero) {
    await safeInteractionReply(interaction, { content: '❌ La matricola e\' un numero di 4 cifre.', ...PRIVATO });
    return;
  }
  const userId = store.getByNumber(guildId, numero);
  await safeInteractionReply(interaction, {
    content: userId
      ? `🔎 La matricola **${numero}** appartiene a <@${userId}> (\`${userId}\`).`
      : `🔎 Nessuno ha la matricola **${numero}**.`,
    ...PRIVATO,
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('matricola')
    .setDescription('Gestione delle matricole del reparto (solo Alto comando)')
    .setDMPermission(false)
    .addSubcommand(sub =>
      sub
        .setName('genera')
        .setDescription('Genera una matricola casuale di 4 cifre e la assegna a un utente')
        .addUserOption(opt => opt.setName('utente').setDescription('A chi assegnarla').setRequired(true)),
    )
    .addSubcommand(sub =>
      sub
        .setName('cerca')
        .setDescription('Trova chi ha una matricola, o la matricola di un utente')
        .addStringOption(opt =>
          opt.setName('numero').setDescription('Matricola di 4 cifre').setMinLength(4).setMaxLength(5),
        )
        .addUserOption(opt => opt.setName('utente').setDescription('Utente di cui vedere la matricola')),
    ),

  puoUsarlo,

  async execute(interaction) {
    if (!interaction.guild) {
      await safeInteractionReply(interaction, { content: '❌ Funziona solo in un server.', ...PRIVATO });
      return;
    }
    if (!puoUsarlo(interaction)) {
      await safeInteractionReply(interaction, {
        content: '⛔ Solo l\'Alto comando puo\' usare questo comando.',
        ...PRIVATO,
      });
      return;
    }

    const sub = interaction.options.getSubcommand();
    if (sub === 'genera') return genera(interaction);
    if (sub === 'cerca') return cerca(interaction);
  },
};
