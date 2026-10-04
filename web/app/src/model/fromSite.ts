// Haus aus dem früheren Heimlager-Modell („Haus einrichten“) übernehmen: Etagen mit Außenumriss und Räumen als Vielecke
// in mm, Wände implizit als „Umriss minus Räume“, Öffnungen frei auf der Wand, Einbauten (Regal, Schrank …).
// Daraus werden Wandsegmente (Achse + Stärke), an Wände gebundene Öffnungen, Räume und Möbel des Hausplans.
// Reine Logik (cm im Ergebnis) – läuft im Skript und in der App.

import type { Floor, FloorKind, House, Item, Opening, Room, Vec2, Wall } from './types.ts';
import { emptyHouse, makeFloor, uid } from './house.ts';
import { pointInPolygon, polygonArea, polygonCentroid } from './rooms.ts';

export interface SiteFloor {
  name: string;
  kind: 'floor' | 'attic' | 'outdoor';
  elevation: number;
  height: number;
  outline: [number, number][];
  rooms: { name: string; kind?: string; polygon: [number, number][]; height?: number }[];
  openings: { kind: 'door' | 'passage' | 'window'; x: number; y: number; rotation: number; width: number; height: number; sill?: number }[];
  roof?: { type: 'gable'; pitch: number; knee: number; ridge: 'x' | 'y' } | null;
  fixtures: { kind: string; name: string; x: number; y: number; rotation: number; width: number; depth: number; height: number; elevation: number; levels: number }[];
}

const MM = 0.1; // mm → cm
const MIN_GAP = 40; // mm: Räume näher beieinander sind offen verbunden (keine Wand)
const MAX_GAP = 650; // mm: dickere „Wände“ gibt es nicht
const DEFAULT_OUTER = 365; // mm, wenn am Umriss kein Raum gegenüberliegt

type Seg = { a: Vec2; b: Vec2 };
type RawWall = { a: Vec2; b: Vec2; t: number };

const sub = (p: Vec2, q: Vec2) => ({ x: p.x - q.x, y: p.y - q.y });
const dot = (p: Vec2, q: Vec2) => p.x * q.x + p.y * q.y;
const len = (p: Vec2) => Math.hypot(p.x, p.y);
const edges = (poly: Vec2[]): Seg[] => poly.map((a, i) => ({ a, b: poly[(i + 1) % poly.length] }));
const toV = (p: [number, number]): Vec2 => ({ x: p[0], y: p[1] });

/** Punkt sicher im Inneren eines Vielecks (Schwerpunkt, sonst Mitte der ersten Schnittstrecke einer Waagerechten) */
export function interiorPoint(poly: Vec2[]): Vec2 {
  const c = polygonCentroid(poly);
  if (pointInPolygon(c, poly)) return c;
  const ys = poly.map((p) => p.y).sort((a, b) => a - b);
  for (let k = 1; k < ys.length; k++) {
    const y = (ys[k - 1] + ys[k]) / 2;
    if (ys[k] - ys[k - 1] < 1e-6) continue;
    const xs: number[] = [];
    for (const e of edges(poly)) {
      if ((e.a.y > y) !== (e.b.y > y)) xs.push(e.a.x + ((y - e.a.y) * (e.b.x - e.a.x)) / (e.b.y - e.a.y));
    }
    xs.sort((a, b) => a - b);
    if (xs.length >= 2) return { x: (xs[0] + xs[1]) / 2, y };
  }
  return poly[0];
}

/**
 * Wände aus Umriss und Räumen: Zwischen zwei parallelen, einander zugewandten Kanten (Raum–Raum oder Raum–Umriss) im
 * Abstand 4–65 cm liegt eine Wand; Achse in der Mitte, Stärke = Abstand, Länge = Überlappung. Umrisskanten ohne Raum
 * davor bekommen eine Außenwand üblicher Stärke. Danach werden Wandenden an Ecken und T-Stößen verbunden.
 */
