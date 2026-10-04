// Begehen wie in einem Spiel: Laufen mit Kollision (Wände, Möbel), Türen und Durchgänge passierbar, Schwerkraft mit
// Stufen, Treppen hinauf und hinunter. Alles in Metern; Grundriss-x → x, Grundriss-y → z, Höhe → y.

import type { Floor, House, Item, Vec2 } from './model/types.ts';
import { getEntry } from './model/catalog.ts';
import { floorPolygon, itemCorners, wallDir, wallLength } from './model/geom.ts';
import { floorView } from './model/house.ts';
import { pointInPolygon } from './model/rooms.ts';

const M = 0.01;
const R = 0.22; // Körperradius
const STEP = 0.32; // so hoch kann man ohne Treppe steigen (Schwelle, Stufe)
const EYE = 1.65;

type Seg = { a: Vec2; b: Vec2; r: number };
type Stair = { poly: Vec2[]; x: number; y: number; rot: number; depth: number; y0: number; h: number };
type Level = { f: Floor; y: number; walls: Seg[]; boxes: Vec2[][]; surfaces: Vec2[][]; holes: Vec2[][]; stairs: Stair[] };

const m = (p: Vec2): Vec2 => ({ x: p.x * M, y: p.y * M });
function segDist(p: Vec2, a: Vec2, b: Vec2) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}
function nearest(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return { x: a.x + dx * t, y: a.y + dy * t };
}
const isStairs = (it: Item) => getEntry(it.type).kind === 'stairs';

export class Walker {
  levels: Level[] = [];
  pos = { x: 0, z: 0, feet: 0, vy: 0 };

  constructor(house: House) {
    const indoor = house.floors.filter((f) => f.kind !== 'outdoor').sort((a, b) => a.elevation - b.elevation);
    for (const f of house.floors) {
      const walls: Seg[] = [];
      for (const w of f.walls) {
        const L = wallLength(w);
        const d = wallDir(w);
        // Türen und Durchgänge (Brüstung ~0) sind Lücken; Fenster nicht
        const gaps = f.openings.filter((o) => o.wallId === w.id && o.type !== 'window' && o.sill < 30).map((o) => [o.offset - o.width / 2, o.offset + o.width / 2]).sort((a, b) => a[0] - b[0]);
        let t = 0;
        const piece = (t0: number, t1: number) => {
          if (t1 - t0 < 1) return;
          walls.push({ a: m({ x: w.a.x + d.x * t0, y: w.a.y + d.y * t0 }), b: m({ x: w.a.x + d.x * t1, y: w.a.y + d.y * t1 }), r: (w.thickness / 2) * M });
        };
        for (const [g0, g1] of gaps) {
          piece(t, g0);
          t = Math.max(t, g1);
        }
        piece(t, L);
      }
      // Möbel bis Brusthöhe sind Hindernisse (Oberschränke, Leuchten, Treppen nicht)
      const boxes = f.items.filter((it) => !isStairs(it) && it.elevation < 100 && !it.passage && !['pendant', 'hood', 'gripV'].includes(getEntry(it.type).kind)).map((it) => itemCorners(it).map(m));
      const below = indoor.filter((x) => x.elevation < f.elevation).at(-1);
      const holes = f.kind === 'outdoor' || !below ? [] : below.items.filter(isStairs).map((it) => itemCorners(it).map(m));
      const outline = f.walls.length ? floorPolygon(floorView(house, f)).map(m) : [];
      const surfaces = [...(outline.length >= 3 ? [outline] : []), ...f.rooms.filter((r) => r.polygon && r.polygon.length >= 3).map((r) => r.polygon!.map(m))];
      const above = indoor.find((x) => x.elevation > f.elevation);
      const stairs = f.items.filter(isStairs).map((it) => {
        const storey = above ? above.elevation - f.elevation : it.height;
        const h = Math.abs(storey - it.height) < 120 ? storey - it.elevation : it.height;
        return { poly: itemCorners(it).map(m), x: it.x * M, y: it.y * M, rot: it.rotation, depth: it.depth * M, y0: (f.elevation + it.elevation) * M, h: h * M };
      });
      this.levels.push({ f, y: f.elevation * M, walls, boxes, surfaces, holes, stairs });
    }
  }

  /** Höhe der Treppenfläche an einem Punkt (steigt zur Rückseite, lokal −y) oder null */
  private stairHeight(s: Stair, p: Vec2) {
    if (!pointInPolygon(p, s.poly)) return null;
    const c = Math.cos(-s.rot);
    const sn = Math.sin(-s.rot);
    const ly = (p.x - s.x) * sn + (p.y - s.y) * c; // lokale Tiefe (+ = Vorderseite)
    const t = Math.max(0, Math.min(1, (s.depth / 2 - ly) / s.depth));
    return s.y0 + t * s.h;
  }

