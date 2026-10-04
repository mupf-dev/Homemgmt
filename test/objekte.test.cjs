'use strict';
// Objektbibliothek: Möbelarten als Daten, Rechte, Import, Community-Katalog (lokal ausgeliefert wie von GitHub),
// Kopie im Hausplan und Lagerplätze aus der Beschreibung
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer, client } = require('./helpers.cjs');

// Katalog wie raw.githubusercontent.com: Kopie von library/ (die Tests ändern Versionen)
const catDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zuhause-katalog-'));
fs.cpSync(path.join(__dirname, '..', 'library'), catDir, { recursive: true });
let catSrv;
let catUrl;
let srv;
let admin;
let ben;
const kallax = () => JSON.parse(fs.readFileSync(path.join(catDir, 'objekte/kallax-4x4.json'), 'utf8'));

test.before(async () => {
  catSrv = http.createServer((req, res) => {
    const f = path.join(catDir, decodeURIComponent(req.url.split('?')[0]));
    if (!f.startsWith(catDir) || !fs.existsSync(f)) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': f.endsWith('.json') ? 'application/json' : 'application/octet-stream' }).end(fs.readFileSync(f));
  });
  await new Promise((r) => catSrv.listen(0, '127.0.0.1', r));
  catUrl = `http://127.0.0.1:${catSrv.address().port}/`;
  srv = await startServer({ OBJECT_CATALOG_URL: catUrl });
  admin = client(srv.base);
  await admin.post('/api/auth/setup', { name: 'Anna', password: 'geheim1' });
  await admin.post('/api/persons', { name: 'Ben', password: 'geheim2' });
  ben = client(srv.base);
  const benId = (await ben.get('/api/auth/status')).data.users.find((u) => u.name === 'Ben').id;
  await ben.post('/api/auth/login', { person_id: benId, password: 'geheim2' });
});
test.after(async () => {
  await srv.stop();
  catSrv.close();
  fs.rmSync(catDir, { recursive: true, force: true });
});

const eigene = (over = {}) => ({
  format: 'zuhause-objekt/1', id: 'eigene.werkzeugschrank', name: 'Werkzeugschrank', group: 'Werkstatt', version: '1.0',
  size: { width: 80, depth: 40, height: 120, elevation: 0 }, snapToWall: true,
  build: { type: 'korpus', plinth: 0, board: 1.8, back: true, columns: [{ size: 1, elements: [{ kind: 'drawer', size: 1 }, { kind: 'drawer', size: 1 }, { kind: 'door', size: 2, shelves: 2 }] }] },
  ...over,
});

test('Community-Katalog: alle Beispiele gelistet und installierbar', async () => {
  const r = await admin.get('/api/objects/community');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.objects.length, 5);
  for (const o of r.data.objects) {
    const i = await admin.post('/api/objects/community/install', { id: o.id });
    assert.equal(i.status, 200, `${o.id}: ${JSON.stringify(i.data)}`);
    assert.equal(i.data.source, 'community');
  }
  const list = (await admin.get('/api/objects')).data.objects;
  assert.equal(list.length, 5);
  assert.ok((await admin.get('/api/objects/community')).data.objects.every((o) => o.installed === '1.0' && !o.update));
});

test('Neue Version im Katalog: „Aktualisieren“ wird angeboten und übernommen', async () => {
  const k = kallax();
  k.version = '1.1';
  k.name = 'Regal 4×4 (neu)';
  fs.writeFileSync(path.join(catDir, 'objekte/kallax-4x4.json'), JSON.stringify(k));
  const idx = JSON.parse(fs.readFileSync(path.join(catDir, 'index.json'), 'utf8'));
  idx.objects.find((o) => o.id === k.id).version = '1.1';
  fs.writeFileSync(path.join(catDir, 'index.json'), JSON.stringify(idx));
  // Katalog wird 30 Min. zwischengespeichert – neuer Server ist nicht nötig: Cache über neue Instanz umgehen
  const fresh = await startServer({ OBJECT_CATALOG_URL: catUrl, DB_PATH: srv.dbPath });
  try {
    const a2 = client(fresh.base);
    const annaId = (await a2.get('/api/auth/status')).data.users.find((u) => u.name === 'Anna').id;
    await a2.post('/api/auth/login', { person_id: annaId, password: 'geheim1' });
    const entry = (await a2.get('/api/objects/community')).data.objects.find((o) => o.id === k.id);
    assert.equal(entry.update, true);
    assert.equal((await a2.post('/api/objects/community/install', { id: k.id })).data.object.version, '1.1');
  } finally {
    await fresh.stop().catch(() => {});
  }
});

