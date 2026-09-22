'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { Collection, PermissionFlagsBits } = require('discord.js');

const TRACCIA_E_REGISTRO = [PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ViewAuditLog];

const {
  initInviteTracking,
  onInviteCreate,
  onInviteDelete,
  trovaInvitoUsato,
  _resetState,
} = require('../src/lib/invites');

beforeEach(() => _resetState());

function invito(code, uses, { maxUses = 0, inviterId = 'mod-1' } = {}) {
  return { code, uses, maxUses, inviterId };
}

/** Un server i cui inviti si cambiano a mano tra un fetch e l'altro. */
function fakeGuild({ inviti = [], permessi = [PermissionFlagsBits.ManageGuild], vanityURLCode = null } = {}) {
  const stato = { inviti, vanityUses: 0, fetchCount: 0, eliminatiAMano: [] };
  const guild = {
    id: 'guild-1',
    name: 'test',
    vanityURLCode,
    stato,
    members: { me: { permissions: { has: p => permessi.includes(p) } } },
    invites: {
      fetch: async () => {
        stato.fetchCount += 1;
        return new Collection(stato.inviti.map(i => [i.code, { ...i }]));
      },
    },
    fetchVanityData: async () => ({ code: vanityURLCode, uses: stato.vanityUses }),
    fetchAuditLogs: async () => ({
      entries: new Collection(
        stato.eliminatiAMano.map((codice, i) => [String(i), { changes: [{ key: 'code', old: codice }] }]),
      ),
    }),
  };
  return guild;
}

test('trova l\'invito i cui utilizzi sono saliti e conta gli ingressi dell\'invitante', async () => {
  const guild = fakeGuild({ inviti: [invito('aaa', 1), invito('bbb', 5, { inviterId: 'mod-2' }), invito('ccc', 2)] });
  await initInviteTracking(guild);

  guild.stato.inviti = [invito('aaa', 2), invito('bbb', 5, { inviterId: 'mod-2' }), invito('ccc', 2)];
  const risultato = await trovaInvitoUsato(guild);

  assert.equal(risultato.stato, 'invito');
  assert.equal(risultato.invito.code, 'aaa');
  assert.equal(risultato.totaleInvitante, 4);
});

test('riconosce l\'URL personalizzato del server', async () => {
  const guild = fakeGuild({ inviti: [invito('aaa', 1)], vanityURLCode: 'sheriff' });
  guild.stato.vanityUses = 10;
  await initInviteTracking(guild);

  guild.stato.vanityUses = 11;
  const risultato = await trovaInvitoUsato(guild);

  assert.deepEqual(risultato, { stato: 'vanity', code: 'sheriff', uses: 11 });
});

test('un invito a utilizzo singolo esaurito dall\'ingresso viene attribuito', async () => {
  const guild = fakeGuild({ inviti: [invito('uno', 0, { maxUses: 1 }), invito('altro', 3)], permessi: TRACCIA_E_REGISTRO });
  await initInviteTracking(guild);

  // Discord cancella l'invito esaurito prima che arrivi guildMemberAdd, senza voce nel registro.
  onInviteDelete({ code: 'uno', guild });
  guild.stato.inviti = [invito('altro', 3)];
  const risultato = await trovaInvitoUsato(guild);

  assert.equal(risultato.stato, 'invito');
  assert.equal(risultato.invito.code, 'uno');
  assert.equal(risultato.invito.uses, 1);
  assert.equal(risultato.esaurito, true);
});

test('un invito limitato cancellato a mano non viene attribuito a chi entra', async () => {
  const guild = fakeGuild({ inviti: [invito('uno', 0, { maxUses: 1 })], permessi: TRACCIA_E_REGISTRO });
  await initInviteTracking(guild);

  // Un moderatore lo cancella, poi entra qualcuno da Scopri server.
  guild.stato.eliminatiAMano = ['uno'];
  onInviteDelete({ code: 'uno', guild });
  guild.stato.inviti = [];

  assert.deepEqual(await trovaInvitoUsato(guild), { stato: 'sconosciuto' });
});

test('senza registro un invito sparito e\' solo probabile, non attribuito', async () => {
  const guild = fakeGuild({ inviti: [invito('uno', 0, { maxUses: 1 })] });
  await initInviteTracking(guild);

  onInviteDelete({ code: 'uno', guild });
  guild.stato.inviti = [];
  const risultato = await trovaInvitoUsato(guild);

  assert.equal(risultato.stato, 'probabile');
  assert.equal(risultato.invito.code, 'uno');
});

test('un invito creato dopo l\'avvio viene tracciato grazie a inviteCreate', async () => {
  const guild = fakeGuild();
  await initInviteTracking(guild);

  onInviteCreate({ code: 'nuovo', uses: 0, maxUses: 0, inviterId: 'mod-3', guild });
  guild.stato.inviti = [invito('nuovo', 1, { inviterId: 'mod-3' })];
  const risultato = await trovaInvitoUsato(guild);

  assert.equal(risultato.invito.code, 'nuovo');
  assert.equal(risultato.invito.inviterId, 'mod-3');
});