  /** Höchster begehbarer Boden unter den Füßen (höchstens eine Stufe darüber) */
  groundAt(x: number, z: number, feet: number) {
    const p = { x, y: z };
    let best = -Infinity;
    for (const l of this.levels) {
      if (l.y <= feet + STEP && l.surfaces.some((s) => pointInPolygon(p, s)) && !l.holes.some((h) => pointInPolygon(p, h))) best = Math.max(best, l.y);
      for (const s of l.stairs) {
        const h = this.stairHeight(s, p);
        if (h !== null && h <= feet + STEP) best = Math.max(best, h);
      }
    }
    return best === -Infinity ? 0 : best; // draußen: Gelände auf Höhe 0
  }

  /** Etage, auf der man gerade steht (höchste innen liegende Etage unter den Füßen) */
  level(feet = this.pos.feet) {
    const inner = this.levels.filter((l) => l.f.kind !== 'outdoor' && l.y <= feet + 0.3).sort((a, b) => b.y - a.y);
    return inner[0] ?? this.levels[0];
  }

  private collides(x: number, z: number) {
    const p = { x, y: z };
    const l = this.level();
    // auf der Treppe: Wände unter dem Treppenlauf (z. B. Abstellraum unter der Treppe) liegen unter den Füßen
    const onStair = this.pos.feet > l.y + STEP ? l.stairs.filter((s) => pointInPolygon(p, s.poly)) : [];
    for (const s of l.walls) {
      if (segDist(p, s.a, s.b) >= s.r + R) continue;
      if (onStair.length && onStair.some((st) => pointInPolygon(nearest(p, s.a, s.b), st.poly))) continue;
      return true;
    }
    for (const b of l.boxes) {
      if (pointInPolygon(p, b)) return true;
      for (let i = 0; i < b.length; i++) if (segDist(p, b[i], b[(i + 1) % b.length]) < R) return true;
    }
    return false;
  }

  /** Startpunkt: wenn möglich in einem Raum der Etage, sonst Mitte der Etage */
  place(f: Floor, near?: Vec2) {
    const l = this.levels.find((x) => x.f.id === f.id) ?? this.levels[0];
    let p = near && l.surfaces.some((s) => pointInPolygon(near, s)) ? near : null;
    if (!p) {
      const room = f.rooms.find((r) => r.polygon && r.polygon.length >= 3);
      const poly = room ? room.polygon!.map(m) : l.surfaces[0];
      p = poly ? { x: poly.reduce((a, q) => a + q.x, 0) / poly.length, y: poly.reduce((a, q) => a + q.y, 0) / poly.length } : { x: 0, y: 0 };
    }
    this.pos = { x: p.x, z: p.y, feet: l.y, vy: 0 };
    // aus Möbeln heraus schieben
    for (let r = 0.1; this.collides(this.pos.x, this.pos.z) && r < 3; r += 0.1) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        if (!this.collides(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r)) {
          this.pos.x = p.x + Math.cos(a) * r;
          this.pos.z = p.y + Math.sin(a) * r;
          r = 99;
          break;
        }
      }
    }
  }

  /** Ein Schritt: gewünschte Verschiebung in Metern, Gleiten an Wänden, Schwerkraft und Stufen */
  step(dx: number, dz: number, dt: number) {
    const p = this.pos;
    if (dx || dz) {
      if (!this.collides(p.x + dx, p.z + dz)) {
        p.x += dx;
        p.z += dz;
      } else if (!this.collides(p.x + dx, p.z)) p.x += dx;
      else if (!this.collides(p.x, p.z + dz)) p.z += dz;
    }
    const g = this.groundAt(p.x, p.z, p.feet);
    if (g >= p.feet) {
      p.feet = g; // Stufe/Treppe hinauf
      p.vy = 0;
    } else {
      p.vy -= 9.81 * dt;
      p.feet += p.vy * dt;
      if (p.feet <= g) {
        p.feet = g;
        p.vy = 0;
      }
    }
    return { x: p.x, y: p.feet + EYE, z: p.z };
  }

  /** Etage und Raum am aktuellen Ort (für die Anzeige) */
  where() {
    const l = this.level();
    const room = l.f.rooms.find((r) => r.polygon && pointInPolygon({ x: this.pos.x / M, y: this.pos.z / M }, r.polygon));
    return { floor: l.f, room: room?.name ?? null };
  }
}
