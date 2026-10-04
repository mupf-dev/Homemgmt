'use strict';
// FurniMesh: Modellkarten aus den öffentlichen Bibliotheksseiten lesen (ohne Netz, mit Beispiel-HTML)
const test = require('node:test');
const assert = require('node:assert');

const card = (path, alt, img) =>
  `<li><a class="block" href="/library/${path}/"><article><div><img alt="${alt}" decoding="async" srcSet="/_next/image/?url=${encodeURIComponent(img)}&amp;w=256&amp;q=65 256w"/></div></article></a></li>`;

test('parseCards liest Link, Namen, Vorschaubild und typische Maße', async () => {
  const { parseCards, FM_ID_RE } = await import('../server/kueche/furnimesh.ts');
  const html = [
    '<a href="/library/format/glb/">GLB</a>',
    card('seating/armchair/a-modern-armchair-featuring-a-curved-wooden-a02gs7', 'A modern armchair featuring a curved wooden frame… — free GLB 3D model', 'https://storage.googleapis.com/furnimesh-3d/original/abc.png'),
    card('tables/dining-table/a-minimalist-round-dining-table-ft865b', 'A minimalist round dining table with a dark finish', 'https://storage.googleapis.com/furnimesh-3d/original/def.jpeg'),
    card('seating/armchair/a-modern-armchair-featuring-a-curved-wooden-a02gs7', 'doppelt', 'https://storage.googleapis.com/furnimesh-3d/original/abc.png'),
  ].join('');
  const hits = parseCards(html);
  assert.strictEqual(hits.length, 2);
  assert.deepStrictEqual(hits.map((h) => h.name), ['Sessel · modern armchair', 'Esstisch · minimalist round dining table']);
  assert.deepStrictEqual(hits[0].size, [85, 85, 90]);
  assert.match(hits[0].thumb, /^https:\/\/furnimesh\.com\/_next\/image\/\?url=https%3A%2F%2Fstorage\.googleapis\.com%2Ffurnimesh-3d%2Foriginal%2Fabc\.png&w=256/);
  assert.ok(hits.every((h) => FM_ID_RE.test(h.id) && h.source === 'furnimesh'));
  assert.ok(!FM_ID_RE.test('../../etc/passwd'));
});

test('Kategorie ohne FurniMesh-Gegenstück liefert einen Hinweis statt einer Anfrage', async () => {
  const { searchFurniMesh } = await import('../server/kueche/furnimesh.ts');
  const r = await searchFurniMesh('', 'pflanzen', 10, 0);
  assert.strictEqual(r.total, 0);
  assert.ok(r.note);
});
