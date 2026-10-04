'use strict';
// Zuhause: Hausplan als gemeinsames Dokument und Abgleich mit dem Lager (Raum = Lager, Möbel = Spalte, Fach = Zeile)
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, mcp } = require('./helpers.cjs');

let srv;
let admin;
test.before(async () => {
  srv = await startServer();
  admin = client(srv.base);
  await admin.post('/api/auth/setup', { name: 'Anna', password: 'geheim1' });
});
test.after(() => srv.stop());

const W = (id, ax, ay, bx, by) => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 12, height: 260 });
// EG 600 × 400 cm, Innenwand bei x = 350 → links Küche, rechts Vorratsraum
const house = (items, rooms = [
  { id: 'r1', name: 'Küche', code: '', seed: { x: 100, y: 100 } },
  { id: 'r2', name: 'Vorrat', code: '', seed: { x: 500, y: 100 } },
]) => ({
  version: 2, name: 'Testhaus',
  floors: [{ id: 'eg', name: 'EG', kind: 'floor', elevation: 0, height: 260, openings: [], rooms,
    walls: [W('w1', 0, 0, 600, 0), W('w2', 600, 0, 600, 400), W('w3', 600, 400, 0, 400), W('w4', 0, 400, 0, 0), W('w5', 350, 0, 350, 400)],
    items }],
  slots: {}, customMaterials: [], settings: { ceiling: false, backsplash: true, plinth: 10, countertopThickness: 4, timeOfDay: 12 },
});
const cabinet = (x, y) => ({ id: 'schrank', type: 'base-drawers', x, y, rotation: 0, width: 60, depth: 60, height: 90, elevation: 0, front: 'drawers', drawers: 3 });
const rack = { id: 'regal', type: 'rack', x: 450, y: 30, rotation: 0, width: 80, depth: 35, height: 180, elevation: 0, levels: 4 };
const stool = { id: 'hocker', type: 'stool', x: 200, y: 250, rotation: 0, width: 40, depth: 40, height: 65, elevation: 0 };

let version = 0;
const save = async (h, base = version) => {
  const r = await admin.put('/api/house', { house: h, base_version: base });
  if (r.status === 200) version = r.data.version;
  return r;
};
const wh = async (code) => (await admin.get('/api/warehouses')).data.find((w) => w.code === code);

test('Leeres Haus, dann Plan speichern: Räume werden Lager, Fächer werden Plätze', async () => {
  const empty = await admin.get('/api/house');
  assert.equal(empty.data.house, null);
  assert.equal(empty.data.can_edit, true);

  const r = await save(house([cabinet(60, 36), rack, stool]));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const f = r.data.house.floors[0];
  assert.deepEqual(f.rooms.map((x) => x.code), ['KU', 'VO']);
  assert.equal(f.rooms[0].polygon.length, 4, 'Küche aus Wänden erkannt');
  assert.equal(f.items.find((i) => i.id === 'schrank').storageCol, 'A');
  assert.equal(f.items.find((i) => i.id === 'regal').storageCol, 'A');
  assert.equal(f.items.find((i) => i.id === 'hocker').storageCol, undefined, 'Hocker hat keine Fächer');
  assert.deepEqual(r.data.sync, { warehouses: 2, created: 7, updated: 0, moved: 0, removed: 0, kept: 0 });

  const ku = await wh('KU');
  assert.equal(ku.name, 'Küche');
  const place = await admin.get(`/api/places/A/0?wh=${ku.id}`);
  assert.equal(place.status, 200);
  assert.equal(place.data.name, 'Unterschrank Auszüge 60 · Schublade 1 (oben)');
  assert.equal(place.data.category, 'Küche');
  const vo = await wh('VO');
  assert.equal((await admin.get(`/api/places?wh=${vo.id}`)).data.length, 4);
});

test('Einbuchen ins Fach, Möbel in anderen Raum stellen: Platz und Gegenstand wandern mit', async () => {
  const ku = await wh('KU');
  const inn = await admin.post('/api/checkin', { name: 'Besteck', warehouse_id: ku.id, col: 'A', row: 1, quantity: 1 });
  assert.equal(inn.status, 200, JSON.stringify(inn.data));
  const itemId = inn.data.id;

  // Schrank in den Vorratsraum: dort hat das Regal schon Spalte A → Schrank wird B
  const r = await save(house([cabinet(450, 330), rack, stool]));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.house.floors[0].items.find((i) => i.id === 'schrank').storageCol, 'B');
  assert.equal(r.data.sync.moved, 3);
  const vo = await wh('VO');
  const item = (await admin.get(`/api/items/${itemId}`)).data;
  assert.deepEqual([item.warehouse_id, item.col, item.row], [vo.id, 'B', 1]);

  const st = (await admin.get('/api/house/storage')).data.places;
  const fach = st.find((p) => p.plan_item === 'schrank' && p.plan_slot === 1);
  assert.equal(fach.address, 'VO-B1');
  assert.deepEqual(fach.items.map((i) => i.name), ['Besteck']);
});

test('Möbel entfernen: leere Fächer verschwinden, Fächer mit Inhalt bleiben als Platz', async () => {
  const r = await save(house([rack, stool]));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.sync.removed, 2);
  assert.equal(r.data.sync.kept, 1);
  const vo = await wh('VO');
  const p = await admin.get(`/api/places/B/1?wh=${vo.id}`);
  assert.match(p.data.name, /nicht mehr im Plan/);
  assert.equal(p.data.items.length, 1);
});

