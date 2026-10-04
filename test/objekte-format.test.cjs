'use strict';
// Format zuhause-objekt/1: Arbeitsplatte (build.countertop) – Prüfung, Grenzwerte, Fächer mit und ohne Platte,
// bestehende Möbelarten unverändert
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let M;
test.before(async () => {
  M = await import('../web/app/src/model/objects.ts');
});
const KAT = path.join(__dirname, 'fixtures', 'katalog', 'objekte');
const load = (f) => JSON.parse(fs.readFileSync(path.join(KAT, f), 'utf8'));
const places = (t) => M.objectCompartments(t, t.size.width, t.size.depth, t.size.height);

// Waschmaschine unter Arbeitsplatte: offenes Fach links, Auszüge rechts
const wama = (countertop) => ({
  format: 'zuhause-objekt/1', id: 'eigene.wama-zeile', name: 'Waschmaschine unter Arbeitsplatte', group: 'Hauswirtschaft', version: '1.0',
  size: { width: 120, depth: 60, height: 90, elevation: 0 }, snapToWall: true,
  build: { type: 'korpus', plinth: 0, board: 1.8, back: false, ...(countertop === undefined ? {} : { countertop }),
    columns: [{ size: 1, elements: [{ kind: 'open', size: 1, label: 'Waschmaschine' }] }, { size: 1, elements: [{ kind: 'drawer', size: 1 }, { kind: 'drawer', size: 2 }] }] },
});

test('Arbeitsplatte: wird angenommen und vereinheitlicht', () => {
  const t = M.validateObjectType(wama({ thickness: 4, overhang: 2, join: true }));
  assert.deepEqual(t.build.countertop, { thickness: 4, overhang: 2, join: true });
  // Standardwerte, join nur wenn true
  assert.deepEqual(M.validateObjectType(wama({})).build.countertop, { thickness: 4, overhang: 2 });
  assert.deepEqual(M.validateObjectType(wama({ thickness: '3,8'.replace(',', '.'), overhang: 0, join: 'ja' })).build.countertop, { thickness: 3.8, overhang: 0 });
  // ohne bzw. false: kein Feld
  assert.equal('countertop' in M.validateObjectType(wama()).build, false);
  assert.equal('countertop' in M.validateObjectType(wama(false)).build, false);
});

test('Arbeitsplatte: Grenzwerte werden abgelehnt', () => {
  assert.throws(() => M.validateObjectType(wama({ thickness: 0.5 })), /Stärke muss zwischen 1 und 10/);
  assert.throws(() => M.validateObjectType(wama({ thickness: 11 })), /Stärke muss zwischen 1 und 10/);
  assert.throws(() => M.validateObjectType(wama({ overhang: -1 })), /Überstand muss zwischen 0 und 10/);
  assert.throws(() => M.validateObjectType(wama({ overhang: 10.5 })), /Überstand muss zwischen 0 und 10/);
  assert.throws(() => M.validateObjectType(wama({ thickness: 'dick' })), /Stärke/);
  assert.throws(() => M.validateObjectType(wama(true)), /Arbeitsplatte: Angaben als Objekt/);
  // Grenzen selbst sind erlaubt
  assert.equal(M.validateObjectType(wama({ thickness: 1, overhang: 0 })).build.countertop.thickness, 1);
  assert.equal(M.validateObjectType(wama({ thickness: 10, overhang: 10 })).build.countertop.overhang, 10);
  // Höhe muss für Korpus + Platte reichen
  const flach = wama({ thickness: 10 });
  flach.size.height = 12;
  assert.throws(() => M.validateObjectType(flach), /Höhe reicht nicht/);
});

test('Arbeitsplatte: gleiche Fächer, Korpus endet unter der Platte', () => {
  const ohne = M.validateObjectType(wama());
  const mit = M.validateObjectType(wama({ thickness: 4, overhang: 2 }));
  const a = places(ohne);
  const b = places(mit);
  // Zahl, Reihenfolge, Namen und Spalten (x) bleiben – die Platte ist kein Fach
  assert.equal(b.length, a.length);
  assert.deepEqual(b.map((c) => [c.label, c.kind, c.x0, c.x1]), a.map((c) => [c.label, c.kind, c.x0, c.x1]));
  // oberstes Fach endet Plattenstärke tiefer; nichts reicht in die Platte
  const top = (list) => Math.max(...list.map((c) => c.y1));
  assert.equal(Math.round((top(a) - top(b)) * 10) / 10, 4);
  assert.ok(top(b) <= 90 - 4 - 1.8 + 1e-9);
  // Fächer passen genau ins Korpus-Layout (3D und Lager aus derselben Rechnung)
  const lay = M.korpusLayout(mit.build, 120, 90);
  assert.ok(Math.abs(lay[0].elements[0].y1 - (90 - 4 - 1.8)) < 1e-9);
  assert.ok(Math.abs(lay[1].elements[1].y0 - 1.8) < 1e-9);
  // Verhältnis der Schubladen bleibt 1 : 2
  const d = b.filter((c) => c.kind === 'drawer');
  assert.ok(Math.abs((d[1].y1 - d[1].y0) / (d[0].y1 - d[0].y0) - 2) < 1e-9);
});

