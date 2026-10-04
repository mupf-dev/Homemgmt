// Kachelbare prozedurale Texturen (Farbe + Höhe -> Normal Map), erzeugt per Canvas.

export interface ProcResult {
  color: HTMLCanvasElement;
  normal: HTMLCanvasElement;
  roughness?: HTMLCanvasElement;
}

function hash(x: number, y: number, seed: number) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** periodische Value-Noise: Gitter wird mit Periode px/py umgebrochen */
function noise(x: number, y: number, px: number, py: number, seed = 1) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const m = (a: number, p: number) => ((a % p) + p) % p;
  const x0 = m(xi, px);
  const x1 = m(xi + 1, px);
  const y0 = m(yi, py);
  const y1 = m(yi + 1, py);
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(x0, y0, seed);
  const b = hash(x1, y0, seed);
  const c = hash(x0, y1, seed);
  const d = hash(x1, y1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** fbm über u,v in [0,1) mit Grundfrequenz fx/fy (ganzzahlig -> kachelbar) */
function fbm(u: number, v: number, fx: number, fy: number, oct = 5, seed = 1) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < oct; o++) {
    sum += amp * noise(u * fx, v * fy, fx, fy, seed + o * 17);
    norm += amp;
    amp *= 0.5;
    fx *= 2;
    fy *= 2;
  }
  return sum / norm;
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function canvas(n: number) {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  return c;
}