export function deriveWalls(outline: Vec2[], rooms: Vec2[][]): RawWall[] {
  const walls: RawWall[] = [];
  const polys = [...rooms.map((p, i) => ({ id: i, poly: p })), ...(outline.length >= 3 ? [{ id: -1, poly: outline }] : [])];
  const covered = new Map<Seg, [number, number][]>(); // Umrisskante → abgedeckte Intervalle (mm entlang der Kante)
  const outlineEdges = outline.length >= 3 ? edges(outline) : [];
  for (const e of outlineEdges) covered.set(e, []);

  for (let i = 0; i < rooms.length; i++) {
    for (const e1 of edges(rooms[i])) {
      const d1 = sub(e1.b, e1.a);
      const L1 = len(d1);
      if (L1 < 50) continue;
      const u = { x: d1.x / L1, y: d1.y / L1 };
      const n = { x: -u.y, y: u.x };
      for (const other of polys) {
        if (other.id === i || (other.id >= 0 && other.id < i)) continue; // Raum–Raum nur einmal
        for (const e2 of other.id === -1 ? outlineEdges : edges(other.poly)) {
          const d2 = sub(e2.b, e2.a);
          const L2 = len(d2);
          if (L2 < 50) continue;
          if (Math.abs(u.x * d2.y - u.y * d2.x) / L2 > 0.035) continue; // nicht parallel (> 2°)
          const da = dot(sub(e2.a, e1.a), n);
          const db = dot(sub(e2.b, e1.a), n);
          if (Math.abs(da - db) > 30) continue;
          const dist = (da + db) / 2;
          if (Math.abs(dist) < MIN_GAP || Math.abs(dist) > MAX_GAP) continue;
          const ta = dot(sub(e2.a, e1.a), u);
          const tb = dot(sub(e2.b, e1.a), u);
          const t0 = Math.max(0, Math.min(ta, tb));
          const t1 = Math.min(L1, Math.max(ta, tb));
          if (t1 - t0 < 100) continue;
          const at = (t: number) => ({ x: e1.a.x + u.x * t + (n.x * dist) / 2, y: e1.a.y + u.y * t + (n.y * dist) / 2 });
          walls.push({ a: at(t0), b: at(t1), t: Math.abs(dist) });
          if (other.id === -1) {
            // Abdeckung auf der Umrisskante merken (Parameter entlang e2)
            const v = { x: d2.x / L2, y: d2.y / L2 };
            const p0 = dot(sub({ x: e1.a.x + u.x * t0, y: e1.a.y + u.y * t0 }, e2.a), v);
            const p1 = dot(sub({ x: e1.a.x + u.x * t1, y: e1.a.y + u.y * t1 }, e2.a), v);
            covered.get(e2)!.push([Math.min(p0, p1), Math.max(p0, p1)]);
          }
        }
      }
    }
  }

  // Umrisskanten ohne Raum davor: Außenwand nach innen
  const outerT = median(walls.filter((w) => w.t > 250).map((w) => w.t)) ?? DEFAULT_OUTER;
  const inward = outline.length >= 3 && polygonArea(outline) > 0 ? 1 : -1; // y nach unten: positive Fläche = im Uhrzeigersinn
  for (const e of outlineEdges) {
    const d = sub(e.b, e.a);
    const L = len(d);
    const u = { x: d.x / L, y: d.y / L };
    const n = { x: -u.y * inward, y: u.x * inward };
    const iv = covered.get(e)!.sort((p, q) => p[0] - q[0]);
    let t = 0;
    const gaps: [number, number][] = [];
    for (const [a, b] of iv) {
      if (a - t > 200) gaps.push([t, a]);
      t = Math.max(t, b);
    }
    if (L - t > 200) gaps.push([t, L]);
    for (const [a, b] of gaps) {
      const at = (s: number) => ({ x: e.a.x + u.x * s + (n.x * outerT) / 2, y: e.a.y + u.y * s + (n.y * outerT) / 2 });
      walls.push({ a: at(a), b: at(b), t: outerT });
    }
  }
  return joinWalls(walls);
}

