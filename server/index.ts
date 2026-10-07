// homemgmt-ng – ein Server für Lager, Haus und Küchenplaner. Start: node server/index.ts (Node >= 22.18)
//
//   /            homemgmt-ng-App: Hausplaner mit Lager (web/app, Vite; Dateien unter /app/)   /q/…  QR-Links
//   MCP-Server auf eigenem Port (Standard 3100)
//
// Eine Datenbank (DB_PATH, Standard data/zuhause.db), ein Konto für alles.

import express from 'express';
import http from 'node:http';
import https from 'node:https';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKitchen, type Core } from './kueche/index.ts';
import { createHouse } from './haus/index.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const lager = require('./lager/server.cjs');

const PORT = Number(process.env.PORT ?? 3000);
const HTTPS_PORT = Number(process.env.HTTPS_PORT ?? 3443);
const CERT_DIR = process.env.CERT_DIR ?? join(ROOT, 'certs');
const MCP_PORT = Number(process.env.MCP_PORT ?? 3100);
const MCP_HOST = process.env.MCP_HOST || '0.0.0.0';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const DEV = process.env.VITE_DEV === '1';
const APP_DIST = join(ROOT, 'dist', 'app');

const app = express();
app.disable('x-powered-by');
if (TRUST_PROXY) app.set('trust proxy', 1);
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

// Module Haus (Hausplan ↔ Lager) und Planungen: eigene API-Pfade, Konto und Datenbank kommen aus dem Lager-Modul
app.use(createHouse(lager as Core));
app.use(createKitchen(lager as Core, { dataDir: dirname(lager.DB_PATH) }));

// homemgmt-ng-App (Hausplaner mit Lager) unter / – Dateien liegen unter /app/ (Vite-Basis)
// frühere Adressen: /app/ und /kueche/ → /, Texturen unter /textures/ → /app/textures/
app.get(/^\/(app|kueche)\/?$/, (_req, res) => res.redirect(301, '/'));
app.get(/^\/kueche\/.*$/, (_req, res) => res.redirect(301, '/'));
app.get(/^\/textures\//, (req, res) => res.redirect(301, `/app${req.url}`));
// frühere Lager-Oberfläche: Adresse /alt/ führt zur App; ihr Service-Worker (/sw.js, Scope /) wird durch einen ersetzt,
// der sich selbst abmeldet – sonst könnten alte Installationen eine zwischengespeicherte Oberfläche zeigen
app.get(/^\/alt(\/.*)?$/, (_req, res) => res.redirect(301, '/'));
app.get('/sw.js', (_req, res) => {
  const file = [join(APP_DIST, 'sw.js'), join(ROOT, 'web', 'app', 'public', 'sw.js')].find((f) => existsSync(f));
  if (!file) return res.status(404).end();
  res.setHeader('Cache-Control', 'no-cache');
  res.type('text/javascript').sendFile(file);
});
const server = http.createServer(app);
const noCache = (res: express.Response) => res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
if (DEV) {
  const { createServer } = await import('vite');
  const vite = await createServer({
    configFile: join(ROOT, 'vite.config.ts'),
    server: { middlewareMode: true, hmr: { server } },
    appType: 'custom',
  });
  app.get(['/', '/index.html'], async (_req, res, next) => {
    try {
      const html = await vite.transformIndexHtml('/app/', readFileSync(join(ROOT, 'web', 'app', 'index.html'), 'utf8'));
      noCache(res);
      res.type('html').send(html);
    } catch (e) {
      next(e);
    }
  });
  app.use('/app', (req, res, next) => {
    req.url = '/app' + req.url; // Vite kennt die Basis /app/ selbst
    vite.middlewares(req, res, next);
  });
} else if (existsSync(APP_DIST)) {
  // Seiten nie aus dem Cache (sonst läuft nach Updates alter Code); gehashte Dateien unter assets/ dauerhaft
  app.get(['/', '/index.html'], (_req, res) => {
    noCache(res);
    res.sendFile(join(APP_DIST, 'index.html'));
  });
  app.use('/app', express.static(APP_DIST, {
    index: false,
    setHeaders: (res, path) => {
      if (path.includes('/assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    },
  }));
} else {
  app.get(['/', '/index.html'], (_req, res) => res.status(503).type('text').send('Die App ist nicht gebaut: npm run build (oder npm run dev). '));
}

// Alles Übrige: Lager-Modul (REST-API, QR-Links, /healthz)
app.use((req, res) => lager.handle(req, res));

server.listen(PORT, '0.0.0.0', () => {
  console.log(`homemgmt-ng läuft auf http://localhost:${PORT}  (Datenbank: ${lager.DB_PATH})`);
});

// HTTPS optional – nötig, damit Handys im Heimnetz die Kamera fürs Scannen freigeben (npm run cert)
const keyFile = join(CERT_DIR, 'key.pem');
const certFile = join(CERT_DIR, 'cert.pem');
if (HTTPS_PORT && existsSync(keyFile) && existsSync(certFile)) {
  https.createServer({ key: readFileSync(keyFile), cert: readFileSync(certFile) }, app)
    .listen(HTTPS_PORT, '0.0.0.0', () => console.log(`HTTPS (für Kamera-Scan): https://localhost:${HTTPS_PORT}`));
}

// MCP-Server für KI-Assistenten – Anmeldung nur per API-Schlüssel
if (MCP_PORT) {
  const publicUrl = process.env.MCP_PUBLIC_URL;
  const allowedOrigins = (process.env.MCP_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (publicUrl) allowedOrigins.push(new URL(publicUrl).origin);
  http.createServer(lager.mcpHandler({ allowedOrigins, keyInUrl: process.env.MCP_KEY_IN_URL === '1' }))
    .listen(MCP_PORT, MCP_HOST, () => console.log(`MCP-Server: http://${MCP_HOST === '0.0.0.0' ? 'localhost' : MCP_HOST}:${MCP_PORT}/mcp`));
}

// Sauber beenden, damit die Datenbank (WAL) zurückgeschrieben wird
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    lager.close();
    process.exit(0);
  });
}
