# homemgmt-ng – Lager, Haus und Küchenplaner in einem Container
# Stufe 1: Küchenplaner-Oberfläche bauen (Vite)
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts ./
COPY web/app ./web/app
RUN npm run build

# Stufe 2: schlanker Laufzeit-Container (Express + eingebautes node:sqlite, Type Stripping ab Node 22.18)
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    HTTPS_PORT=3443 \
    MCP_PORT=3100 \
    DB_PATH=/data/zuhause.db \
    CERT_DIR=/certs \
    TZ=Europe/Berlin

# Zeitzone für Datumsangaben (MCP, Haltbarkeit); /data gehört dem unprivilegierten Benutzer „node“
RUN apk add --no-cache tzdata \
 && mkdir -p /data /certs \
 && chown node:node /data

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node server ./server
# der Server teilt sich das Hausmodell (Typen, Katalog, Geometrie, Räume, Fächer) mit der App
COPY --chown=node:node web/app/src/model ./web/app/src/model
COPY --chown=node:node scripts ./scripts
COPY --from=build --chown=node:node /app/dist ./dist

USER node
VOLUME ["/data"]
EXPOSE 3000 3100 3443

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" >/dev/null || exit 1

# direkt node starten (nicht npm), damit SIGTERM ankommt und die Datenbank sauber geschlossen wird
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.ts"]