test('Raum entfernen: leeres Lager wird gelöscht; Kürzel anderer Lager sind tabu', async () => {
  // Raum „Hauptraum“ mit Wunschkürzel H – das hat schon das Hauptlager
  const r = await save(house([rack], [{ id: 'r2', name: 'Vorrat', code: 'VO', seed: { x: 500, y: 100 } }, { id: 'r3', name: 'Hauptraum', code: 'H', seed: { x: 100, y: 100 } }]));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const codes = r.data.house.floors[0].rooms.map((x) => x.code);
  assert.equal(codes[0], 'VO');
  assert.notEqual(codes[1], 'H');
  assert.equal(await wh('KU'), undefined, 'Lager der Küche (leer) ist weg');
  assert.equal((await wh('H')).name, 'Hauptlager');
});

test('Gleichzeitig bearbeitet: veralteter Stand wird abgelehnt; Benutzer dürfen ansehen, nicht ändern', async () => {
  const stale = await save(house([rack]), version - 1);
  assert.equal(stale.status, 409);

  await admin.post('/api/persons', { name: 'Ben', password: 'geheim2' });
  const ben = client(srv.base);
  const benId = (await ben.get('/api/auth/status')).data.users.find((u) => u.name === 'Ben').id;
  await ben.post('/api/auth/login', { person_id: benId, password: 'geheim2' });
  const got = await ben.get('/api/house');
  assert.equal(got.status, 200);
  assert.equal(got.data.can_edit, false);
  assert.equal(got.data.house.name, 'Testhaus');
  assert.equal((await ben.put('/api/house', { house: house([]), base_version: version })).status, 403);
  assert.equal((await client(srv.base).get('/api/house')).status, 401);
});

test('Recht „Haus planen“: vom Admin vergeben, darf Ben speichern; entzogen wieder nicht', async () => {
  const ben = client(srv.base);
  const benId = (await ben.get('/api/auth/status')).data.users.find((u) => u.name === 'Ben').id;
  await ben.post('/api/auth/login', { person_id: benId, password: 'geheim2' });
  assert.equal((await ben.get('/api/auth/me')).data.user.canPlan, false);
  const grant = await admin.patch(`/api/persons/${benId}`, { can_plan: true });
  assert.equal(grant.status, 200, JSON.stringify(grant.data));
  assert.equal(grant.data.can_plan, 1);
  assert.equal((await ben.get('/api/auth/me')).data.user.canPlan, true);
  const got = await ben.get('/api/house');
  assert.equal(got.data.can_edit, true);
  const r = await ben.put('/api/house', { house: got.data.house, base_version: got.data.version });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  version = r.data.version;
  await admin.patch(`/api/persons/${benId}`, { can_plan: false });
  assert.equal((await ben.put('/api/house', { house: got.data.house, base_version: version })).status, 403);
  // Admins dürfen immer – unabhängig vom Haken
  assert.equal((await admin.get('/api/auth/me')).data.user.canPlan, true);
});

test('Alte Planung (Version 1, eine Küche) wird beim Speichern zu einem Haus mit einer Etage', async () => {
  const v1 = { version: 1, name: 'Alte Küche', walls: [W('a', 0, 0, 300, 0)], openings: [], items: [cabinet(50, 36)], slots: {}, customMaterials: [], settings: {} };
  const r = await save(v1);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.house.version, 2);
  assert.equal(r.data.house.floors.length, 1);
  assert.equal(r.data.house.floors[0].items[0].storageCol, 'A');
  // ohne Raum: Lager der Etage
  assert.ok(r.data.house.floors[0].code);
});

test('Assistent/MCP finden Fächer beim Namen: Raum, Möbel und Fach in Worten', async () => {
  const r = await save(house([cabinet(60, 36), { ...rack, label: 'Vorratsregal' }]));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const [ku, vo] = r.data.house.floors[0].rooms.map((x) => x.code);
  const key = (await admin.post('/api/keys', { name: 'mcp', person_id: 1, scope: 'write' })).data.key;
  const m = mcp(srv.mcpUrl, key);
  const a = await m.tool('einbuchen', { name: 'Mehl', platz: 'Vorratsregal Boden 2' });
  assert.equal(a.isError, false, a.text);
  assert.equal(a.json.gegenstand.platz, `${vo}-A1`);
  const b = await m.tool('einbuchen', { name: 'Löffel', platz: 'Küche Schublade 3' });
  assert.equal(b.isError, false, b.text);
  assert.equal(b.json.gegenstand.platz, `${ku}-A2`);
  // mehrdeutig: nachfragen statt raten
  const c = await m.tool('einbuchen', { name: 'Zucker', platz: 'Küche Schublade' });
  assert.equal(c.isError, true);
  assert.match(c.text, /mehreren Plätzen/);
});

test('Gesperrte Objekte bleiben beim Speichern gesperrt (Wand, Öffnung, Möbel, Raum)', async () => {
  const h = house([{ ...rack, locked: true }, stool]);
  const f = h.floors[0];
  f.walls[0].locked = true;
  f.openings.push({ id: 'o1', wallId: 'w1', type: 'window', offset: 150, width: 100, height: 120, sill: 90, locked: true });
  f.rooms[1].locked = true;
  const r = await save(h);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const back = (await admin.get('/api/house')).data.house.floors[0];
  assert.equal(back.walls.find((w) => w.id === 'w1').locked, true);
  assert.equal(back.walls.find((w) => w.id === 'w2').locked, undefined);
  assert.equal(back.openings[0].locked, true);
  assert.equal(back.items.find((i) => i.id === 'regal').locked, true);
  assert.equal(back.rooms[1].locked, true);
});
