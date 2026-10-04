'use strict';
// Haus: Etagen, Räume, Türen/Fenster, Dach, Einbauten und Fach-Zuordnung (Plätze aus beliebigen Lagern)
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, setupUsers } = require('./helpers.cjs');

let srv, admin, user, k, g;
before(async () => {
  srv = await startServer();
  ({ admin, user } = await setupUsers(srv.base));
  k = (await admin.post('/api/warehouses', { code: 'K', name: 'Keller' })).data.id;
  g = (await admin.post('/api/warehouses', { code: 'G', name: 'Garage' })).data.id;
  await admin.post('/api/places/bulk', { warehouse_id: k, col_from: 'A', col_to: 'B', row_from: 0, row_to: 4 });
  await admin.post('/api/places/bulk', { warehouse_id: g, col_from: 'A', row_from: 0, row_to: 1 });
});
after(() => srv.stop());

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const shelf = (over = {}) => ({
  kind: 'shelf', name: 'Regal', x: 1000, y: 600, rotation: 0, width: 1000, depth: 400, height: 1800, levels: 5,
  slots: [0, 1, 2, 3, 4].map((r) => ({ warehouse_id: k, col: 'A', row: r, level: r })), ...over,
});
const HOUSE = () => ({
  floors: [
    {
      name: 'UG', elevation: -2710, height: 2510, outline: rect(0, 0, 12005, 8500),
      rooms: [{ name: 'Abstellraum', polygon: [[380, 380], [11625, 380], [11625, 8120], [380, 8120]] }],
      openings: [{ kind: 'window', x: 6000, y: 190, rotation: 0, width: 1000, height: 750, sill: 1500 }],
      fixtures: [shelf(), { kind: 'stairs', name: 'Treppe', x: 7000, y: 3880, width: 3150, depth: 1000, height: 2710, levels: 15 }],
    },
    {
      name: 'Dachboden', kind: 'attic', elevation: 5670, height: 2820, outline: rect(0, 0, 12005, 8500),
      roof: { type: 'gable', pitch: 30, knee: 400, ridge: 'x' },
      fixtures: [{ kind: 'shelf', name: 'Kisten', x: 3000, y: 4250, width: 1200, depth: 500, height: 1500, levels: 2,
        slots: [{ wh_code: 'g', col: 'a', row: 1, level: 1 }] }],
    },
    { name: 'Außen', kind: 'outdoor', height: 0, rooms: [{ name: 'Carport', kind: 'carport', polygon: rect(365, -4100, 8510, 0), height: 2700 }] },
  ],
});

test('Ohne Einrichtung: leeres Haus', async () => {
  const r = await user.get('/api/site');
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { floors: [], updated_at: null });
});

test('Speichern und Laden: Etagen, Räume, Dach, Carport, Einbauten mit Plätzen aus zwei Lagern', async () => {
  const r = await admin.put('/api/site', HOUSE());
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const [ug, dach, aussen] = r.data.floors;
  assert.deepEqual(r.data.floors.map((f) => [f.name, f.kind, f.elevation]), [['UG', 'floor', -2710], ['Dachboden', 'attic', 5670], ['Außen', 'outdoor', 0]]);
  assert.equal(ug.rooms[0].kind, 'room', 'Art Standard: Raum');
  assert.deepEqual(ug.fixtures.map((f) => f.kind), ['shelf', 'stairs']);
  assert.equal(ug.fixtures[0].slots.length, 5);
  assert.deepEqual(dach.roof, { type: 'gable', pitch: 30, knee: 400, ridge: 'x' });
  assert.deepEqual(dach.fixtures[0].slots, [{ warehouse_id: g, wh_code: 'G', col: 'A', row: 1, level: 1, pos: 0 }], 'Lager auch per Kürzel');
  assert.deepEqual(aussen.outline, [], 'Außen ohne Umriss');
  assert.equal(aussen.rooms[0].height, 2700);
  assert.ok(r.data.updated_at);
  assert.deepEqual((await user.get('/api/site')).data, r.data, 'Benutzer dürfen das Haus sehen');
});

test('Etagen behalten ihre ID, entfernte Etagen verschwinden samt Einbauten', async () => {
  const cur = (await admin.get('/api/site')).data;
  const ids = cur.floors.map((f) => f.id);
  const next = { ...cur, floors: cur.floors.slice(0, 2) }; // Außen weg
  next.floors[0] = { ...next.floors[0], name: 'Keller' };
  const r = await admin.put('/api/site', next);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.floors.map((f) => f.id), ids.slice(0, 2));
  assert.equal(r.data.floors[0].name, 'Keller');
  assert.equal(r.data.floors[0].fixtures[0].slots.length, 5, 'Fächer bleiben erhalten');
});

test('Plätze im Haus: Belegung und Inhalt über alle Lager; Platz weiß, ob er im Haus liegt', async () => {
  await admin.post('/api/checkin', { name: 'Schrauben', warehouse_id: k, col: 'A', row: 2, quantity: 50 });
  const r = (await user.get('/api/site/places')).data;
  assert.equal(r.places.length, 6);
  assert.ok(r.places.some((p) => p.wh_code === 'G' && p.col === 'A' && p.row === 1));
  assert.deepEqual(r.items.map((i) => [i.name, i.quantity]), [['Schrauben', 50]]);
  assert.deepEqual(Object.keys(r.items[0]).sort(), ['col', 'consumable', 'container', 'contents', 'expires_in', 'id', 'name', 'parent_id', 'photo_at', 'quantity', 'row', 'warehouse_id'], 'Felder für die Kisten');
  assert.equal((await user.get(`/api/places/A/0?wh=${k}`)).data.in_room, true);
  assert.equal((await user.get(`/api/places/B/0?wh=${k}`)).data.in_room, false);
  const w = (await user.get('/api/warehouses')).data;
  assert.deepEqual(w.filter((x) => x.id === k || x.id === g).map((x) => x.in_house), [5, 1]);
});