test('Eigene Möbelart: nur mit Recht „Haus planen“; prüfen, ausblenden, löschen', async () => {
  assert.equal((await ben.put('/api/objects/eigene.werkzeugschrank', { object: eigene() })).status, 403);
  assert.equal((await ben.get('/api/objects')).status, 200, 'lesen dürfen alle');
  const bad = await admin.put('/api/objects/eigene.werkzeugschrank', { object: eigene({ build: { type: 'korpus', columns: [] } }) });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /Spalte/);
  const ok = await admin.put('/api/objects/eigene.werkzeugschrank', { object: eigene() });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.source, 'eigene');
  assert.equal((await admin.put('/api/objects/community.kallax-4x4', { object: { ...kallax(), name: 'x' } })).status, 409, 'Community-Möbelart wird nicht verändert');
  assert.equal((await admin.patch('/api/objects/eigene.werkzeugschrank', { hidden: true })).data.hidden, true);
  assert.equal((await admin.post('/api/objects/import', { object: eigene() })).status, 409, 'gibt es schon');
  assert.equal((await admin.post('/api/objects/import', { object: eigene({ version: '2.0' }), replace: true })).data.object.version, '2.0');
  await admin.del('/api/objects/eigene.werkzeugschrank');
  assert.ok(!(await admin.get('/api/objects')).data.objects.some((o) => o.object.id === 'eigene.werkzeugschrank'));
});

test('Hausplan: Möbel aus der Bibliothek wird Lager – Fächer aus der Beschreibung, Kopie im Haus', async () => {
  const W = (id, ax, ay, bx, by) => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 12, height: 260 });
  const def = kallax();
  const house = {
    version: 2, name: 'Testhaus', slots: {}, customMaterials: [], settings: { ceiling: false, backsplash: true, plinth: 10, countertopThickness: 4, timeOfDay: 12 },
    floors: [{ id: 'eg', name: 'EG', kind: 'floor', elevation: 0, height: 260, openings: [],
      rooms: [{ id: 'r1', name: 'Diele', code: '', seed: { x: 200, y: 200 } }],
      walls: [W('w1', 0, 0, 400, 0), W('w2', 400, 0, 400, 400), W('w3', 400, 400, 0, 400), W('w4', 0, 400, 0, 0)],
      items: [{ id: 'k', type: 'obj:community.kallax-4x4', x: 100, y: 30, rotation: 0, width: 147, depth: 39, height: 147, elevation: 0 }] }],
    objectTypes: { [def.id]: def },
  };
  const r = await admin.put('/api/house', { house, base_version: 0 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.house.floors[0].items[0].storageCol, 'A');
  assert.ok(r.data.house.objectTypes[def.id], 'Kopie bleibt im Haus');
  const st = (await admin.get('/api/house/storage')).data.places;
  assert.equal(st.length, 16, '4 × 4 Fächer');
  assert.equal(st[0].address, 'DI-A0');
  assert.match(st[0].name, /Spalte 1 · Offenes Fach 1 \(oben\)/);
  // ohne Kopie im Haus: unbekannte Möbelart, keine Fächer – Plätze ohne Inhalt verschwinden
  delete house.objectTypes;
  const r2 = await admin.put('/api/house', { house, base_version: r.data.version });
  assert.equal(r2.status, 200);
  assert.equal(r2.data.house.floors[0].items[0].storageCol, undefined);
});
