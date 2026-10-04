// Räume aus Wänden erkennen: Die Wandachsen bilden einen ebenen Graphen (T-Stöße und Kreuzungen werden geteilt).
// Jede geschlossene Fläche dieses Graphen ist ein möglicher Raum; ein Raum merkt sich einen Punkt (seed) und bekommt die
// kleinste Fläche, die diesen Punkt enthält. So folgt der Raum automatisch, wenn Wände verschoben werden.
// Reine Logik ohne DOM/three – läuft in der App und auf dem Server.

import type { Vec2, Wall } from './types.ts';

const EPS = 0.5; // cm: Punkte näher als das gelten als gleich

export function polygonArea(poly: Vec2[]) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function pointInPolygon(p: Vec2, poly: Vec2[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function polygonCentroid(poly: Vec2[]): Vec2 {
  const A = polygonArea(poly);
  if (Math.abs(A) < 1e-6) {
    const n = poly.length || 1;
    return { x: poly.reduce((s, p) => s + p.x, 0) / n, y: poly.reduce((s, p) => s + p.y, 0) / n };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * A), y: cy / (6 * A) };
}

/** Parameter t (0…1) des Schnittpunkts zweier Strecken, falls sie sich echt schneiden */
function intersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number | null {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
  if (t <= 1e-6 || t >= 1 - 1e-6 || u < -1e-6 || u > 1 + 1e-6) return null;
  return t;
}

/** Alle geschlossenen Flächen des Wandgraphen (jede als Eckpunktfolge; enthält auch die Außenumrisse) */
export function wallFaces(walls: Wall[]): Vec2[][] {
  // 1. Wände an Endpunkten anderer Wände (T-Stoß) und an Kreuzungen teilen
  const segs: [Vec2, Vec2][] = [];
  for (const w of walls) {
    const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
    if (L < EPS) continue;
    const ts = [0, 1];
    for (const o of walls) {
      if (o === w) continue;
      for (const p of [o.a, o.b]) {
        const t = ((p.x - w.a.x) * (w.b.x - w.a.x) + (p.y - w.a.y) * (w.b.y - w.a.y)) / (L * L);
        if (t <= 0 || t >= 1) continue;
        const q = { x: w.a.x + (w.b.x - w.a.x) * t, y: w.a.y + (w.b.y - w.a.y) * t };
        if (Math.hypot(q.x - p.x, q.y - p.y) < EPS) ts.push(t);
      }
      const t = intersect(w.a, w.b, o.a, o.b);
      if (t !== null) ts.push(t);
    }
    ts.sort((x, y) => x - y);
    for (let i = 0; i < ts.length - 1; i++) {
      if ((ts[i + 1] - ts[i]) * L < EPS) continue;
      const at = (t: number) => ({ x: w.a.x + (w.b.x - w.a.x) * t, y: w.a.y + (w.b.y - w.a.y) * t });
      segs.push([at(ts[i]), at(ts[i + 1])]);
    }
  }

  // 2. Knoten zusammenfassen
  const key = (p: Vec2) => `${Math.round(p.x / EPS)},${Math.round(p.y / EPS)}`;
  const pts = new Map<string, Vec2>();
  const adj = new Map<string, Set<string>>();
  for (const [a, b] of segs) {
    const ka = key(a);
    const kb = key(b);
    if (ka === kb) continue;
    if (!pts.has(ka)) pts.set(ka, a);
    if (!pts.has(kb)) pts.set(kb, b);
    if (!adj.has(ka)) adj.set(ka, new Set());
    if (!adj.has(kb)) adj.set(kb, new Set());
    adj.get(ka)!.add(kb);
    adj.get(kb)!.add(ka);
  }

  // 3. Nachbarn je Knoten nach Winkel sortieren
  const sorted = new Map<string, string[]>();
  for (const [k, ns] of adj) {
    const p = pts.get(k)!;
    sorted.set(k, [...ns].sort((m, n) => {
      const pm = pts.get(m)!;
      const pn = pts.get(n)!;
      return Math.atan2(pm.y - p.y, pm.x - p.x) - Math.atan2(pn.y - p.y, pn.x - p.x);
    }));
  }

  // 4. Flächen ablaufen: an jedem Knoten die nächste Kante im Winkel nach der Rückkante nehmen
  const used = new Set<string>();
  const faces: Vec2[][] = [];
  for (const [u, ns] of sorted) {
    for (const v of ns) {
      if (used.has(`${u}>${v}`)) continue;
      const face: Vec2[] = [];
      let a = u;
      let b = v;
      for (let guard = 0; guard < 10000; guard++) {
        used.add(`${a}>${b}`);
        face.push(pts.get(a)!);
        const around = sorted.get(b)!;
        const i = around.indexOf(a);
        const c = around[(i - 1 + around.length) % around.length];
        a = b;
        b = c;
        if (a === u && b === v) break;
      }
      if (face.length >= 3) faces.push(simplify(face));
    }
  }
  return faces.filter((f) => f.length >= 3 && Math.abs(polygonArea(f)) > 100);
}

/** Punkte auf einer Geraden entfernen (entstehen durch das Teilen der Wände) */
function simplify(poly: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[(i - 1 + poly.length) % poly.length];
    const c = poly[i];
    const n = poly[(i + 1) % poly.length];
    const cross = (c.x - p.x) * (n.y - c.y) - (c.y - p.y) * (n.x - c.x);
    const back = Math.hypot(n.x - p.x, n.y - p.y) < EPS; // Sackgasse (Wand ohne Anschluss) – Spitze behalten
    if (Math.abs(cross) > 1e-6 * Math.max(1, Math.hypot(n.x - p.x, n.y - p.y)) || back) out.push(c);
  }
  return out;
}

/** Kleinste geschlossene Fläche, die den Punkt enthält – oder null, wenn der Punkt in keinem geschlossenen Bereich liegt */
export function roomPolygon(walls: Wall[], seed: Vec2, faces = wallFaces(walls)): Vec2[] | null {
  let best: Vec2[] | null = null;
  let bestArea = Infinity;
  for (const f of faces) {
    if (!pointInPolygon(seed, f)) continue;
    const a = Math.abs(polygonArea(f));
    if (a < bestArea) {
      bestArea = a;
      best = f;
    }
  }
  return best;
}
