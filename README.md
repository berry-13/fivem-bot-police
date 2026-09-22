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

Se manca una variabile obbligatoria il processo esce subito con un messaggio
chiaro, invece di fallire piu' avanti con un errore delle API di Discord.

### Intent da abilitare

Nel Developer Portal, sezione Bot, vanno attivati:

- **Message Content Intent**: senza quello i comandi a prefisso non ricevono il
  testo dei messaggi.
- **Server Members Intent**: senza quello `/setup-gerarchia` non riesce a
  elencare chi ha ogni ruolo.

Gli altri intent usati (`Guilds`, `GuildMessages`, `DirectMessages`,
`GuildModeration`, `GuildVoiceStates`, `GuildInvites`) non sono privilegiati.

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
    live.js             Polling Twitch/TikTok e notifiche live
    logs.js             Log del server: schede, audit log, invio sicuro
    log-card.js         Scheda di log con i componenti V2 di Discord
    logs-store.js       Canali di log per server (data/logs.json)
    invites.js          Tracciamento dell'invito usato da chi entra
  config/
    tickets.js          Categorie dei ticket e nome del canale di log
    live.js             Lista streamer da monitorare
    logs.js             Tipi di log, nomi dei canali, filtri
  events/               Un file per evento del gateway
  commands/slash/       Slash command: { data, execute }
  commands/prefix/      Comandi testuali: { name, execute }
test/                   Test con node:test, nessuna dipendenza esterna
```

## Notifiche live (Twitch / TikTok)

All'avvio il bot controlla periodicamente se gli streamer in `src/config/live.js`
sono in live e, al passaggio da offline a online, manda un embed nel canale
indicato da `LIVE_CHANNEL_ID`.

Streamer preconfigurati:

| Piattaforma | Account |
|---|---|
| Twitch | [salvinosalvo](https://www.twitch.tv/salvinosalvo) |
| TikTok | [@xx_cicci_xx](https://www.tiktok.com/@xx_cicci_xx) |
| Twitch | [ydiablo93](https://www.twitch.tv/ydiablo93) |
| Twitch | [bigtaurus94](https://www.twitch.tv/bigtaurus94) |
| Twitch | [s4k3_tv](https://www.twitch.tv/s4k3_tv) |

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
- Notifica solo sul passaggio **offline -> live**. Finche' resta in live non
  ripete il messaggio.
- Errori di rete o API vengono loggati e ritentati al giro successivo; il
  processo non cade.
- Senza `LIVE_CHANNEL_ID` il monitor resta spento (warning in console).
- Senza credenziali Twitch i soli account TikTok restano attivi.

Per aggiungere o togliere streamer modifica `src/config/live.js` e riavvia.

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

## Log del server

Ogni tipo di log ha il suo canale, cosi' chi cerca un ban non deve scorrere
mille messaggi modificati.

Ogni log e' una scheda fatta con i componenti V2 di Discord: bordo colorato
per tipo di evento (rosso eliminazioni, giallo modifiche, verde ingressi,
arancione uscite, rosso scuro sanzioni), avatar accanto al titolo, contenuti
degli utenti citati, id e orario in piccolo in fondo, pulsanti per saltare al
messaggio o al canale. La trascrizione di un'eliminazione di massa e' un file
mostrato dentro la scheda stessa.

| Tipo | Cosa registra |
| --- | --- |
| **Messaggi** | messaggi eliminati (con chi li ha eliminati, quando si riesce a saperlo), modificati (prima e dopo), eliminazioni di massa con trascrizione `.txt`, messaggi fissati |
| **Membri** | ingressi con l'invito usato e chi l'ha creato (avviso per account creati da meno di 7 giorni), uscite con i ruoli che avevano e da quanto erano nel server, nickname, ruoli aggiunti e tolti con chi li ha cambiati |
| **Moderazione** | ban e revoche, espulsioni, timeout, mute e deaf di server, disconnessioni e spostamenti in voce, azioni AutoMod, pulizie dei membri |
| **Voce** | ingressi, uscite e cambi di canale vocale |
| **Server** | canali, ruoli (con i permessi aggiunti e tolti), permessi dei canali, inviti, webhook, emoji, sticker, thread, eventi, regole AutoMod, bot aggiunti, impostazioni del server |

Configurazione, solo amministratori:

| Comando | Cosa fa |
| --- | --- |
| `/setup-log crea [staff]` | Crea la categoria privata **Server Log** con un canale per tipo. Il ruolo `staff`, se indicato, legge in sola lettura. Rilanciarlo ricrea solo i canali cancellati. |
| `/setup-log imposta tipo canale` | Manda un tipo di log in un canale esistente (controlla prima che il bot ci possa scrivere). |
| `/setup-log disattiva tipo` | Spegne un tipo, o `Tutti`. I canali non vengono eliminati. |
| `/setup-log stato` | Mostra dove va ogni tipo e quali permessi mancano. |

La configurazione resta in `data/logs.json` (in Docker: volume `bot-data`).
Nomi dei canali, filtri e soglia degli account nuovi si cambiano in
`src/config/logs.js`.

Permessi del bot:

- **Visualizzare il registro attivita'**: senza questo moderazione, server,
  ruoli e nickname restano vuoti, e un messaggio eliminato non dice chi l'ha
  eliminato. Sono tutti letti dall'audit log, che porta autore e motivo.
- **Gestire il server**: per sapere quale invito ha usato chi entra. Senza,
  il log degli ingressi lo dice invece di tirare a indovinare.
- **Gestire i canali** e **Gestire i ruoli**: solo per `/setup-log crea`.

Tracciamento degli inviti: all'avvio il bot fotografa gli utilizzi di ogni
invito e, a ogni ingresso, guarda quale e' salito. Riconosce anche l'URL
personalizzato del server e gli inviti a utilizzi limitati che si esauriscono
proprio con quell'ingresso. Se due persone entrano nello stesso istante con
inviti diversi il log lo dice ("uno tra..."), e chi arriva da Scopri server o
entra prima che la foto iniziale sia pronta risulta "sconosciuto".

Scelte di comportamento:

- Nessun log fa ping: menzioni di utenti e ruoli sono solo visuali.
- I messaggi dei bot e le azioni fatte da questo bot (ticket compresi) non
  vengono loggati, e nemmeno quello che succede nei canali di log stessi.
- Una modifica che cambia solo l'anteprima di un link non conta come modifica.
- Un messaggio eliminato che non era in cache (per esempio mandato prima
  dell'ultimo riavvio) viene loggato lo stesso, dicendo che il testo non e'
  disponibile.
- Se un canale di log viene cancellato il bot continua a girare e lo segnala
  in console al massimo una volta ogni dieci minuti.

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