function median(v: number[]) {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Wandenden auf die Achse der nächsten querstehenden Wand ziehen (Ecken schließen, T-Stöße anschließen) */
function joinWalls(walls: RawWall[]): RawWall[] {
  for (const w of walls) {
    for (const end of ['a', 'b'] as const) {
      const p = w[end];
      const dw = sub(w.b, w.a);
      let best: { x: Vec2; d: number } | null = null;
      for (const o of walls) {
        if (o === w) continue;
        const dO = sub(o.b, o.a);
        const den = dw.x * dO.y - dw.y * dO.x;
        if (Math.abs(den) / (len(dw) * len(dO)) < 0.2) continue; // (fast) parallel
        // Schnittpunkt der beiden Achsen
        const s = ((o.a.x - w.a.x) * dO.y - (o.a.y - w.a.y) * dO.x) / den;
        const x = { x: w.a.x + dw.x * s, y: w.a.y + dw.y * s };
        const d = len(sub(x, p));
        const reach = (o.t + w.t) / 2 + 80;
        if (d > reach) continue;
        // Schnittpunkt muss auf (oder knapp neben) der anderen Wand liegen
        const r = dot(sub(x, o.a), dO) / dot(dO, dO);
        const tol = (w.t / 2 + 80) / len(dO);
        if (r < -tol || r > 1 + tol) continue;
        if (!best || d < best.d) best = { x, d };
      }
      if (best) w[end] = best.x;
    }
  }
  return walls.filter((w) => len(sub(w.b, w.a)) > 50);
}

/** Einbau aus dem Lager → Möbel des Hausplans */
function fixtureItem(fx: SiteFloor['fixtures'][number]): Item | null {
  const base = {
    id: uid(),
    x: fx.x * MM,
    y: fx.y * MM,
    rotation: (fx.rotation * Math.PI) / 180,
    width: fx.width * MM,
    depth: fx.depth * MM,
    height: fx.height * MM,
    elevation: fx.elevation * MM,
    ...(fx.name ? { label: fx.name } : {}),
  };
  switch (fx.kind) {
    case 'stairs':
      return { ...base, type: 'stairs', levels: fx.levels };
    case 'shelf':
      return { ...base, type: 'rack', levels: fx.levels };
    case 'floor':
      return { ...base, type: 'rack', levels: 1 };
    case 'fridge':
      return { ...base, type: 'fridge-free' };
    case 'wall_cabinet':
      return { ...base, type: 'wall-doors', front: 'doors' };
    case 'cabinet':
      if (fx.height <= 1000) return { ...base, type: 'base-doors', front: 'doors' };
      if (fx.height >= 1800 && fx.depth >= 550) return { ...base, type: 'wardrobe', front: 'doors', levels: Math.max(1, fx.levels) };
      return { ...base, type: 'cupboard', front: 'doors', levels: Math.max(1, fx.levels) };
    default:
      return null;
  }
}

/** Öffnung (frei, mit Mittelpunkt und Drehung) an die passende Wand binden */
function bindOpening(o: SiteFloor['openings'][number], walls: Wall[]): Opening | null {
  const c = { x: o.x * MM, y: o.y * MM };
  const dirO = { x: Math.cos((o.rotation * Math.PI) / 180), y: Math.sin((o.rotation * Math.PI) / 180) };
  let best: { w: Wall; t: number; d: number } | null = null;
  for (const w of walls) {
    const d = sub(w.b, w.a);
    const L = len(d);
    const u = { x: d.x / L, y: d.y / L };
    if (Math.abs(u.x * dirO.y - u.y * dirO.x) > 0.26) continue; // > 15° verdreht
    const t = dot(sub(c, w.a), u);
    if (t < -10 || t > L + 10) continue;
    const dist = Math.abs(dot(sub(c, w.a), { x: -u.y, y: u.x }));
    if (dist > w.thickness / 2 + 25) continue;
    if (!best || dist < best.d) best = { w, t, d: dist };
  }
  if (!best) return null;
  const L = len(sub(best.w.b, best.w.a));
  const width = Math.min(o.width * MM, L);
  return {
    id: uid(),
    wallId: best.w.id,
    type: o.kind === 'window' ? 'window' : o.kind === 'passage' ? 'passage' : 'door',
    offset: Math.max(width / 2, Math.min(L - width / 2, best.t)),
    width,
    height: o.height * MM,
    sill: o.kind === 'window' ? (o.sill ?? 0) * MM : 0,
  };
}

const ROOM_KINDS: Record<string, Room['kind']> = { carport: 'carport', terrace: 'terrace', parking: 'parking', area: 'area' };

export function siteFloorToFloor(sf: SiteFloor): Floor {
  const kind: FloorKind = sf.kind === 'outdoor' ? 'outdoor' : sf.kind === 'attic' ? 'attic' : sf.elevation < -500 ? 'basement' : 'floor';
  const outline = sf.outline.map(toV);
  const inner = sf.rooms.filter((r) => !r.kind || r.kind === 'room');
  const raw = kind === 'outdoor' ? [] : deriveWalls(outline, inner.map((r) => r.polygon.map(toV)));
  const height = Math.round(sf.height * MM * 10) / 10 || 260;
  const walls: Wall[] = raw.map((w) => ({
    id: uid(),
    a: { x: Math.round(w.a.x * MM * 10) / 10, y: Math.round(w.a.y * MM * 10) / 10 },
    b: { x: Math.round(w.b.x * MM * 10) / 10, y: Math.round(w.b.y * MM * 10) / 10 },
    thickness: Math.round(w.t * MM * 10) / 10,
    height,
  }));
  const rooms: Room[] = sf.rooms.map((r) => {
    const poly = r.polygon.map((p) => ({ x: p[0] * MM, y: p[1] * MM }));
    return { id: uid(), name: r.name, code: '', seed: interiorPoint(poly), polygon: poly, manual: true, ...(ROOM_KINDS[r.kind ?? ''] ? { kind: ROOM_KINDS[r.kind!] } : {}) };
  });
  return makeFloor({
    name: sf.name,
    kind,
    elevation: Math.round(sf.elevation * MM),
    height,
    walls,
    openings: sf.openings.map((o) => bindOpening(o, walls)).filter((o): o is Opening => !!o),
    items: sf.fixtures.map(fixtureItem).filter((i): i is Item => !!i),
    rooms,
    ...(sf.roof ? { roof: { type: 'gable' as const, pitch: sf.roof.pitch, knee: sf.roof.knee * MM, ridge: sf.roof.ridge } } : {}),
  });
}

/** Ganzes Haus aus GET /api/site des früheren Heimlagers */
export function siteToHouse(site: { floors: SiteFloor[] }, name = 'Mein Zuhause'): House {
  const h = emptyHouse(name);
  h.floors = site.floors.map(siteFloorToFloor).sort((a, b) => a.elevation - b.elevation);
  return h;
}
