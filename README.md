# mio-bot

Bot Discord in Node.js costruito su [discord.js](https://discord.js.org) v14, con
comandi slash e comandi testuali a prefisso, caricamento modulare dei comandi e
degli eventi, e deploy in Docker.

## Obiettivo

Avere una base per bot Discord che si possa lasciare accesa e dimenticare.

In concreto significa tre cose:

1. **Non cade.** Nessun errore prevedibile (permessi mancanti, canale
   cancellato, interazione scaduta, comando che lancia un'eccezione) deve
   terminare il processo. Un errore mentre gestiamo un errore nemmeno.
2. **Si estende copiando un file.** Aggiungere un comando vuol dire creare un
   file in `src/commands/`. Nessuna registrazione manuale, nessuna modifica a
   `index.js`. Se un comando e' malformato viene saltato con un messaggio
   esplicito, mai in silenzio.
3. **Gira uguale ovunque.** Stesso comportamento in locale e in container, con i
   segreti passati a runtime e lo spegnimento pulito quando arriva SIGTERM.

Ogni scelta nel codice risponde a uno di questi tre punti.

## Requisiti

- Node.js 20 o superiore (l'immagine Docker usa la 24)
- Un'applicazione registrata sul [Discord Developer Portal](https://discord.com/developers/applications)

## Avvio rapido

```bash
npm install
cp .env.example .env   # poi inserisci DISCORD_TOKEN e CLIENT_ID
npm run deploy         # registra gli slash command su Discord
npm start
```

### Variabili d'ambiente

| Variabile | Obbligatoria | Descrizione |
|---|---|---|
| `DISCORD_TOKEN` | si | Token del bot (Developer Portal, sezione Bot). |
| `CLIENT_ID` | solo per `npm run deploy` | Application ID dell'app. |
| `GUILD_ID` | no | Se valorizzato, registra i comandi solo in quel server, con effetto immediato. Se vuoto la registrazione e' globale e puo' richiedere fino a un'ora. |
| `COMMAND_PREFIX` | no | Prefisso dei comandi testuali, default `!`. |
| `LIVE_CHANNEL_ID` | per le notifiche live | Id del canale Discord dove mandare "X e' in live". |
| `LIVE_ROLE_ID` | no | Chi pingare in ogni notifica live: id di un ruolo, oppure `everyone` (o l'id del server) per `@everyone`. Vuoto = nessun ping. |
| `TWITCH_CLIENT_ID` | per Twitch | Client ID di un'app su [dev.twitch.tv](https://dev.twitch.tv/console). |
| `TWITCH_CLIENT_SECRET` | per Twitch | Client Secret della stessa app. |
| `LIVE_POLL_INTERVAL_MS` | no | Intervallo di controllo (default `60000`, minimo `15000`). |
| `LIVE_STORE_PATH` | no | Dove salvare la lista streamer modificata con `/live` (default `data/live.json`). |

Se manca una variabile obbligatoria il processo esce subito con un messaggio
chiaro, invece di fallire piu' avanti con un errore delle API di Discord.

### Intent da abilitare

Nel Developer Portal, sezione Bot, vanno attivati:

- **Message Content Intent**: senza quello i comandi a prefisso non ricevono il
  testo dei messaggi.
- **Server Members Intent**: senza quello `/setup-gerarchia` non riesce a
  elencare chi ha ogni ruolo.

Gli altri intent usati (`Guilds`, `GuildMessages`, `DirectMessages`) non sono
privilegiati.

## Script

| Comando | Cosa fa |
|---|---|
| `npm start` | Avvia il bot. |
| `npm run dev` | Avvia il bot con riavvio automatico a ogni modifica. |
| `npm run deploy` | Registra gli slash command su Discord. |
| `npm test` | Esegue la suite di test (test runner nativo di Node). |
| `npm run lint` | Analisi statica con ESLint. |

`npm run deploy` va rieseguito ogni volta che cambia il *nome*, la *descrizione*
o le *opzioni* di uno slash command. Non serve quando cambia solo la logica
dentro `execute`.

## Struttura

```
src/
  index.js              Avvio: validazione env, client, loader, spegnimento pulito
  deploy-commands.js    Registrazione degli slash command via REST
  lib/
    env.js              Lettura delle variabili d'ambiente con errori leggibili
    loaders.js          Caricamento e validazione di comandi ed eventi
    safe-reply.js       Risposte che non propagano mai un rejection
    tickets.js          Logica dei ticket condivisa da bottone e comandi
    live.js             Polling Twitch/TikTok/Kick e notifiche live
    live-store.js       Lista streamer su disco, gestita dai comandi /live
  config/
    tickets.js          Categorie dei ticket e nome del canale di log
    live.js             Streamer di partenza (seed del primo avvio)
  events/               Un file per evento del gateway
  commands/slash/       Slash command: { data, execute }
  commands/prefix/      Comandi testuali: { name, execute }
test/                   Test con node:test, nessuna dipendenza esterna
```

## Notifiche live (Twitch / TikTok / Kick)

Il bot controlla periodicamente se gli account monitorati sono in live e, al
passaggio da offline a online, manda un embed nel canale indicato da
`LIVE_CHANNEL_ID`.

La lista si gestisce da Discord con `/live` (solo amministratori, e solo nel
server che contiene il canale di `LIVE_CHANNEL_ID`):

| Comando | Cosa fa |
|---|---|
| `/live aggiungi piattaforma: account: [nome:]` | Aggiunge un account. In `account` va lo username, l'`@handle` o il link del **canale** (`twitch.tv/nome`, `tiktok.com/@nome`, `kick.com/nome`): un link di un'altra piattaforma, o che punta a un video, a una clip o a una sezione del sito, viene rifiutato. `nome` e' facoltativo: e' il nome mostrato nella notifica, default lo username. |
| `/live rimuovi account:` | Toglie un account. Il campo suggerisce quelli in lista; scrivendo a mano serve il valore esatto (username, link o `piattaforma:username`, es. `kick:salvinosalvo`), perche' un pezzo di nome non cancelli l'account sbagliato. |
| `/live lista` | Mostra gli account monitorati, divisi per piattaforma. |

Le modifiche valgono subito: il monitor rilegge la lista a ogni giro di
controllo, non serve riavviare il bot ne' rieseguire `npm run deploy`. La lista
vive in `data/live.json` (percorso cambiabile con `LIVE_STORE_PATH`), quindi
sopravvive ai riavvii e agli aggiornamenti dell'immagine Docker se `data/` e'
su un volume.

Se `LIVE_CHANNEL_ID` e' valorizzato ma il bot non riesce a risalire al server di
quel canale (id sbagliato, canale cancellato, permessi mancanti), `/live`
rifiuta di lavorare e lo dice: meglio un comando fermo che una lista modificabile
da un server qualsiasi mentre il controllo non e' verificabile.

`src/config/live.js` e' solo il punto di partenza: viene copiato in
`data/live.json` al primo avvio e da lì in poi comandano i comandi `/live`.
Streamer preconfigurati:

| Piattaforma | Account |
|---|---|
| Twitch | [salvinosalvo](https://www.twitch.tv/salvinosalvo) |
| TikTok | [@xx_cicci_xx](https://www.tiktok.com/@xx_cicci_xx) |
| Twitch | [ydiablo93](https://www.twitch.tv/ydiablo93) |
| Twitch | [bigtaurus94](https://www.twitch.tv/bigtaurus94) |
| Twitch | [s4k3_tv](https://www.twitch.tv/s4k3_tv) |
| Kick | [salvinosalvo](https://kick.com/salvinosalvo) |

Setup minimo:

1. Copia l'id del canale Discord (Modalita' sviluppatore attiva) in `LIVE_CHANNEL_ID`.
2. Per Twitch: crea un'app su [dev.twitch.tv/console](https://dev.twitch.tv/console)
   (tipo "Application integration" va bene) e metti Client ID e Secret in
   `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET`.
3. TikTok non richiede credenziali: il bot interroga gli endpoint pubblici.
4. Opzionale: `LIVE_ROLE_ID` per pingare a ogni annuncio. Usa l'id di un ruolo,
   oppure `everyone` (o l'id del server) per `@everyone`. Il bot deve avere il
   permesso "Menziona @everyone, @here e tutti i ruoli" se usi `@everyone`.

Comportamento:

- Al **primo** controllo dopo un avvio/riavvio non manda nulla: registra solo lo
  stato attuale, cosi' un bot che riparte a meta' live non risparma il canale.
  Stesso trattamento per un account appena aggiunto con `/live aggiungi`: se e'
  già in live in quel momento non viene annunciato, il primo giro serve solo a
  fotografare lo stato.
- Notifica solo sul passaggio **offline -> live**. Finche' resta in live non
  ripete il messaggio.
- Errori di rete o API vengono loggati e ritentati al giro successivo; il
  processo non cade. Una richiesta fallita non vale come "offline", cosi' quando
  la rete torna non parte un secondo annuncio della stessa live.
- Twitch chiede tutti i canali in una sola chiamata; TikTok e Kick vanno
  interrogati uno per uno, a gruppi di 4 e con 10 secondi di timeout ciascuno.
  Se il giro sfora l'80% dell'intervallo, gli account rimasti passano al giro
  successivo (warning in console) e il giro dopo riparte da loro: nessuno resta
  indietro.
- Senza `LIVE_CHANNEL_ID` il monitor resta spento (warning in console).
- Senza credenziali Twitch gli account TikTok e Kick restano attivi.
- Con la lista vuota il monitor resta acceso e in attesa: appena arriva il primo
  `/live aggiungi` ricomincia a controllare.

## Gerarchia reparto

`/setup-gerarchia` (solo amministratori) manda nel canale corrente la lista
della gerarchia del Sheriff's Department: per ogni grado pinga il ruolo e i
membri che lo hanno (oppure `//` se e' vuoto). I ping sono solo visuali: non
notifichano nessuno.

Dopo il setup il messaggio **si aggiorna da solo** quando assegni/togli un
ruolo della gerarchia o quando un membro con un grado esce dal server. Gli
id del messaggio restano in `data/gerarchia.json` (in Docker: volume
`bot-data`).

Ruoli, ordine e raggruppamenti si cambiano in `src/config/gerarchia.js`.
Richiede **Server Members Intent** (vedi sopra). Rilancia `/setup-gerarchia`
solo se vuoi spostare il pannello in un altro canale (i messaggi vecchi
vengono cancellati).

## Sistema ticket

`/setup-ticket` (solo amministratori) manda nel canale corrente il pannello con
il menu a tendina delle categorie. Le categorie, i ruoli da avvisare e il nome
del canale di log si cambiano in `src/config/tickets.js`.

Chi sceglie una categoria si ritrova un canale privato visibile solo a lui, al
bot e ai ruoli di quella categoria. Il nome porta la categoria in chiaro
(`ticket-richiesta-esame-mario-rossi`) e viene accorciato a 90 caratteri se il
nome utente e' lungo. Con `TICKET_CATEGORY_ID` valorizzato i canali finiscono
sotto quella categoria di Discord.

Alla chiusura la cronologia viene salvata come allegato `.txt` nel canale
`ticket-logs`, creato al volo se non esiste, e il canale viene eliminato dopo
cinque secondi. Se la trascrizione non parte il ticket si chiude lo stesso e il
messaggio lo dice invece di promettere un archivio che non c'e'.

| Azione | Chi puo' usarla |
| --- | --- |
| Bottone **Chiudi Ticket** | chiunque veda il ticket |
| `!close` | chiunque veda il ticket, come il bottone |
| `!add @utente` | solo lo staff |

`!add` accetta la menzione o l'id incollato a mano. Per staff si intende chi ha
il permesso Gestire i canali oppure uno dei ruoli elencati in
`src/config/tickets.js`. Entrambi i comandi funzionano solo dentro un canale
ticket e si rifiutano di toccare `ticket-logs`.

## Aggiungere un comando

Slash command, in `src/commands/slash/`:

```js
'use strict';

const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('saluta')
    .setDescription('Manda un saluto'),
  async execute(interaction, client) {
    await interaction.reply('Ciao!');
  },
};
```

Poi `npm run deploy` per registrarlo.

Comando a prefisso, in `src/commands/prefix/`:

```js
'use strict';

module.exports = {
  name: 'saluta',
  description: 'Manda un saluto',
  async execute(message, args, client) {
    await message.reply('Ciao!');
  },
};
```

I comandi a prefisso non richiedono nessun deploy.

In entrambi i casi va sempre restituita la promise di `reply` (con `await` o
`return`): e' cosi' che l'handler puo' intercettare un eventuale errore invece di
lasciarlo diventare una unhandled rejection.

## Docker

```bash
cp .env.example .env    # inserisci i valori reali
docker compose up -d --build
docker compose logs -f
```

Note sull'immagine:

- build multi-stage, il layer delle dipendenze resta in cache finche' non cambia
  `package-lock.json`
- solo dipendenze di produzione (`npm ci --omit=dev`)
- il processo gira come utente `node`, non come root
- `.env` e' escluso dal contesto di build: il token viene passato a runtime, non
  finisce mai dentro l'immagine
- `init: true` piu' l'handler su SIGTERM danno uno spegnimento pulito: il bot si
  disconnette dal gateway prima di uscire

Solo build e run, senza compose:

```bash
docker build -t mio-bot .
docker run -d --name mio-bot --env-file .env --init --restart unless-stopped mio-bot
```

## CI

Il workflow `.github/workflows/ci.yml` gira su ogni push su `main`, su ogni tag
`v*` e su ogni pull request, in due job:

1. **Lint e test.** `npm ci`, `npm run lint`, `npm test` su Node 24.
2. **Build immagine.** Parte solo se il primo job passa. Costruisce l'immagine,
   la avvia per uno smoke test, poi pubblica la versione multi-arch
   (`linux/amd64` e `linux/arm64`) su GitHub Container Registry.

Lo smoke test avvia davvero il container senza `DISCORD_TOKEN` e pretende uscita
con codice diverso da zero e il messaggio di errore leggibile: se l'immagine non
parte, o se fallisce con uno stack trace grezzo, la pipeline si ferma.

Le pull request costruiscono e testano l'immagine ma non pubblicano nulla: le PR
dai fork non hanno accesso ai segreti.

### Usare l'immagine pubblicata

```bash
docker pull ghcr.io/<owner>/<repo>:latest
docker run -d --name mio-bot --env-file .env --init ghcr.io/<owner>/<repo>:latest
```

Tag disponibili: `latest` (ultimo `main`), `main`, `sha-<commit>` e, sui tag di
versione, `1.2.3` e `1.2`.

Per un rilascio versionato:

```bash
git tag v1.0.0 && git push origin v1.0.0
```

### Note sulla sicurezza della pipeline

- Le action sono pinnate al commit SHA, non al tag: un tag puo' essere spostato
  su un commit diverso, un SHA no. Il commento accanto tiene leggibile la versione.
- Dependabot (`.github/dependabot.yml`) aggiorna ogni settimana action, npm e
  immagini base, cosi' il pinning non diventa codice che invecchia.
- I permessi del `GITHUB_TOKEN` sono `contents: read` di default; solo il job che
  pubblica aggiunge `packages: write`.
- Negli step `run` i valori dinamici passano da `env`, mai per interpolazione
  diretta: i tag derivano dal nome del branch, che e' input non fidato.

## Licenza

ISC