test('due ingressi simultanei vengono confrontati uno dopo l\'altro', async () => {
  const guild = fakeGuild({ inviti: [invito('aaa', 0), invito('bbb', 0)] });
  await initInviteTracking(guild);

  // Entrambi gli ingressi sono gia' contati quando parte il primo fetch.
  guild.stato.inviti = [invito('aaa', 1), invito('bbb', 1)];
  const [primo, secondo] = await Promise.all([trovaInvitoUsato(guild), trovaInvitoUsato(guild)]);

  // Due inviti diversi saliti insieme: nessuno dei due ingressi si puo'
  // attribuire con certezza, ma entrambi sanno tra quali inviti scegliere,
  // invece di attribuirsi lo stesso invito o finire come sconosciuti.
  assert.equal(primo.stato, 'ambiguo');
  assert.equal(secondo.stato, 'ambiguo');
  assert.deepEqual(secondo.candidati.map(i => i.code).sort(), ['aaa', 'bbb']);
  assert.equal(guild.stato.fetchCount, 3);

  // Le unita' sono finite: un terzo ingresso non eredita nulla.
  assert.equal((await trovaInvitoUsato(guild)).stato, 'sconosciuto');
});

test('senza Gestire il server non interroga Discord', async () => {
  const guild = fakeGuild({ permessi: [] });
  guild.invites.fetch = async () => {
    throw new Error('non deve essere chiamato');
  };

  assert.equal(await initInviteTracking(guild), false);
  assert.deepEqual(await trovaInvitoUsato(guild), { stato: 'permessi' });
});

test('un errore di Discord non lancia e non blocca la coda del server', async () => {
  const guild = fakeGuild({ inviti: [invito('aaa', 0)] });
  await initInviteTracking(guild);

  const fetchOriginale = guild.invites.fetch;
  guild.invites.fetch = async () => {
    throw new Error('503');
  };
  assert.deepEqual(await trovaInvitoUsato(guild), { stato: 'errore' });

  // Chi e' entrato durante l'errore ha usato "aaa". Il prossimo arriva da
  // Scopri server: non deve ereditare quell'utilizzo dalla foto vecchia.
  guild.invites.fetch = fetchOriginale;
  guild.stato.inviti = [invito('aaa', 1)];
  assert.deepEqual(await trovaInvitoUsato(guild), { stato: 'sconosciuto' });

  // Da qui la nuova base funziona di nuovo.
  guild.stato.inviti = [invito('aaa', 2)];
  assert.equal((await trovaInvitoUsato(guild)).invito.code, 'aaa');
});

test('due ingressi con lo stesso invito prima del primo confronto vengono attribuiti entrambi', async () => {
  const guild = fakeGuild({ inviti: [invito('aaa', 4), invito('bbb', 0)] });
  await initInviteTracking(guild);

  // Il contatore e' gia' salito di due quando parte il primo confronto.
  guild.stato.inviti = [invito('aaa', 6), invito('bbb', 0)];
  const [primo, secondo] = await Promise.all([trovaInvitoUsato(guild), trovaInvitoUsato(guild)]);

  assert.equal(primo.stato, 'invito');
  assert.equal(primo.invito.code, 'aaa');
  assert.equal(secondo.stato, 'invito');
  assert.equal(secondo.invito.code, 'aaa');

  // Il terzo non eredita nulla: gli utilizzi in sospeso sono finiti.
  assert.equal((await trovaInvitoUsato(guild)).stato, 'sconosciuto');
});

test('un utilizzo in sospeso e un altro invito salito insieme sono ambigui', async () => {
  const guild = fakeGuild({ inviti: [invito('aaa', 0), invito('bbb', 0)] });
  await initInviteTracking(guild);

  guild.stato.inviti = [invito('aaa', 2), invito('bbb', 0)];
  await trovaInvitoUsato(guild);

  guild.stato.inviti = [invito('aaa', 2), invito('bbb', 1)];
  const risultato = await trovaInvitoUsato(guild);

  assert.equal(risultato.stato, 'ambiguo');
  assert.deepEqual(risultato.candidati.map(i => i.code).sort(), ['aaa', 'bbb']);
});

test('un invito normale e l\'URL personalizzato saliti insieme non perdono il secondo ingresso', async () => {
  const guild = fakeGuild({ inviti: [invito('aaa', 0)], vanityURLCode: 'sheriff' });
  guild.stato.vanityUses = 10;
  await initInviteTracking(guild);

  guild.stato.inviti = [invito('aaa', 1)];
  guild.stato.vanityUses = 11;
  const [primo, secondo] = await Promise.all([trovaInvitoUsato(guild), trovaInvitoUsato(guild)]);

  for (const risultato of [primo, secondo]) {
    assert.equal(risultato.stato, 'ambiguo');
    assert.deepEqual(risultato.candidati.map(i => i.code).sort(), ['aaa', 'sheriff']);
  }
  assert.equal((await trovaInvitoUsato(guild)).stato, 'sconosciuto');
});
