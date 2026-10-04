'use strict';
// Übernahme des Hauses aus dem früheren Heimlager-Modell (Umriss minus Räume, mm) in den Hausplan (Wände, cm)
const test = require('node:test');
const assert = require('node:assert/strict');

let siteToHouse;
let normalizeHouse;
let storageUnits;
test.before(async () => {
  ({ siteToHouse } = await import('../web/app/src/model/fromSite.ts'));
  ({ normalizeHouse, storageUnits } = await import('../web/app/src/model/house.ts'));
});

// 8 × 5 m, Außenwände 36,5 cm; innen Küche links und Abstellraum rechts, dazwischen eine 11,5-cm-Wand,
// Flur unten offen mit der Küche verbunden (berührt sie ohne Abstand)
const site = {
  floors: [
    {
      name: 'Erdgeschoss', kind: 'floor', elevation: 0, height: 2600,
      outline: [[0, 0], [8000, 0], [8000, 5000], [0, 5000]],
      rooms: [
        { name: 'Küche', kind: 'room', polygon: [[365, 365], [4000, 365], [4000, 3000], [365, 3000]] },
        { name: 'Abstellraum', kind: 'room', polygon: [[4115, 365], [7635, 365], [7635, 3000], [4115, 3000]] },
        { name: 'Flur', kind: 'room', polygon: [[365, 3000], [4000, 3000], [4000, 4635], [365, 4635]] },
      ],
      openings: [
        { kind: 'window', x: 2000, y: 182, rotation: 0, width: 1200, height: 1300, sill: 900 },
        { kind: 'door', x: 4057, y: 1500, rotation: 90, width: 900, height: 2100, sill: 0 },
      ],
      roof: null,
      fixtures: [
        { kind: 'shelf', name: 'Vorratsregal', x: 6000, y: 565, rotation: 0, width: 1500, depth: 400, height: 1800, elevation: 0, levels: 4 },
        { kind: 'stairs', name: 'Treppe', x: 6000, y: 2000, rotation: 270, width: 1000, depth: 3000, height: 2800, elevation: 0, levels: 15 },
      ],
    },
    { name: 'Außen', kind: 'outdoor', elevation: 0, height: 0, outline: [], openings: [], fixtures: [], roof: null,
      rooms: [{ name: 'Terrasse', kind: 'terrace', polygon: [[0, 5500], [4000, 5500], [4000, 8500], [0, 8500]] }] },
    { name: 'Dachboden', kind: 'attic', elevation: 2800, height: 2500, outline: [[0, 0], [8000, 0], [8000, 5000], [0, 5000]],
      rooms: [{ name: 'Dachraum', kind: 'room', polygon: [[365, 365], [7635, 365], [7635, 4635], [365, 4635]] }], openings: [], fixtures: [],
      roof: { type: 'gable', pitch: 35, knee: 600, ridge: 'x' } },
  ],
};

test('Wände aus Raumgrenzen: Außenwände, Trennwand, offene Verbindung ohne Wand', () => {
  const h = siteToHouse(site);
  const eg = h.floors.find((f) => f.name === 'Erdgeschoss');
  const t = eg.walls.map((w) => w.thickness).sort((a, b) => a - b);
  assert.ok(t.includes(11.5), `Trennwand 11,5 cm fehlt: ${t}`);
  assert.ok(t.filter((x) => x === 36.5).length >= 4, `Außenwände: ${t}`);
  // zwischen Küche und Flur (berühren sich) gibt es keine Wand
  assert.ok(!eg.walls.some((w) => Math.abs(w.a.y - 300) < 2 && Math.abs(w.b.y - 300) < 2 && Math.min(w.a.x, w.b.x) < 100), 'keine Wand zwischen Küche und Flur');
  // Außenwand-Achse liegt in der Wandmitte (18,25 cm)
  assert.ok(eg.walls.some((w) => Math.abs(w.a.y - 18.25) < 0.2 && Math.abs(w.b.y - 18.25) < 0.2));
});

test('Öffnungen an Wände gebunden, Räume mit festem Umriss, Einbauten als Möbel', () => {
  const h = siteToHouse(site);
  const eg = h.floors.find((f) => f.name === 'Erdgeschoss');
  assert.equal(eg.openings.length, 2);
  const door = eg.openings.find((o) => o.type === 'door');
  const wall = eg.walls.find((w) => w.id === door.wallId);
  assert.equal(wall.thickness, 11.5, 'Tür sitzt in der Trennwand');
  assert.ok(eg.rooms.every((r) => r.manual && r.polygon.length === 4));
  assert.deepEqual(eg.items.map((i) => i.type), ['rack', 'stairs']);
  assert.equal(eg.items[0].levels, 4);
  assert.equal(eg.items[0].label, 'Vorratsregal');
  assert.equal(eg.items[1].rotation, (270 * Math.PI) / 180);
  const out = h.floors.find((f) => f.kind === 'outdoor');
  assert.equal(out.walls.length, 0);
  assert.equal(out.rooms[0].kind, 'terrace');
  const attic = h.floors.find((f) => f.kind === 'attic');
  assert.deepEqual(attic.roof, { type: 'gable', pitch: 35, knee: 60, ridge: 'x' });
  assert.deepEqual(h.floors.map((f) => f.name), ['Erdgeschoss', 'Außen', 'Dachboden']);
});

test('Nach dem Normalisieren: offene Räume behalten ihren Umriss, Regal wird Lager-Spalte im richtigen Raum', () => {
  const h = siteToHouse(site);
  normalizeHouse(h);
  const eg = h.floors.find((f) => f.name === 'Erdgeschoss');
  const flur = eg.rooms.find((r) => r.name === 'Flur');
  assert.equal(flur.polygon.length, 4, 'Flur (offen zur Küche) wird nicht mit der Küche verschmolzen');
  const ab = storageUnits(h).find((u) => u.name === 'Abstellraum');
  assert.equal(ab.code, 'AB');
  assert.deepEqual(ab.items.map((s) => [s.col, s.item.label, s.compartments.length]), [['A', 'Vorratsregal', 4]]);
});
