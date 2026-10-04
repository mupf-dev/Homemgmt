import type { Item, Opening, Project, Vec2, Wall } from './types.ts';
import { getEntry } from './catalog.ts';

export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const mul = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const len = (a: Vec2) => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (a: Vec2): Vec2 => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
};

export function wallLength(w: Wall) {
  return dist(w.a, w.b);
}
export function wallDir(w: Wall) {
  return norm(sub(w.b, w.a));
}
/** Linke Normale (bei y nach unten: zeigt "rechts" der Laufrichtung visuell) */
export function wallNormal(w: Wall): Vec2 {
  const d = wallDir(w);
  return { x: -d.y, y: d.x };
}

/** Projektion eines Punktes auf die Wandachse */
export function projectOnWall(w: Wall, p: Vec2) {
  const d = wallDir(w);
  const L = wallLength(w);
  const t = (p.x - w.a.x) * d.x + (p.y - w.a.y) * d.y;
  const tc = Math.max(0, Math.min(L, t));
  const q = add(w.a, mul(d, tc));
  const n = wallNormal(w);
  const side = (p.x - q.x) * n.x + (p.y - q.y) * n.y;
  return { t, tc, point: q, distance: dist(p, q), side: side >= 0 ? 1 : -1, L };
}

export function openingCenter(w: Wall, o: Opening): Vec2 {
  return add(w.a, mul(wallDir(w), o.offset));
}

/** Lokale Ecken eines Elements im Grundriss */
export function itemCorners(it: Item): Vec2[] {
  const c = Math.cos(it.rotation);
  const s = Math.sin(it.rotation);
  const hw = it.width / 2;
  const hd = it.depth / 2;
  return [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ].map(([x, y]) => ({ x: it.x + x * c - y * s, y: it.y + x * s + y * c }));
}

/** Weltpunkt -> lokale Koordinaten eines Elements */
export function toItemLocal(it: Item, p: Vec2): Vec2 {
  const c = Math.cos(-it.rotation);
  const s = Math.sin(-it.rotation);
  const dx = p.x - it.x;
  const dy = p.y - it.y;
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}

export function pointInItem(it: Item, p: Vec2, pad = 0) {
  const l = toItemLocal(it, p);
  return Math.abs(l.x) <= it.width / 2 + pad && Math.abs(l.y) <= it.depth / 2 + pad;
}

export function distToSegment(p: Vec2, a: Vec2, b: Vec2) {
  const d = sub(b, a);
  const L2 = d.x * d.x + d.y * d.y || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / L2));
  return dist(p, add(a, mul(d, t)));
}

/**
 * Dockt ein Element an die nächste Wand an: Rückseite bündig an der Wandinnenseite,
 * Front zeigt in den Raum. Anschließend Kantenfang an Nachbarelementen.
 */
