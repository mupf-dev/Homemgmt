import { defineConfig } from 'vite';

// Zuhause-App (Hausplaner mit Lager) unter /app/ – im Entwicklungsmodus bindet server/index.ts Vite als Middleware ein,
// API und Bibliothek laufen also schon über denselben Server.
export default defineConfig({
  root: 'web/app',
  base: '/app/',
  build: { outDir: '../../dist/app', emptyOutDir: true },
});