test('Bestehende Möbelarten ohne Arbeitsplatte bleiben unverändert', () => {
  // festgehaltene Fächer (Zahl, Namen, Lage) der Katalog-Möbelarten
  const snap = (t) => places(t).map((c) => `${c.label}|${c.kind}|${[c.x0, c.x1, c.y0, c.y1, c.z0, c.z1].map((v) => Math.round(v * 100) / 100).join(',')}`);
  for (const f of fs.readdirSync(KAT)) {
    const raw = load(f);
    const t = M.validateObjectType(raw);
    assert.equal('countertop' in t.build, false, f);
    assert.equal(t.size.height, raw.size.height, f);
    // gleiche Rechnung wie vor der Arbeitsplatte: oberster Rand = Höhe − Plattenstärke
    const lay = M.korpusLayout(t.build, t.size.width, t.size.height);
    for (const col of lay) assert.equal(col.elements[0].y1, t.size.height - t.build.board, f);
    // zweimal prüfen ergibt dasselbe (Export → Import)
    assert.deepEqual(snap(M.validateObjectType(JSON.parse(JSON.stringify(t)))), snap(t), f);
  }
  // Werte von Version 0.7.0 (vor der Arbeitsplatte) – Lageradressen dürfen sich nicht verschieben
  const w = places(M.validateObjectType(load('werkzeugwagen.json'))).map((c) => [c.label, Math.round(c.y0 * 100) / 100, Math.round(c.y1 * 100) / 100]);
  assert.deepEqual(w, [['Ablage oben', 83.8, 93.5], ['Schublade 1 (oben)', 76.53, 83.8], ['Schublade 2', 69.26, 76.53], ['Schublade 3', 61.98, 69.26], ['Schublade 4', 52.29, 61.98], ['Schublade 5', 42.59, 52.29], ['Schublade 6', 28.05, 42.59], ['Schublade 7 (unten)', 13.5, 28.05]]);
  const k = places(M.validateObjectType(load('kallax-4x4.json')));
  assert.equal(k.length, 16);
  assert.equal(k[0].label, 'Spalte 1 · Offenes Fach 1 (oben)');
  assert.equal(Math.round(k[0].y1 * 10) / 10, 147 - 3.8);
});

test('Arbeitsplatte: Export/Import behält das Feld', () => {
  const t = M.validateObjectType(wama({ thickness: 3, overhang: 1.5, join: true }));
  const again = M.validateObjectType(JSON.parse(JSON.stringify(t)));
  assert.deepEqual(again.build.countertop, { thickness: 3, overhang: 1.5, join: true });
  assert.deepEqual(again, t);
});

test('Arbeitsplatte mit Küchenzeile: eine durchgehende Platte mit dem Unterschrank daneben', async () => {
  const C = await import('../web/app/src/model/catalog.ts');
  const G = await import('../web/app/src/model/geom.ts');
  const join = M.validateObjectType({ ...wama({ thickness: 4, overhang: 3, join: true }), id: 'eigene.wama-join' });
  const solo = M.validateObjectType({ ...wama({ thickness: 4, overhang: 2 }), id: 'eigene.wama-solo' });
  C.setLibraryObjects([join, solo]);
  assert.equal(C.getEntry('obj:eigene.wama-join').countertop, true);
  assert.notEqual(C.getEntry('obj:eigene.wama-solo').countertop, true);
  const it = (id, type, x, width) => ({ id, type, x, y: 30, rotation: 0, width, depth: 60, height: 90, elevation: 0 });
  const runs = G.countertopRuns({ items: [it('u', 'base-doors', 30, 60), it('w', 'obj:eigene.wama-join', 120, 120), it('s', 'obj:eigene.wama-solo', 300, 120)] });
  assert.deepEqual(runs.get('u').ids, ['u', 'w']);
  assert.equal(runs.get('w'), runs.get('u'));
  assert.equal(runs.has('s'), false);
  // Vorderkante der Zeile: größter Überstand (Möbelart 3 cm)
  assert.equal(Math.round(runs.get('u').v1 * 100), 30 + 30 + 3);
  C.setLibraryObjects([]);
});

// Waschmaschine und Trockner unter Arbeitsplatte (Beispiel aus dem Format)
const geraete = (extra = {}) => ({
  format: 'zuhause-objekt/1', id: 'eigene.wasch-trocken', name: 'Waschmaschine und Trockner', group: 'Hauswirtschaft', version: '1.0',
  size: { width: 120, depth: 65, height: 90, elevation: 0 }, snapToWall: true,
  build: { type: 'korpus', plinth: 0, board: 1.8, back: false, countertop: { thickness: 4, overhang: 2, join: true },
    columns: [{ size: 1, elements: [{ kind: 'washer', size: 1, ...extra }] }, { size: 1, elements: [{ kind: 'dryer', size: 1 }] }] },
});