test('Auswertung im Haus: Buchungen je Platz und letzte Bewegung', async () => {
  await admin.post('/api/checkin', { name: 'Dübel', warehouse_id: k, col: 'A', row: 3, quantity: 10 });
  const it = (await admin.get('/api/items?q=Dübel')).data[0];
  await admin.post('/api/checkout', { item_id: it.id, quantity: 2 });
  const st = (await user.get('/api/site/stats')).data;
  assert.equal(st['K-A3'].moves_90, 2);
  assert.ok(st['K-A3'].last_at);
  assert.equal(st['K-A2'].moves_90, 1, 'Schrauben aus dem Test davor');
  assert.equal(st['K-B0'], undefined, 'nicht im Haus');
});

test('Nur Admins dürfen das Haus ändern', async () => {
  assert.equal((await user.put('/api/site', HOUSE())).status, 403);
});

test('Ungültige Angaben werden abgelehnt, nichts wird halb gespeichert', async () => {
  const before = (await admin.get('/api/site')).data;
  const bad = async (mut, re) => {
    const h = HOUSE();
    mut(h);
    const r = await admin.put('/api/site', h);
    assert.equal(r.status, 400, JSON.stringify(r.data));
    assert.match(r.data.error, re);
  };
  await bad((h) => { h.floors[0].outline = [[0, 0], [1, 1]]; }, /Umriss: braucht 3/);
  await bad((h) => { h.floors[0].rooms[0].kind = 'schloss'; }, /unbekannte Art/);
  await bad((h) => { h.floors[0].fixtures[0].kind = 'sofa'; }, /unbekannte Art/);
  await bad((h) => { h.floors[1].fixtures[0].slots.push({ warehouse_id: k, col: 'A', row: 0, level: 0 }); }, /K-A0 ist zweimal zugeordnet/);
  await bad((h) => { h.floors[0].fixtures[0].slots = [{ warehouse_id: k, col: 'Z', row: 9, level: 0 }]; }, /K-Z9 gibt es nicht/);
  await bad((h) => { h.floors[0].fixtures[0].slots = [{ warehouse_id: 999, col: 'A', row: 0, level: 0 }]; }, /unbekanntes Lager/);
  await bad((h) => { h.floors[0].fixtures[1].slots = [{ warehouse_id: k, col: 'B', row: 0, level: 0 }]; }, /Treppe gibt es keine Fächer/);
  await bad((h) => { h.floors[1].roof.pitch = 90; }, /Dachneigung/);
  await bad((h) => { h.floors[0].openings[0].kind = 'tor'; }, /Tür, Durchgang oder Fenster/);
  assert.deepEqual((await admin.get('/api/site')).data, before);
});

test('Gleichzeitige Änderung: veralteter Stand wird abgelehnt', async () => {
  const cur = (await admin.get('/api/site')).data;
  assert.equal((await admin.put('/api/site', { ...cur, if_updated_at: cur.updated_at })).status, 200);
  const stale = await admin.put('/api/site', { ...cur, if_updated_at: cur.updated_at });
  assert.equal(stale.status, 409);
  assert.match(stale.data.error, /woanders geändert/);
});

test('Hintergrundbild je Etage: nur Bilder, nur Admins, verschwindet mit der Etage', async () => {
  const cur = (await admin.get('/api/site')).data;
  const id = cur.floors[0].id;
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a3c5e2ae0000000049454e44ae426082', 'hex');
  assert.equal((await user.put(`/api/floors/${id}/image`, { image: png.toString('base64') })).status, 403);
  assert.equal((await admin.put(`/api/floors/${id}/image`, { image: 'bm9jaA==' })).status, 400);
  const r = await admin.put(`/api/floors/${id}/image`, { image: `data:image/png;base64,${png.toString('base64')}` });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const img = await user.get(`/api/floors/${id}/image`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.ok((await admin.get('/api/site')).data.floors[0].image_at);
  const next = (await admin.get('/api/site')).data;
  assert.equal((await admin.put('/api/site', { floors: next.floors.slice(1) })).status, 200);
  assert.equal((await user.get(`/api/floors/${id}/image`)).status, 404);
});

test('Gelöschter Platz verschwindet aus seinem Fach, Lager mit Plätzen im Haus lässt sich löschen', async () => {
  await admin.put('/api/site', HOUSE());
  assert.equal((await admin.del(`/api/places/A/4?wh=${k}`)).status, 200);
  const s = (await admin.get('/api/site')).data;
  assert.deepEqual(s.floors[0].fixtures[0].slots.map((x) => x.row), [0, 1, 2, 3]);
  assert.equal((await admin.del(`/api/warehouses/${g}`)).status, 200);
  assert.deepEqual((await admin.get('/api/site')).data.floors[1].fixtures[0].slots, []);
});
