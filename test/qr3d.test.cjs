'use strict';
// QR-Code als 3D-Modell (public/qr3d.js läuft im Browser – hier mit minimalem window-Ersatz geladen)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');

const ctx = { TextEncoder, Blob, Response, CompressionStream };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['vendor/qrcode.js', 'qr3d.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'web', 'app', 'public', f), 'utf8'), ctx);
}
const Q = ctx.window.QR3D;
const OPTS = { width: 30, margin: 2, radius: 2, base: 1.2, relief: 0.8, label: '', labelSize: 0, eyelet: true, hole: 4 };

// Einträge direkt aus den lokalen Kopfzeilen lesen (gespeichert oder Deflate)
function unzip(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out = {};
  let o = 0;
  while (dv.getUint32(o, true) === 0x04034b50) {
    const method = dv.getUint16(o + 8, true);
    const size = dv.getUint32(o + 18, true);
    const nameLen = dv.getUint16(o + 26, true);
    const name = new TextDecoder().decode(buf.subarray(o + 30, o + 30 + nameLen));
    const body = buf.subarray(o + 30 + nameLen, o + 30 + nameLen + size);
    out[name] = new TextDecoder().decode(method === 8 ? zlib.inflateRawSync(body) : body);
    o += 30 + nameLen + size;
  }
  return out;
}

test('3MF: Farben als colorgroup, jedes Teil verweist auf seine Farbe', async () => {
  const model = Q.build('P-K-B12', OPTS);
  const { plate, code } = Q.meshes(model);
  const blob = Q.threeMF([
    { name: 'Grundplatte', color: '#ffffff', mesh: plate },
    { name: 'QR-Code', color: '#1a1a1a', mesh: code },
  ], 'Heimlager K-B12');
  const files = unzip(new Uint8Array(await blob.arrayBuffer()));
  assert.deepEqual(Object.keys(files).sort(), ['3D/3dmodel.model', '[Content_Types].xml', '_rels/.rels']);
  const xml = files['3D/3dmodel.model'];
  // Bambu Studio / Orca lesen nur <m:colorgroup>, nicht <basematerials>
  assert.match(xml, /xmlns:m="http:\/\/schemas\.microsoft\.com\/3dmanufacturing\/material\/2015\/02"/);
  assert.match(xml, /<m:colorgroup id="1"><m:color color="#FFFFFFFF"\/><m:color color="#1A1A1AFF"\/><\/m:colorgroup>/);
  assert.doesNotMatch(xml, /basematerials/);
  assert.match(xml, /<object id="2" type="model" name="Grundplatte" pid="1" pindex="0">/);
  assert.match(xml, /<object id="3" type="model" name="QR-Code" pid="1" pindex="1">/);
  assert.match(xml, /<build><item objectid="4"\/><\/build>/);
});

test('Anordnen: Schilder liegen überschneidungsfrei auf der Platte, danach geht es auf der nächsten weiter', () => {
  const plate = { w: 256, h: 256, gap: 5, edge: 5 };
  const sizes = Array.from({ length: 30 }, () => ({ w: 40, h: 46 }));
  const pos = Q.arrange(sizes, plate);
  // 5 × 4 passen auf eine Platte: (256 − 10 + 5) / (40 + 5) = 5,6 Spalten, / (46 + 5) = 4,9 Reihen
  assert.equal(pos.filter((p) => p.plate === 0).length, 20);
  assert.equal(pos.filter((p) => p.plate === 1).length, 10);
  // Block (5 × 45 − 5 = 220 breit, 4 × 51 − 5 = 199 tief) mittig, erste Reihe hinten
  assert.deepEqual({ ...pos[0] }, { plate: 0, x: 18, y: 256 - 28.5 - 46 });
  assert.deepEqual({ ...pos[1] }, { plate: 0, x: 63, y: 181.5 });
  assert.deepEqual({ ...pos[5] }, { plate: 0, x: 18, y: 130.5 });
  assert.ok(pos[20].plate === 1 && pos[20].y > pos[25].y, 'Platte 2 beginnt ebenfalls hinten');
  for (const [i, a] of pos.entries()) {
    assert.ok(a.x >= 5 && a.y >= 5 && a.x + 40 <= 251 && a.y + 46 <= 251, `Schild ${i} ragt über den Rand`);
    for (const b of pos.slice(i + 1)) {
      if (a.plate !== b.plate) continue;
      const apart = a.x + 40 + 5 <= b.x || b.x + 40 + 5 <= a.x || a.y + 46 + 5 <= b.y || b.y + 46 + 5 <= a.y;
      assert.ok(apart, 'Schilder überschneiden sich');
    }
  }
  assert.throws(() => Q.arrange([{ w: 300, h: 40 }], plate), /größer als die Druckplatte/);
});

test('3MF mit mehreren Schildern: je Schild ein Objekt an seiner Position, Farben nur einmal, komprimiert', async () => {
  const objects = ['P-K-A1', 'P-K-A2', 'P-K-A3'].map((c, i) => {
    const { plate, code } = Q.meshes(Q.build(c, OPTS));
    return {
      name: c, x: 5 + i * 40, y: 5,
      parts: [{ name: 'Grundplatte', color: '#ffffff', mesh: plate }, { name: 'QR-Code', color: '#000000', mesh: code }],
    };
  });
  const buf = new Uint8Array(await (await Q.threeMFMulti(objects, 'Test')).arrayBuffer());
  assert.equal(new DataView(buf.buffer).getUint16(8, true), 8, 'Deflate');
  const xml = unzip(buf)['3D/3dmodel.model'];
  assert.match(xml, /<m:colorgroup id="1"><m:color color="#FFFFFFFF"\/><m:color color="#000000FF"\/><\/m:colorgroup>/);
  assert.equal((xml.match(/pindex="0"/g) || []).length, 3);
  assert.equal((xml.match(/pindex="1"/g) || []).length, 3);
  assert.match(xml, /<build><item objectid="4" transform="1 0 0 0 1 0 0 0 1 5 5 0"\/><item objectid="7" transform="1 0 0 0 1 0 0 0 1 45 5 0"\/><item objectid="10" transform="1 0 0 0 1 0 0 0 1 85 5 0"\/><\/build>/);
});

test('Mesh.moved verschiebt nur x und y', () => {
  const { plate } = Q.meshes(Q.build('P-K-A1', OPTS));
  const m = plate.moved(10, 20);
  assert.equal(m.triangles, plate.triangles);
  assert.deepEqual([m.v[0], m.v[1], m.v[2]], [plate.v[0] + 10, plate.v[1] + 20, plate.v[2]]);
});
