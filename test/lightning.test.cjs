'use strict';
// Blitze (Blitzortung.org): Dekodieren, Entfernung/Richtung, Zusammenfassung mit Warnstufe – ohne Netz
const test = require('node:test');
const assert = require('node:assert/strict');
const { decode, distBearing, summarize, direction } = require('../server/lager/lightning.cjs');

/** LZW-Kodierung wie bei Blitzortung (Gegenstück zu decode) */
function encode(s) {
  const dict = new Map();
  const out = [];
  let w = s[0];
  let code = 256;
  for (let i = 1; i < s.length; i++) {
    const c = s[i];
    if (dict.has(w + c) || (w + c).length === 1) w += c;
    else {
      out.push(w.length > 1 ? String.fromCharCode(dict.get(w)) : w);
      dict.set(w + c, code++);
      w = c;
    }
  }
  out.push(w.length > 1 ? String.fromCharCode(dict.get(w)) : w);
  return out.join('');
}

test('Nachricht dekodieren', () => {
  const msg = JSON.stringify({ time: 1791103922846120400, lat: 48.9, lon: 9.1, alt: 0, pol: 0, mds: 9999, mcg: 200, status: 1, region: 1 });
  assert.deepEqual(JSON.parse(decode(encode(msg))), JSON.parse(msg));
});

test('Entfernung und Richtung', () => {
  const d = distBearing(48.8257, 9.06, 48.7758, 9.1829); // Ditzingen → Stuttgart
  assert.ok(d.km > 9 && d.km < 12, String(d.km));
  assert.ok(d.bearing > 100 && d.bearing < 140, String(d.bearing));
  assert.equal(direction(d.bearing), 'Südosten');
});

test('Zusammenfassung: nächster Blitz, Anzahl, Warnstufe, Alter', () => {
  const now = Date.now();
  const at = (min, lat, lon) => ({ t: now - min * 60000, lat, lon });
  const home = [48.8257, 9.06];
  assert.equal(summarize([], ...home, now).level, 0);
  const far = [at(2, 49.3, 9.06)]; // ~53 km nördlich
  assert.equal(summarize(far, ...home, now).level, 0);
  const s = summarize([at(1, 48.9, 9.06), at(5, 48.86, 9.06), at(40, 48.83, 9.06), at(90, 48.83, 9.06)], ...home, now);
  assert.equal(s.strikes.length, 3, 'älter als 60 Min. fällt weg');
  assert.equal(s.count15, 2, 'nur die letzten 15 Min.');
  assert.equal(s.nearest.direction, 'Norden');
  assert.ok(s.nearest.km > 3 && s.nearest.km < 5);
  assert.equal(s.level, 3);
  assert.equal(s.strikes[0].age_s, 60);
});