test('Geräte: washer und dryer werden angenommen, Böden nicht', () => {
  assert.equal(M.ELEMENT_KINDS.washer, 'Waschmaschine');
  assert.equal(M.ELEMENT_KINDS.dryer, 'Trockner');
  const t = M.validateObjectType(geraete());
  assert.deepEqual(t.build.columns.map((c) => c.elements[0].kind), ['washer', 'dryer']);
  assert.throws(() => M.validateObjectType(geraete({ shelves: 2 })), /Waschmaschine hat keine Böden/);
  assert.throws(() => M.validateObjectType({ ...geraete(), build: { ...geraete().build, columns: [{ size: 1, elements: [{ kind: 'spuelmaschine', size: 1 }] }] } }), /unbekannte Art/);
});

test('Geräte: je zwei Fächer – Blende oben, Trommel darunter', () => {
  const t = M.validateObjectType(geraete());
  const c = places(t);
  assert.equal(c.length, 4);
  assert.equal(M.objectCompartmentCount(t), 4);
  assert.deepEqual(c.map((x) => [x.label, x.kind]), [
    ['Links · Waschmittelfach', 'drawer'], ['Links · Waschmaschine', 'door'],
    ['Rechts · Kondenswasserbehälter', 'drawer'], ['Rechts · Trockner', 'door'],
  ]);
  // unter der Arbeitsplatte: Korpus bis 90 − 4 − 1,8; Blende 13 cm, Trommel darunter bis zum Boden
  const [blende, trommel] = c;
  assert.ok(Math.abs(blende.y1 - (90 - 4 - 1.8)) < 1e-9);
  assert.ok(Math.abs(blende.y1 - blende.y0 - 13) < 1e-9);
  assert.equal(trommel.y1, blende.y0);
  assert.ok(Math.abs(trommel.y0 - 1.8) < 1e-9);
  // eigene Bezeichnung benennt nur die Trommel
  const named = places(M.validateObjectType(geraete({ label: 'Waschmaschine Bosch' })));
  assert.deepEqual(named.slice(0, 2).map((x) => x.label), ['Links · Waschmittelfach', 'Links · Waschmaschine Bosch']);
  // niedriges Gerät: Blende höchstens 30 % der Höhe
  const klein = geraete();
  klein.size.height = 30;
  delete klein.build.countertop;
  const k = places(M.validateObjectType(klein))[0];
  assert.ok(Math.abs(k.y1 - k.y0 - (30 - 3.6) * 0.3) < 1e-9);
});

test('Geräte: Säule und Grenze von 99 Fächern zählen zwei Fächer je Gerät', () => {
  const saeule = M.validateObjectType({ ...geraete(), build: { type: 'korpus', plinth: 0, board: 1.8, back: false,
    columns: [{ size: 1, elements: [{ kind: 'dryer', size: 1 }, { kind: 'washer', size: 1 }] }] } });
  assert.deepEqual(places(saeule).map((x) => x.label), ['Kondenswasserbehälter', 'Trockner', 'Waschmittelfach', 'Waschmaschine']);
  // 12 Spalten × 4 Geräte = 96 Fächer erlaubt, × 5 = 120 nicht
  const viele = (n) => ({ ...geraete(), size: { width: 800, depth: 65, height: 400, elevation: 0 },
    build: { type: 'korpus', plinth: 0, board: 1.8, back: false, columns: Array.from({ length: 12 }, () => ({ size: 1, elements: Array.from({ length: n }, () => ({ kind: 'washer', size: 1 })) })) } });
  assert.equal(M.objectCompartmentCount(M.validateObjectType(viele(4))), 96);
  assert.throws(() => M.validateObjectType(viele(5)), /Zu viele Fächer \(höchstens 99\)/);
});

test('Gerätefarbe: Slot appliance wird angenommen, ohne Angabe bleibt alles wie bisher', async () => {
  const t = M.validateObjectType({ ...geraete(), materials: { appliance: 'lack-black', front: 'lack-white', unbekannt: 'x' } });
  assert.deepEqual(t.materials, { appliance: 'lack-black', front: 'lack-white' });
  assert.equal(M.hasAppliance(t), true);
  assert.equal(M.hasAppliance(M.validateObjectType(wama())), false);
  // ohne appliance: keine Materialien hinzugedichtet, Fächer gleich
  const ohne = M.validateObjectType(geraete());
  assert.equal(ohne.materials, undefined);
  assert.deepEqual(places(ohne), places(t));
});

test('Gerätefarbe: hell → hellgraue Blende, dunkel/metallisch → Schwarzglas und Chromring', () => {
  // Farben wie in der Materialbibliothek (materials.ts)
  assert.equal(M.isDarkSurface('#f3f3f1'), false); // Gerät weiß (Standard)
  assert.equal(M.isDarkSurface('#f1f0eb'), false); // lack-white
  assert.equal(M.isDarkSurface('#1b1b1c'), true); // lack-black
  assert.equal(M.isDarkSurface('#38393b'), true); // lack-anthracite
  assert.equal(M.isDarkSurface('#c9cacc', 1), true); // metal-steel (metallisch)
  assert.equal(M.isDarkSurface('#c9cacc'), false);
  assert.equal(M.isDarkSurface('kein-hex'), false);
});
