'use strict';
// Erzeugt die App-Icons (PNG) für die installierbare Web-App – ohne Abhängigkeiten.
//   node scripts/make-icons.js
// Motiv wie das Favicon: blaues Quadrat, weißes Haus (Koordinaten auf 100 × 100).
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const BG = [0x1f, 0x6f, 0xeb];
const HOUSE = [[20, 45], [50, 25], [80, 45], [80, 78], [20, 78]]; // geschlossener Linienzug
const STROKE = 8;

function distToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
const onHouse = (x, y) => HOUSE.some((p, i) => distToSegment(x, y, p, HOUSE[(i + 1) % HOUSE.length]) <= STROKE / 2);

// maskable: Hintergrund randlos, Motiv verkleinert in der sicheren Zone; sonst abgerundetes Quadrat
function render(size, { maskable = false } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const SS = 4; // Kantenglättung per Supersampling
  const radius = maskable ? 0 : 20;
  const scale = maskable ? 0.72 : 1; // Motiv innerhalb der sicheren Zone (80 %)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0, fg = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = ((x + (sx + 0.5) / SS) / size) * 100, v = ((y + (sy + 0.5) / SS) / size) * 100;
          const cx = Math.min(Math.max(u, radius), 100 - radius), cy = Math.min(Math.max(v, radius), 100 - radius);
          if (radius === 0 || Math.hypot(u - cx, v - cy) <= radius) {
            bg++;
            if (onHouse(50 + (u - 50) / scale, 50 + (v - 50) / scale)) fg++;
          }
        }
      }
      const n = SS * SS, a = bg / n, f = bg ? fg / bg : 0, o = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) px[o + c] = Math.round(BG[c] * (1 - f) + 255 * f);
      px[o + 3] = Math.round(a * 255);
    }
  }
  return png(size, size, px);
}

function png(w, h, rgba) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; // 8 Bit RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const out = path.join(__dirname, '..', 'web', 'app', 'public', 'icons');
fs.mkdirSync(out, { recursive: true });
const files = { 'icon-192.png': render(192), 'icon-512.png': render(512), 'maskable-512.png': render(512, { maskable: true }), 'apple-touch-icon.png': render(180, { maskable: true }) };
for (const [name, buf] of Object.entries(files)) { fs.writeFileSync(path.join(out, name), buf); console.log(`${name}: ${buf.length} Bytes`); }