function normalFromHeight(h: Float32Array, n: number, strength: number) {
  const c = canvas(n);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(n, n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const l = h[y * n + ((x - 1 + n) % n)];
      const r = h[y * n + ((x + 1) % n)];
      const t = h[((y - 1 + n) % n) * n + x];
      const b = h[((y + 1) % n) * n + x];
      let dx = (l - r) * strength;
      let dy = (t - b) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * n + x) * 4;
      img.data[i] = ((dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

type Pixel = (u: number, v: number, x: number, y: number) => { c: [number, number, number]; h: number; r?: number };

function render(n: number, px: Pixel, strength: number, withRoughness = false): ProcResult {
  const color = canvas(n);
  const ctx = color.getContext('2d')!;
  const img = ctx.createImageData(n, n);
  const heights = new Float32Array(n * n);
  let rough: ImageData | undefined;
  let rctx: CanvasRenderingContext2D | undefined;
  let roughCanvas: HTMLCanvasElement | undefined;
  if (withRoughness) {
    roughCanvas = canvas(n);
    rctx = roughCanvas.getContext('2d')!;
    rough = rctx.createImageData(n, n);
  }
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const p = px(x / n, y / n, x, y);
      const i = (y * n + x) * 4;
      img.data[i] = p.c[0];
      img.data[i + 1] = p.c[1];
      img.data[i + 2] = p.c[2];
      img.data[i + 3] = 255;
      heights[y * n + x] = p.h;
      if (rough) {
        const r = Math.max(0, Math.min(255, (p.r ?? 0.5) * 255));
        rough.data[i] = rough.data[i + 1] = rough.data[i + 2] = r;
        rough.data[i + 3] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  if (rctx && rough) rctx.putImageData(rough, 0, 0);
  return { color, normal: normalFromHeight(heights, n, strength), roughness: roughCanvas };
}

const mix = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const scale = (a: [number, number, number], s: number): [number, number, number] => [a[0] * s, a[1] * s, a[2] * s];
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function woodValue(u: number, v: number, seed: number) {
  // Jahresringe entlang v (Maserung vertikal), verzerrt durch fbm
  const warp = fbm(u, v, 3, 1, 4, seed) * 3.0;
  const t = u * 9 + warp;
  const ring = Math.pow(0.5 + 0.5 * Math.sin(t * Math.PI * 2), 3);
  const fiber = noise(u * 400, v * 6, 400, 6, seed + 5);
  const fleck = fbm(u, v, 24, 3, 3, seed + 9);
  return 0.62 + ring * 0.22 + (fiber - 0.5) * 0.18 + (fleck - 0.5) * 0.16;
}

export function generate(kind: string, baseHex: string, size = 1024): ProcResult {
  const base = rgb(baseHex);
  switch (kind) {
    case 'oak':
    case 'walnut': {
      const seed = kind === 'oak' ? 3 : 11;
      return render(size, (u, v) => {
        const w = woodValue(u, v, seed);
        return { c: scale(base, w * 1.15), h: w };
      }, 1.5);
    }
    case 'marble':
    case 'marbleDark': {
      const dark = kind === 'marbleDark';
      const vein: [number, number, number] = dark ? [235, 232, 225] : [120, 122, 128];
      return render(size, (u, v) => {
        const f = fbm(u, v, 3, 3, 6, 21);
        const t = u * 2 + v * 1 + f * 3.5;
        const veins = Math.pow(1 - Math.abs(Math.sin(t * Math.PI)), 28);
        const f2 = fbm(u, v, 5, 5, 5, 41);
        const t2 = u * 1 - v * 3 + f2 * 5;
        const veins2 = Math.pow(1 - Math.abs(Math.sin(t2 * Math.PI)), 60) * 0.6;
        const cloud = fbm(u, v, 4, 4, 5, 7);
        let c = scale(base, 0.93 + cloud * 0.1);
        c = mix(c, vein, clamp01((veins + veins2) * (dark ? 0.85 : 0.55)));
        return { c, h: cloud * 0.2 };
      }, 0.5);
    }
    case 'ceramicCloud': {
      // Keramik: weiche, wolkige Tonwerte mit sehr feinen, blassen Adern
      return render(size, (u, v) => {
        const cloud = fbm(u, v, 3, 3, 6, 61);
        const f = fbm(u, v, 2, 2, 5, 71);
        const t = u * 1 + v * 2 + f * 2.5;
        const vein = Math.pow(1 - Math.abs(Math.sin(t * Math.PI)), 45) * 0.35;
        let c = scale(base, 0.95 + cloud * 0.08);
        c = mix(c, scale(base, 0.8), vein);
        return { c, h: cloud * 0.15 };
      }, 0.3);
    }
    case 'concrete':
    case 'plaster': {
      const pl = kind === 'plaster';
      return render(size, (u, v, x, y) => {
        const f = fbm(u, v, pl ? 6 : 4, pl ? 6 : 4, 6, 5);
        const pore = !pl && hash(x, y, 77) > 0.996 ? -0.25 : 0;
        const s = (pl ? 0.97 : 0.86) + f * (pl ? 0.05 : 0.22) + pore;
        return { c: scale(base, s), h: f + pore * 2 };
      }, pl ? 2 : 3);
    }
    case 'granite': {
      return render(size, (u, v, x, y) => {
        const r = hash(x >> 1, y >> 1, 13);
        const f = fbm(u, v, 16, 16, 3, 2);
        let c = scale(base, 0.85 + f * 0.25);
        if (r > 0.93) c = mix(c, [200, 200, 205], 0.6);
        else if (r < 0.06) c = scale(c, 0.5);
        return { c, h: f * 0.3 };
      }, 0.4);
    }
    case 'terrazzo': {
      const chips: { x: number; y: number; r: number; c: [number, number, number] }[] = [];
      const palette: [number, number, number][] = [[90, 90, 92], [180, 120, 95], [205, 200, 190], [60, 72, 70], [230, 225, 215]];
      for (let i = 0; i < 260; i++) {
        chips.push({ x: hash(i, 1, 9), y: hash(i, 2, 9), r: 0.004 + hash(i, 3, 9) * 0.018, c: palette[Math.floor(hash(i, 4, 9) * palette.length)] });
      }
      const n = 512;
      return render(n, (u, v) => {
        let c = scale(base, 0.96 + fbm(u, v, 8, 8, 3, 3) * 0.06);
        for (const ch of chips) {
          let dx = Math.abs(u - ch.x);
          let dy = Math.abs(v - ch.y);
          dx = Math.min(dx, 1 - dx);
          dy = Math.min(dy, 1 - dy);
          const d = dx * dx * 1.3 + dy * dy + (noise(u * 60, v * 60, 60, 60, 4) - 0.5) * ch.r * ch.r;
          if (d < ch.r * ch.r) {
            c = ch.c;
            break;
          }
        }
        return { c, h: 0 };
      }, 0);
    }
    case 'subway': {
      // 4 Reihen x 2 Fliesen (Seitenverhältnis 2:1), versetzt verlegt
      return render(size, (u, v) => {
        const rows = 4;
        const row = Math.floor(v * rows);
        const uu = (u * 2 + (row % 2) * 0.5) % 1;
        const col = Math.floor((u * 2 + (row % 2) * 0.5)) % 2;
        const fu = (u * 2 + (row % 2) * 0.5) % 1;
        const fv = (v * rows) % 1;
        const g = 0.012 * 2;
        const grout = fu < g || fu > 1 - g || fv < g * 2 || fv > 1 - g * 2;
        if (grout) return { c: [205, 203, 198], h: 0, r: 0.9 };
        const edge = Math.min(fu, 1 - fu, fv * 0.5, (1 - fv) * 0.5);
        const bevel = clamp01(edge / 0.03);
        const tint = 0.95 + hash(row, col, 3) * 0.08;
        const glaze = fbm(uu, fv, 2, 2, 3, 3) * 0.03;
        return { c: scale(base, tint + glaze), h: 0.4 + bevel * 0.6, r: 0.15 };
      }, 6, true);
    }
    case 'parquet': {
      // 6 Dielen pro Kachel, je 2 Stöße mit zufälliger Lage
      return render(size, (u, v) => {
        const planks = 6;
        const pi = Math.floor(u * planks);
        const fu = (u * planks) % 1;
        const cut = hash(pi, 0, 5);
        const seg = (v + cut) % 1 < 0.5 ? 0 : 1;
        const fv = ((v + cut) % 0.5) / 0.5;
        const gap = fu < 0.012 || fu > 0.988 || fv < 0.004 || fv > 0.996;
        const w = woodValue((u * planks) / planks + pi * 0.37, v * 0.5 + seg * 0.31, 3 + pi * 2 + seg);
        const tint = 0.88 + hash(pi, seg, 8) * 0.22;
        if (gap) return { c: scale(base, 0.35), h: 0 };
        return { c: scale(base, w * tint * 1.1), h: 0.5 + w * 0.2 };
      }, 3);
    }
    case 'floortile': {
      // 2 x 2 Großformatfliesen mit Fuge
      return render(size, (u, v) => {
        const fu = (u * 2) % 1;
        const fv = (v * 2) % 1;
        const ti = Math.floor(u * 2) + Math.floor(v * 2) * 2;
        const g = 0.006;
        if (fu < g || fu > 1 - g || fv < g || fv > 1 - g) return { c: scale(base, 0.75), h: 0, r: 0.95 };
        const f = fbm(u, v, 6, 6, 5, 31 + ti);
        return { c: scale(base, 0.92 + f * 0.14 + hash(ti, 0, 2) * 0.04), h: 0.6 + f * 0.05, r: 0.35 + f * 0.2 };
      }, 4, true);
    }
    case 'brushed': {
      return render(size, (u, v) => {
        const s = noise(u * 2, v * 600, 2, 600, 3) * 0.6 + noise(u * 8, v * 1200, 8, 1200, 4) * 0.4;
        return { c: scale(base, 0.9 + s * 0.15), h: s, r: 0.25 + s * 0.2 };
      }, 0.6, true);
    }
  }
  return render(8, () => ({ c: base, h: 0 }), 0);
}