export function snapItem(project: Project, it: Item, raw: Vec2, enabled = true) {
  it.x = raw.x;
  it.y = raw.y;
  delete it.wallId;
  const entry = getEntry(it.type);
  if (!enabled || !entry.snapToWall) {
    snapToNeighbours(project, it);
    return;
  }
  let best: { w: Wall; pr: ReturnType<typeof projectOnWall> } | null = null;
  for (const w of project.walls) {
    const pr = projectOnWall(w, raw);
    if (pr.t < -it.width / 2 || pr.t > pr.L + it.width / 2) continue;
    const threshold = w.thickness / 2 + it.depth / 2 + 35;
    if (pr.distance < threshold && (!best || pr.distance < best.pr.distance)) best = { w, pr };
  }
  if (best && entry.kind === 'stairs') {
    // Treppen behalten ihre Drehung (sonst passen sie nicht zwischen zwei Wände): nur bündig an die Wand schieben
    const { w, pr } = best;
    const n = mul(wallNormal(w), pr.side);
    const c = Math.cos(it.rotation);
    const s = Math.sin(it.rotation);
    // halbe Ausdehnung der Treppe quer zur Wand
    const half = Math.abs((it.width / 2) * (c * n.x + s * n.y)) + Math.abs((it.depth / 2) * (-s * n.x + c * n.y));
    const q = pr.point;
    const off = w.thickness / 2 + half;
    // entlang der Wand bleibt die Treppe, wo sie gezogen wird; quer dazu liegt sie bündig an
    const perp = (raw.x - q.x) * n.x + (raw.y - q.y) * n.y;
    it.x = raw.x + n.x * (off - perp);
    it.y = raw.y + n.y * (off - perp);
    it.wallId = w.id;
    snapToNeighbours(project, it);
    return;
  }
  if (best) {
    const { w, pr } = best;
    const n = mul(wallNormal(w), pr.side);
    const off = w.thickness / 2 + it.depth / 2;
    const d = wallDir(w);
    // entlang der Wand innerhalb der Wandlänge halten
    const t = Math.max(it.width / 2 - w.thickness / 2, Math.min(pr.L - it.width / 2 + w.thickness / 2, pr.t));
    const q = add(w.a, mul(d, t));
    it.x = q.x + n.x * off;
    it.y = q.y + n.y * off;
    it.rotation = Math.atan2(-n.x, n.y);
    it.wallId = w.id;
  }
  snapToNeighbours(project, it);
}

/** Fängt Seitenkanten an Elementen mit gleicher Ausrichtung */
function snapToNeighbours(project: Project, it: Item) {
  const SNAP = 8;
  const d = { x: Math.cos(it.rotation), y: Math.sin(it.rotation) };
  let bestShift = 0;
  let bestDist = SNAP;
  for (const o of project.items) {
    if (o.id === it.id) continue;
    if (Math.abs(Math.sin(o.rotation - it.rotation)) > 0.01) continue;
    // nur Elemente in derselben "Reihe"
    const rel = sub({ x: o.x, y: o.y }, { x: it.x, y: it.y });
    const along = rel.x * d.x + rel.y * d.y;
    const across = -rel.x * d.y + rel.y * d.x;
    if (Math.abs(across) > (o.depth + it.depth) / 2) continue;
    const verticalOverlap = !(o.elevation >= it.elevation + it.height || it.elevation >= o.elevation + o.height);
    if (!verticalOverlap) continue;
    for (const target of [along - o.width / 2 - it.width / 2, along + o.width / 2 + it.width / 2, along]) {
      if (Math.abs(target) < bestDist) {
        bestDist = Math.abs(target);
        bestShift = target;
      }
    }
  }
  it.x += d.x * bestShift;
  it.y += d.y * bestShift;
}

/** Sucht einen geschlossenen Wandzug für den Bodenumriss; sonst Bounding Box */
export function floorPolygon(project: Project): Vec2[] {
  const walls = project.walls;
  if (walls.length === 0) return [];
  const key = (p: Vec2) => `${Math.round(p.x)},${Math.round(p.y)}`;
  const adj = new Map<string, { p: Vec2; walls: Wall[] }>();
  for (const w of walls) {
    for (const p of [w.a, w.b]) {
      const k = key(p);
      if (!adj.has(k)) adj.set(k, { p, walls: [] });
      adj.get(k)!.walls.push(w);
    }
  }
  // größten Zyklus suchen
  let bestPoly: Vec2[] = [];
  let bestArea = 0;
  const tried = new Set<string>();
  for (const start of walls) {
    if (tried.has(start.id)) continue;
    const poly: Vec2[] = [start.a];
    const used = new Set<string>([start.id]);
    let cur = start.b;
    let ok = false;
    for (let guard = 0; guard < walls.length + 1; guard++) {
      if (key(cur) === key(start.a)) {
        ok = true;
        break;
      }
      poly.push(cur);
      const node = adj.get(key(cur));
      const next = node?.walls.find((w) => !used.has(w.id));
      if (!next) break;
      used.add(next.id);
      cur = key(next.a) === key(cur) ? next.b : next.a;
    }
    used.forEach((u) => tried.add(u));
    if (ok && poly.length >= 3) {
      const a = Math.abs(polyArea(poly));
      if (a > bestArea) {
        bestArea = a;
        bestPoly = poly;
      }
    }
  }
  if (bestPoly.length) return bestPoly;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const w of walls)
    for (const p of [w.a, w.b]) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
}

