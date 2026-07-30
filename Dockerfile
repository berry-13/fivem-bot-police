# syntax=docker/dockerfile:1

# --- Stage 1: dipendenze di produzione ---------------------------------------
FROM node:24-alpine AS deps
WORKDIR /app

# Copiamo solo i manifest: il layer delle dipendenze resta in cache finche'
# package.json e package-lock.json non cambiano.
COPY package.json package-lock.json ./

# --registry esplicito: evita che una configurazione npm locale finisca in build.
RUN npm ci --omit=dev --no-audit --no-fund --registry=https://registry.npmjs.org/

# --- Stage 2: runtime ---------------------------------------------------------
FROM node:24-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

# Cartella scrivibile per lo stato runtime (es. id del messaggio gerarchia).
# In compose va montata come volume cosi' sopravvive ai rebuild.
RUN mkdir -p /app/data && chown node:node /app/data

# L'immagine node include gia' un utente non privilegiato: nessun processo root.
USER node

# Il bot gestisce SIGTERM e chiude la connessione al gateway prima di uscire.
STOPSIGNAL SIGTERM

CMD ["node", "src/index.js"]
