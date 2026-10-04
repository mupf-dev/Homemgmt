/* Früherer Service-Worker der Lager-Oberfläche (Scope /). Er meldet sich ab, löscht seinen Zwischenspeicher und lädt
   geöffnete Seiten neu – Zuhause selbst braucht keinen Service-Worker. Wird unter /sw.js ausgeliefert. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) await caches.delete(k);
    await self.registration.unregister();
    for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url);
  })());
});
