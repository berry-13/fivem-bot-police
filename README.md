<div align="center">

# Deputy

**Il bot Discord del Sheriff's Department: ticket, candidature, log del server, notifiche live e gerarchia, in un solo processo che si accende e si dimentica.**

[![CI](https://github.com/berry-13/fivem-bot-police/actions/workflows/ci.yml/badge.svg)](https://github.com/berry-13/fivem-bot-police/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![discord.js](https://img.shields.io/badge/discord.js-v14-5865F2?logo=discord&logoColor=white)](https://discord.js.org)
[![Docker](https://img.shields.io/badge/ghcr.io-amd64%20%7C%20arm64-2496ED?logo=docker&logoColor=white)](https://github.com/berry-13/fivem-bot-police/pkgs/container/fivem-bot-police)
[![License: ISC](https://img.shields.io/badge/license-ISC-blue)](#licenza)

</div>

---

## Indice

- [Funzionalità](#funzionalità)
- [Principi di progetto](#principi-di-progetto)
- [Avvio rapido](#avvio-rapido)
- [Configurazione](#configurazione)
- [Comandi](#comandi)
- [Moduli](#moduli)
  - [Ticket e bandi](#ticket-e-bandi)
  - [Log del server](#log-del-server)
  - [Notifiche live](#notifiche-live-twitch--tiktok--kick)
  - [Gerarchia reparto](#gerarchia-reparto)
- [Deploy in produzione](#deploy-in-produzione)
- [Sviluppo](#sviluppo)
- [CI/CD](#cicd)
- [Risoluzione dei problemi](#risoluzione-dei-problemi)
- [Licenza](#licenza)

## Funzionalità

| Modulo | In breve |
| --- | --- |
| **Ticket** | Pannello con menu a tendina, canali privati per categoria, trascrizione `.txt` alla chiusura. |
| **Bandi** | Candidature ai reparti con lo stesso flusso dei ticket, visibili solo a Capo e Vice Capo Reparto. |
| **Log del server** | Un canale per tipo (messaggi, membri, moderazione, voce, server), schede con i componenti V2, autore letto dall'audit log. |
| **Tracciamento inviti** | Per ogni ingresso: invito usato e chi l'ha creato. |
| **Notifiche live** | Twitch, TikTok e Kick, gestibili da Discord con `/live`, senza annunci doppi. |
| **Gerarchia** | Organigramma del reparto che si aggiorna da solo quando cambiano i ruoli. |
| **Operatività** | Immagine Docker multi-arch non root, spegnimento pulito su SIGTERM, stato persistente su volume, CI con smoke test. |

## Principi di progetto

Deputy è pensato per restare acceso senza supervisione. Ogni scelta nel codice
risponde a uno di questi tre punti:

1. **Non cade.** Nessun errore prevedibile (permessi mancanti, canale
   cancellato, interazione scaduta, comando che lancia un'eccezione) termina il
   processo. Nemmeno un errore mentre si gestisce un errore.
2. **Si estende aggiungendo un file.** Un nuovo comando è un file in
   `src/commands/`: nessuna registrazione manuale, nessuna modifica a
   `index.js`. Un comando malformato viene saltato con un messaggio esplicito,
   mai in silenzio.
3. **Gira uguale ovunque.** Stesso comportamento in locale e in container, con i
   segreti passati a runtime e lo spegnimento pulito all'arrivo di SIGTERM.

## Avvio rapido

**Requisiti:** Node.js 20 o superiore e un'applicazione registrata sul
[Discord Developer Portal](https://discord.com/developers/applications).

```bash
npm install
cp .env.example .env   # inserisci almeno DISCORD_TOKEN e CLIENT_ID
npm run deploy         # registra gli slash command su Discord
npm start
```

Per la produzione usa Docker: vedi [Deploy in produzione](#deploy-in-produzione).

## Configurazione

### Variabili d'ambiente

Tutta la configurazione runtime passa da `.env` (modello in
[`.env.example`](.env.example)). Se manca una variabile obbligatoria il processo
esce subito con un messaggio leggibile, invece di fallire più avanti con un
errore delle API di Discord.

| Variabile | Obbligatoria | Descrizione |
| --- | --- | --- |
| `DISCORD_TOKEN` | sì | Token del bot (Developer Portal, sezione Bot). |
| `CLIENT_ID` | solo per `npm run deploy` | Application ID dell'app. |
| `GUILD_ID` | no | Registra i comandi solo in quel server, con effetto immediato. Vuoto: registrazione globale, fino a un'ora di propagazione. |
| `COMMAND_PREFIX` | no | Prefisso dei comandi testuali. Default `!`. |
| `TICKET_CATEGORY_ID` | no | Categoria Discord sotto cui creare i canali ticket e candidatura. |
| `LIVE_CHANNEL_ID` | per le notifiche live | Canale in cui annunciare le live. Senza, il monitor resta spento. |
| `LIVE_ROLE_ID` | no | Chi pingare negli annunci. Vuoto: `@everyone` (default). Id di un ruolo: solo quel ruolo. `none`: nessun ping. |
| `TWITCH_CLIENT_ID` | per Twitch | Client ID di un'app su [dev.twitch.tv](https://dev.twitch.tv/console). |
| `TWITCH_CLIENT_SECRET` | per Twitch | Client Secret della stessa app. |
| `LIVE_POLL_INTERVAL_MS` | no | Intervallo di controllo live. Default `60000`, minimo `15000`. |
| `LIVE_STORE_PATH` | no | File della lista streamer. Default `data/live.json`. |
| `LOGS_STORE_PATH` | no | File della configurazione dei log. Default `data/logs.json`. |
| `GERARCHIA_STORE_PATH` | no | File con gli id del messaggio gerarchia. Default `data/gerarchia.json`. |

### Intent privilegiati

Nel Developer Portal, sezione **Bot**, attiva:

- **Message Content Intent**: senza, i comandi a prefisso non ricevono il testo.
- **Server Members Intent**: senza, `/setup-gerarchia` non può elencare chi ha
  ogni ruolo.

Gli altri intent usati (`Guilds`, `GuildMessages`, `DirectMessages`,
`GuildModeration`, `GuildVoiceStates`, `GuildInvites`) non sono privilegiati.

### Permessi del bot

| Permesso | Serve per |
| --- | --- |
| Visualizzare i canali, Inviare messaggi, Leggere la cronologia | Tutto. |
| Gestire i canali | Creare e chiudere ticket, `/setup-log crea`. |
| Gestire i ruoli | `/setup-log crea` (permessi della categoria log). |
| Visualizzare il registro attività | Log di moderazione, server, ruoli e nickname; autore dei messaggi eliminati. |
| Gestire il server | Sapere quale invito ha usato chi entra. |
| Menziona @everyone, @here e tutti i ruoli | Ping degli annunci live (se `LIVE_ROLE_ID` non è `none`). |
| Allegare file | Trascrizioni dei ticket e delle eliminazioni di massa. |

## Comandi

Gli slash command marcati *admin* sono visibili solo a chi ha il permesso
Amministratore.

| Comando | Chi | Cosa fa |
| --- | --- | --- |
| `/ping` | tutti | Latenza del gateway. |
| `/setup-ticket` | admin | Manda il pannello ticket nel canale corrente. |
| `/setup-bando` | admin | Manda il pannello delle candidature ai reparti. |
| `/setup-gerarchia` | admin | Manda l'organigramma del reparto, che poi si aggiorna da solo. |
| `/setup-log crea [staff]` | admin | Crea la categoria privata **Server Log** con un canale per tipo. |
| `/setup-log imposta tipo canale` | admin | Manda un tipo di log in un canale esistente. |
| `/setup-log disattiva tipo` | admin | Spegne un tipo di log, o `Tutti`. |
| `/setup-log stato` | admin | Dove va ogni tipo e quali permessi mancano. |
| `/live aggiungi piattaforma account [nome]` | admin | Aggiunge un account da monitorare. |
| `/live rimuovi account` | admin | Toglie un account. |
| `/live lista` | admin | Account monitorati, divisi per piattaforma. |
| `!ping` | tutti | Latenza del gateway. |
| `!close` | chi vede il ticket | Chiude il ticket corrente. |
| `!add @utente` | staff | Aggiunge un utente al ticket corrente (menzione o id). |

`npm run deploy` va rieseguito solo quando cambiano *nome*, *descrizione* o
*opzioni* di uno slash command, non quando cambia la logica di `execute`. I
comandi a prefisso non richiedono deploy.

## Moduli

### Ticket e bandi

`/setup-ticket` e `/setup-bando` mandano nel canale corrente un pannello con un
menu a tendina. I due pannelli condividono lo stesso flusso: cambiano solo le
categorie e il testo di benvenuto.

- **Apertura.** Scegliere una categoria crea un canale privato visibile solo
  all'utente, al bot e ai ruoli di quella categoria. Il nome porta la categoria
  in chiaro (`ticket-richiesta-esame-mario-rossi`) ed è troncato a 90
  caratteri. Con `TICKET_CATEGORY_ID` i canali finiscono sotto quella categoria.
- **Chiusura.** Bottone **Chiudi Ticket** o `!close`. La cronologia viene
  salvata come `.txt` nel canale `ticket-logs` (creato se non esiste) e il
  canale viene eliminato dopo cinque secondi. Se la trascrizione fallisce il
  ticket si chiude lo stesso e il messaggio lo dice, invece di promettere un
  archivio che non c'è.
- **Staff.** Chi ha il permesso Gestire i canali oppure uno dei ruoli elencati
  in configurazione. `!close` e `!add` funzionano solo dentro un canale ticket e
  non toccano mai `ticket-logs`.

Categorie e ruoli si cambiano in [`src/config/tickets.js`](src/config/tickets.js)
e [`src/config/bandi.js`](src/config/bandi.js). I ruoli sono cercati per nome:
devono combaciare carattere per carattere, emoji e spazi compresi. Un ruolo non
trovato viene segnalato in console con il nome esatto.

### Log del server

Ogni tipo di log ha il suo canale, così chi cerca un ban non deve scorrere mille
messaggi modificati. Ogni voce è una scheda con i componenti V2 di Discord:
bordo colorato per tipo di evento, avatar, id e orario in fondo, pulsanti per
saltare al messaggio o al canale.

| Tipo | Cosa registra |
| --- | --- |
| **Messaggi** | Eliminati (con chi li ha eliminati, quando è noto), modificati (prima e dopo), eliminazioni di massa con trascrizione `.txt`, messaggi fissati. |
| **Membri** | Ingressi con invito usato e autore dell'invito (avviso per account più giovani di 7 giorni), uscite con ruoli e anzianità, nickname, ruoli aggiunti e tolti con chi li ha cambiati. |
| **Moderazione** | Ban e revoche, espulsioni, timeout, mute e deaf di server, disconnessioni e spostamenti in voce, azioni AutoMod, pulizie dei membri. |
| **Voce** | Ingressi, uscite e cambi di canale vocale. |
| **Server** | Canali, ruoli (con i permessi cambiati), permessi dei canali, inviti, webhook, emoji, sticker, thread, eventi, regole AutoMod, bot aggiunti, impostazioni del server. |

`/setup-log crea [staff]` dà al ruolo `staff` accesso in sola lettura: scrivere,
cancellare, fissare, creare thread o webhook gli viene negato anche se può farlo
nel resto del server (amministratori esclusi). Rilanciarlo riapplica i permessi
e ricrea solo i canali mancanti; una categoria esistente con lo stesso nome non
viene mai toccata.

Comportamento:

- Nessun log fa ping: menzioni di utenti e ruoli sono solo visuali.
- Messaggi dei bot, azioni di Deputy stesso (ticket compresi) e attività nei
  canali di log non vengono registrati.
- Una modifica che cambia solo l'anteprima di un link non conta come modifica.
- Un messaggio eliminato che non era in cache viene loggato lo stesso, dicendo
  che il testo non è disponibile.
- Se un canale di log viene cancellato il bot continua a girare e lo segnala in
  console al massimo una volta ogni dieci minuti.

**Tracciamento inviti.** All'avvio il bot fotografa gli utilizzi di ogni invito
e a ogni ingresso guarda quale è salito. Riconosce l'URL personalizzato del
server e gli inviti a utilizzi limitati che si esauriscono con quell'ingresso.
Se due persone entrano nello stesso istante con inviti diversi il log lo dice
("uno tra..."); chi arriva da Scopri server, o prima che la foto iniziale sia
pronta, risulta "sconosciuto".

Nomi dei canali, filtri e soglia degli account nuovi si cambiano in
[`src/config/logs.js`](src/config/logs.js).

### Notifiche live (Twitch / TikTok / Kick)

Il bot controlla periodicamente gli account monitorati e, al passaggio da
offline a live, manda un embed nel canale `LIVE_CHANNEL_ID`.

**Setup.**

1. Copia l'id del canale (Modalità sviluppatore attiva) in `LIVE_CHANNEL_ID`.
2. Per Twitch crea un'app su [dev.twitch.tv/console](https://dev.twitch.tv/console)
   (tipo "Application integration") e inserisci Client ID e Secret.
   TikTok e Kick non richiedono credenziali.
3. Gli annunci pingano `@everyone` per default: il bot deve avere il permesso
   di menzionarlo nel canale, altrimenti Discord rifiuta il messaggio. Usa
   `LIVE_ROLE_ID` per pingare un solo ruolo, o `none` per nessun ping.

**Gestione da Discord.** `/live` funziona solo nel server che contiene
`LIVE_CHANNEL_ID`. In `account` va lo username, l'`@handle` o il link del
**canale** (`twitch.tv/nome`, `tiktok.com/@nome`, `kick.com/nome`); link di
un'altra piattaforma o a video, clip e sezioni del sito vengono rifiutati.
`/live rimuovi` suggerisce gli account in lista; a mano serve il valore esatto
(username, link o `piattaforma:username`, es. `kick:salvinosalvo`), così un
nome parziale non cancella l'account sbagliato.

Le modifiche valgono dal giro di controllo successivo, senza riavvio né deploy.
[`src/config/live.js`](src/config/live.js) è solo il seed: viene copiato in
`data/live.json` al primo avvio, poi comanda `/live`. Se il server di
`LIVE_CHANNEL_ID` non è risolvibile, `/live` rifiuta di lavorare e lo dice.

**Garanzie.**

- Nessun annuncio al primo giro dopo un avvio o dopo un `/live aggiungi`: un
  bot che riparte a metà live non spamma il canale.
- Un annuncio per live: finché resta online il messaggio non si ripete.
- Un errore di rete o API non vale come "offline": viene loggato e ritentato,
  e quando la rete torna non parte un secondo annuncio della stessa live.
- Twitch usa una sola chiamata per tutti i canali; TikTok e Kick vanno a gruppi
  di 4 con 10 secondi di timeout. Le tre piattaforme partono in parallelo. Se un
  giro supera l'80% dell'intervallo, gli account rimasti hanno la precedenza al
  giro successivo.
- Senza credenziali Twitch, TikTok e Kick restano attivi. Con la lista vuota il
  monitor resta in attesa del primo `/live aggiungi`.

### Gerarchia reparto

`/setup-gerarchia` manda nel canale corrente l'organigramma del Sheriff's
Department: per ogni grado il ruolo e i membri che lo hanno (`//` se vuoto). I
ping sono solo visuali.

Il messaggio si aggiorna da solo quando un ruolo della gerarchia viene
assegnato o tolto, o quando un membro con un grado esce dal server. Rilancia il
comando solo per spostare il pannello: i messaggi precedenti vengono cancellati.
Ruoli, ordine e raggruppamenti si cambiano in
[`src/config/gerarchia.js`](src/config/gerarchia.js) (ruoli per id, stabili
anche se rinominati). Richiede **Server Members Intent**.

## Deploy in produzione

### Docker Compose (consigliato)

```bash
cp .env.example .env          # inserisci i valori reali
docker compose up -d --build
docker compose logs --tail=100
```

Una volta sola, per registrare gli slash command:

```bash
docker compose run --rm bot node src/deploy-commands.js
```

### Immagine pubblicata

La CI pubblica un'immagine multi-arch (`linux/amd64`, `linux/arm64`) su GitHub
Container Registry:

```bash
docker pull ghcr.io/berry-13/fivem-bot-police:latest
docker run -d --name deputy --env-file .env --init --restart unless-stopped \
  -v deputy-data:/app/data ghcr.io/berry-13/fivem-bot-police:latest
```

| Tag | Punta a |
| --- | --- |
| `latest`, `main` | Ultimo commit su `main`. |
| `sha-<commit>` | Un commit preciso. |
| `1.2.3`, `1.2` | Un rilascio versionato (tag git `v1.2.3`). |

In produzione conviene fissare un tag di versione o `sha-<commit>`, non `latest`.

### Stato persistente

Tutto lo stato runtime vive in `/app/data` (volume `bot-data` in compose):

| File | Contenuto |
| --- | --- |
| `live.json` | Account monitorati, gestiti con `/live`. |
| `logs.json` | Canale di destinazione di ogni tipo di log. |
| `gerarchia.json` | Id dei messaggi della gerarchia. |

Senza volume, questi dati si perdono a ogni ricreazione del container. Per un
backup basta copiare la cartella:

```bash
docker compose cp bot:/app/data ./backup-data
```

### Caratteristiche dell'immagine

- Build multi-stage su `node:26-alpine`; il layer delle dipendenze resta in
  cache finché non cambia `package-lock.json`.
- Solo dipendenze di produzione (`npm ci --omit=dev`).
- Il processo gira come utente `node`, mai come root.
- `.env` è escluso dal contesto di build: il token arriva a runtime e non entra
  mai nell'immagine.
- `init: true` e l'handler su SIGTERM chiudono la connessione al gateway prima
  di uscire, così Discord non vede il bot online per minuti dopo lo stop.
- Log Docker ruotati (`json-file`, 3 file da 10 MB).

### Rilascio

```bash
git tag v1.0.0 && git push origin v1.0.0
```

## Sviluppo

| Comando | Cosa fa |
| --- | --- |
| `npm start` | Avvia il bot. |
| `npm run dev` | Avvia con riavvio automatico a ogni modifica. |
| `npm run deploy` | Registra gli slash command su Discord. |
| `npm test` | Suite di test con il test runner nativo di Node. |
| `npm run lint` | Analisi statica con ESLint (`lint:fix` per correggere). |

In sviluppo imposta `GUILD_ID` sul server di test: la registrazione dei comandi
è immediata invece di richiedere fino a un'ora.

### Struttura

```
src/
  index.js              Avvio: validazione env, client, loader, spegnimento pulito
  deploy-commands.js    Registrazione degli slash command via REST
  commands/slash/       Slash command: { data, execute }
  commands/prefix/      Comandi testuali: { name, execute }
  events/               Un file per evento del gateway
  config/               Configurazione statica: ticket, bandi, log, live, gerarchia
  lib/
    env.js              Variabili d'ambiente con errori leggibili
    loaders.js          Caricamento e validazione di comandi ed eventi
    safe-reply.js       Risposte che non propagano mai un rejection
    shutdown.js         Chiusura del gateway su SIGINT e SIGTERM
    tickets.js          Logica dei ticket condivisa da bottone e comandi
    logs.js             Log del server: schede, audit log, invio sicuro
    log-card.js         Schede di log con i componenti V2
    logs-store.js       Canali di log per server
    invites.js          Tracciamento dell'invito usato da chi entra
    live.js             Polling Twitch/TikTok/Kick e annunci
    live-store.js       Lista streamer su disco
    gerarchia.js        Costruzione e aggiornamento dell'organigramma
    gerarchia-store.js  Id dei messaggi della gerarchia
test/                   Test con node:test, nessuna dipendenza esterna
```

### Aggiungere un comando

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

Poi `npm run deploy`.

Comando a prefisso, in `src/commands/prefix/` (nessun deploy):

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

Restituisci sempre la promise di `reply` (con `await` o `return`): così
l'handler intercetta un eventuale errore invece di lasciarlo diventare una
unhandled rejection.

## CI/CD

Il workflow [`.github/workflows/ci.yml`](.github/workflows/ci.yml) gira su ogni
push su `main`, su ogni tag `v*` e su ogni pull request:

1. **Lint e test**: `npm ci`, `npm run lint`, `npm test` su Node 24.
2. **Build immagine**: solo se il primo job passa. Build, smoke test, poi
   pubblicazione multi-arch su GHCR.

Lo smoke test avvia il container senza `DISCORD_TOKEN` e pretende un'uscita con
codice diverso da zero e il messaggio di errore leggibile: un'immagine che non
parte, o che fallisce con uno stack trace grezzo, ferma la pipeline. Le pull
request costruiscono e testano l'immagine ma non pubblicano nulla.

Sicurezza della pipeline:

- Action pinnate al commit SHA, non al tag (un tag si può spostare, uno SHA no).
- Dependabot aggiorna ogni settimana action, dipendenze npm e immagini base.
- `GITHUB_TOKEN` con `contents: read` di default; solo il job di pubblicazione
  aggiunge `packages: write`.
- Negli step `run` i valori dinamici passano da `env`, mai per interpolazione
  diretta: i nomi dei branch sono input non fidato.

## Risoluzione dei problemi

| Sintomo | Causa probabile |
| --- | --- |
| Il processo esce subito con un errore su una variabile | Manca una variabile obbligatoria in `.env`: il messaggio dice quale. |
| Gli slash command non compaiono | Manca `npm run deploy`, oppure la registrazione è globale e sta ancora propagando: usa `GUILD_ID` per averli subito. |
| I comandi `!` non rispondono | Message Content Intent non attivo, o `COMMAND_PREFIX` diverso da quello usato. |
| Un ticket non è visibile allo staff | Nome del ruolo in `config/tickets.js` o `config/bandi.js` non identico a quello del server: controlla l'avviso in console. |
| `/setup-gerarchia` mostra tutti i gradi vuoti | Server Members Intent non attivo. |
| Log di moderazione vuoti o senza autore | Manca il permesso Visualizzare il registro attività. |
| Ingressi con invito "sconosciuto" | Manca Gestire il server, oppure l'utente è arrivato da Scopri server. |
| Annunci live non inviati | `LIVE_CHANNEL_ID` vuoto o errato, oppure manca il permesso di menzionare `@everyone`: l'errore è in console. |
| Stato perso dopo un aggiornamento | `/app/data` non è montato su un volume. |

## Licenza

Distribuito con licenza ISC.