export function polyArea(poly: Vec2[]) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function bounds(project: Project) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const pts: Vec2[] = [];
  project.walls.forEach((w) => pts.push(w.a, w.b));
  project.items.forEach((i) => pts.push(...itemCorners(i)));
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (!pts.length) return { minX: 0, minY: 0, maxX: 500, maxY: 400 };
  return { minX, minY, maxX, maxY };
}

/** Zusammenhängende Arbeitsplatte über mehrere Unterschränke (UV-Ausdehnung in Metern) */
export interface CountertopRun {
  ids: string[];
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

/**
 * Fasst Elemente mit Arbeitsplatte, die gleich ausgerichtet in einer Flucht direkt
 * aneinander stehen, zu Arbeitsplattenzeilen zusammen.
 * Koordinaten: u = entlang der Ausrichtung, v = quer dazu (wie die Mesh-UVs der Oberseite).
 */
export function countertopRuns(project: Project): Map<string, CountertopRun> {
  const items = project.items.filter((i) => getEntry(i.type).countertop);
  const info = items.map((it) => {
    const c = Math.cos(it.rotation);
    const s = Math.sin(it.rotation);
    const along = it.x * c + it.y * s;
    const across = -it.x * s + it.y * c;
    const island = getEntry(it.type).kind === 'island';
    const backOver = island && it.islandBack === 'doors' ? 2 : 0;
    const ov = it.ctOverhang;
    // Möbelart aus der Objektbibliothek: Überstand aus ihrer Beschreibung
    const obj = getEntry(it.type).object?.build;
    const front = ov?.f ?? (obj?.type === 'korpus' && obj.countertop ? obj.countertop.overhang : 2);
    return {
      it,
      rot: Math.round((((it.rotation * 180) / Math.PI) % 360 + 360) % 360),
      a0: along - it.width / 2,
      a1: along + it.width / 2,
      // tatsächliche Plattenkanten inkl. Überstand (für „Textur strecken“)
      e0: along - it.width / 2 - (ov?.l ?? 0),
      e1: along + it.width / 2 + (ov?.r ?? 0),
      back: across - it.depth / 2 - backOver - (ov?.b ?? 0),
      front: across + it.depth / 2 + front,
      across,
    };
  });
  info.sort((a, b) => a.rot - b.rot || a.across - b.across || a.a0 - b.a0);
  const runs = new Map<string, CountertopRun>();
  let cur: (typeof info)[number][] = [];
  const flush = () => {
    if (!cur.length) return;
    const run: CountertopRun = {
      ids: cur.map((x) => x.it.id),
      u0: Math.min(...cur.map((x) => x.e0)) / 100,
      u1: Math.max(...cur.map((x) => x.e1)) / 100,
      v0: Math.min(...cur.map((x) => x.back)) / 100,
      v1: Math.max(...cur.map((x) => x.front)) / 100,
    };
    for (const x of cur) runs.set(x.it.id, run);
    cur = [];
  };
  for (const x of info) {
    const last = cur[cur.length - 1];
    const joins =
      last && last.rot === x.rot && Math.abs(last.across - x.across) < 2 && x.a0 - Math.max(...cur.map((c) => c.a1)) < 2 && Math.abs(last.it.elevation - x.it.elevation) < 1;
    if (!joins) flush();
    cur.push(x);
  }
  flush();
  return runs;
}
