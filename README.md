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

Se manca una variabile obbligatoria il processo esce subito con un messaggio
chiaro, invece di fallire piu' avanti con un errore delle API di Discord.

### Intent da abilitare

Nel Developer Portal, sezione Bot, va attivato **Message Content Intent**: senza
quello i comandi a prefisso non ricevono il testo dei messaggi. Gli altri intent
usati (`Guilds`, `GuildMessages`, `DirectMessages`) non sono privilegiati.

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
  config/
    tickets.js          Categorie dei ticket e nome del canale di log
  events/               Un file per evento del gateway
  commands/slash/       Slash command: { data, execute }
  commands/prefix/      Comandi testuali: { name, execute }
test/                   Test con node:test, nessuna dipendenza esterna
```

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
