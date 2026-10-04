import { store, makeItem, uid } from './state';
import type { Item, Opening, OpeningType, Vec2, Wall } from './model/types.ts';
import { getEntry } from './model/catalog.ts';
import { islandColumnSpans } from './models';
import {
  add, bounds, dist, distToSegment, itemCorners, mul, openingCenter, pointInItem, projectOnWall, snapItem, sub, wallDir, wallLength, wallNormal,
} from './model/geom.ts';
import { pointInPolygon, polygonArea, roomPolygon } from './model/rooms.ts';
import { roomLabelPoint } from './model/house.ts';
import type { Room } from './model/types.ts';

const toast = (detail: string) => document.dispatchEvent(new CustomEvent('kp-toast', { detail }));

export type Tool = 'select' | 'wall' | 'door' | 'window' | 'calibrate' | 'place' | 'room';

type Drag =
  | { kind: 'pan'; start: Vec2; ox: number; oy: number }
  | { kind: 'item'; id: string; offset: Vec2; moved: boolean }
  | { kind: 'wallEnd'; points: { wall: Wall; end: 'a' | 'b' }[]; moved: boolean }
  | { kind: 'wall'; id: string; last: Vec2; moved: boolean }
  | { kind: 'opening'; id: string; moved: boolean }
  | { kind: 'underlay'; start: Vec2; ux: number; uy: number }
  | { kind: 'resize'; id: string; side: 1 | -1; anchor: Vec2; moved: boolean };

export class Plan2D {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  /** Pixel pro cm */
  private zoom = 1.2;
  private ox = 80;
  private oy = 80;
  tool: Tool = 'select';
  placeType: string | null = null;
  private ghost: Item | null = null;
  private drawing: Vec2[] = [];
  private cursor: Vec2 = { x: 0, y: 0 };
  private typed = '';
  private drag: Drag | null = null;
  private calib: Vec2[] = [];
  private underlayImg: HTMLImageElement | null = null;
  private underlaySrc = '';
  private spaceDown = false;
  moveUnderlay = false;
  /** Nur ansehen: Antippen wählt Möbel/Räume, Ziehen verschiebt die Ansicht, nichts lässt sich verändern */
  viewOnly = false;
  /** Füllstand je Möbel (0 leer, 1 teils, 2 voll; null = ohne Fächer) – färbt Möbel im Ansehen-Modus */
  fillOf?: (itemId: string) => 0 | 1 | 2 | null;
  /** Nordrichtung in Grad (Lage des Hauses) für den Nordpfeil */
  north?: () => number | null;
  /** hervorgehobene Möbel (Suchtreffer) */
  highlight = new Set<string>();
  /** Touch: aktive Finger und Zwei-Finger-Zoom */
  private touches = new Map<number, { x: number; y: number }>();
  private pinch: { d: number; zoom: number; mx: number; my: number; ox: number; oy: number } | null = null;
  private tap: { x: number; y: number; p: Vec2 } | null = null;
  onToolChange?: (t: Tool) => void;
  onCalibrated?: (pixels: number) => void;
  /** Klick mit dem Raum-Werkzeug in eine geschlossene Fläche ohne Raum */
  onRoomRequest?: (seed: Vec2) => void;

  constructor(private container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.tabIndex = 0;
    this.canvas.style.touchAction = 'none';
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    new ResizeObserver(() => this.resize()).observe(container);
    this.bind();
    store.subscribe(() => this.draw());
    this.resize();
    requestAnimationFrame(() => this.fit());
  }

  private resize() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = this.container.clientWidth * dpr;
    this.canvas.height = this.container.clientHeight * dpr;
    this.canvas.style.width = this.container.clientWidth + 'px';
    this.canvas.style.height = this.container.clientHeight + 'px';
    this.draw();
  }

  fit() {
    const b = bounds(store.project);
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    const bw = Math.max(200, b.maxX - b.minX);
    const bh = Math.max(200, b.maxY - b.minY);
    this.zoom = Math.min((w - 120) / bw, (h - 120) / bh);
    this.ox = w / 2 - ((b.minX + b.maxX) / 2) * this.zoom;
    this.oy = h / 2 - ((b.minY + b.maxY) / 2) * this.zoom;
    this.draw();
  }

  /** Ansicht auf einen Punkt zentrieren (z. B. Suchtreffer), Zoom mindestens so, dass ~5 m sichtbar sind */
  /** Punkt in die Mitte holen; visibleH: nur der obere Teil ist sichtbar (z. B. Blatt von unten auf dem Handy) */
  centerOn(p: Vec2, visibleH?: number) {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.zoom = Math.max(this.zoom, Math.min(w, h) / 500);
    this.ox = w / 2 - p.x * this.zoom;
    this.oy = Math.min(h, visibleH ?? h) / 2 - p.y * this.zoom;
    this.draw();
  }

  setTool(t: Tool, placeType: string | null = null, over: Partial<Item> = {}) {
    this.tool = t;
    this.placeType = placeType;
    this.drawing = [];
    this.calib = [];
    this.typed = '';
    this.ghost = t === 'place' && placeType ? makeItem(placeType, { ...over, x: this.cursor.x, y: this.cursor.y }) : null;
    this.canvas.style.cursor = t === 'select' ? 'default' : 'crosshair';
    this.onToolChange?.(t);
    this.draw();
  }

  private toWorld(e: MouseEvent): Vec2 {
    const r = this.canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left - this.ox) / this.zoom, y: (e.clientY - r.top - this.oy) / this.zoom };
  }

  private snapGrid(p: Vec2, step = 5): Vec2 {
    return { x: Math.round(p.x / step) * step, y: Math.round(p.y / step) * step };
  }

  /** Fang an Wandendpunkten, sonst Raster; beim Zeichnen zusätzlich Winkelfang */
  private snapPoint(p: Vec2, from?: Vec2, free = false): Vec2 {
    const tol = 12 / this.zoom;
    for (const w of store.project.walls) {
      for (const q of [w.a, w.b]) if (dist(p, q) < tol) return { ...q };
    }
    if (this.drawing.length > 2 && dist(p, this.drawing[0]) < tol) return { ...this.drawing[0] };
    if (from && !free) {
      const d = sub(p, from);
      const L = Math.round(Math.hypot(d.x, d.y));
      const ang = Math.atan2(d.y, d.x);
      const step = Math.PI / 4;
      const snapped = Math.round(ang / step) * step;
      if (Math.abs(snapped - ang) < 0.09) return { x: from.x + Math.cos(snapped) * L, y: from.y + Math.sin(snapped) * L };
    }
    return free ? p : this.snapGrid(p, 1);
  }

  // -------------------------------------------------------------------------

  private bind() {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      const f = Math.exp(-e.deltaY * 0.0015);
      const nz = Math.max(0.1, Math.min(20, this.zoom * f));
      this.ox = mx - ((mx - this.ox) / this.zoom) * nz;
      this.oy = my - ((my - this.oy) / this.zoom) * nz;
      this.zoom = nz;
      this.draw();
    }, { passive: false });

    c.addEventListener('pointerdown', (e) => this.down(e));
    c.addEventListener('pointermove', (e) => this.move(e));
    c.addEventListener('pointerup', (e) => this.up(e));
    c.addEventListener('pointercancel', (e) => {
      this.touches.delete(e.pointerId);
      this.pinch = null;
      this.tap = null;
      this.drag = null;
    });
    c.addEventListener('dblclick', () => {
      if (this.tool === 'wall') this.finishWall();
    });
    c.addEventListener('pointerenter', () => c.focus({ preventScroll: true }));
    window.addEventListener('keydown', (e) => this.key(e));
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.spaceDown = false;
    });
  }

  private down(e: PointerEvent) {
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.toWorld(e);
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size === 2) {
        // zweiter Finger: Zoomen statt Ziehen
        const [a, b] = [...this.touches.values()];
        const r = this.canvas.getBoundingClientRect();
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: this.zoom, mx: (a.x + b.x) / 2 - r.left, my: (a.y + b.y) / 2 - r.top, ox: this.ox, oy: this.oy };
        this.drag = null;
        this.tap = null;
        return;
      }
    }
    if (this.viewOnly) {
      // Auswahl erst beim Loslassen (wer zieht, will die Ansicht verschieben)
      this.tap = { x: e.clientX, y: e.clientY, p };
      this.drag = { kind: 'pan', start: { x: e.clientX, y: e.clientY }, ox: this.ox, oy: this.oy };
      return;
    }
    if (e.button === 1 || e.button === 2 || this.spaceDown) {
      if (this.tool === 'wall' && e.button === 2) {
        this.finishWall();
        return;
      }
      this.drag = { kind: 'pan', start: { x: e.clientX, y: e.clientY }, ox: this.ox, oy: this.oy };
      return;
    }
    const proj = store.project;

    switch (this.tool) {
      case 'wall': {
        const last = this.drawing[this.drawing.length - 1];
        const q = this.snapPoint(p, last, e.altKey);
        this.addWallPoint(q);
        return;
      }
      case 'door':
      case 'window': {
        const hit = this.hitWall(p);
        if (hit) {
          const o = this.makeOpening(this.tool, hit.wall, hit.t);
          proj.openings.push(o);
          store.select({ kind: 'opening', id: o.id });
          store.commit();
        }
        return;
      }
      case 'calibrate': {
        this.calib.push(p);
        if (this.calib.length === 2) {
          const d = dist(this.calib[0], this.calib[1]);
          this.onCalibrated?.(d);
          this.calib = [];
          this.setTool('select');
        }
        this.draw();
        return;
      }
      case 'room': {
        const hitRoom = this.roomAt(p, true);
        if (hitRoom) {
          if (hitRoom.locked) toast('Dieser Raum ist gesperrt.');
          store.select({ kind: 'room', id: hitRoom.id });
          this.setTool('select');
          return;
        }
        if (!roomPolygon(proj.walls, p)) {
          document.dispatchEvent(new CustomEvent('kp-toast', { detail: 'Hier ist kein geschlossener Bereich – Wände müssen den Raum vollständig umschließen.' }));
          return;
        }
        this.onRoomRequest?.(p);
        this.setTool('select');
        return;
      }
      case 'place': {
        if (this.ghost) {
          const it = { ...this.ghost, id: uid() };
          proj.items.push(it);
          store.select({ kind: 'item', id: it.id });
          store.commit();
          if (!e.shiftKey) this.setTool('select');
        }
        return;
      }
    }

    // Auswahl
    if (this.moveUnderlay && proj.underlay) {
      this.drag = { kind: 'underlay', start: p, ux: proj.underlay.x, uy: proj.underlay.y };
      return;
    }
    const tol = 8 / this.zoom;
    // Breiten-Ziehpunkte des ausgewählten Elements
    const rh = this.hitResizeHandle(p);
    if (rh) {
      const it = rh.item;
      const d = { x: Math.cos(it.rotation), y: Math.sin(it.rotation) };
      const anchor = { x: it.x - rh.side * d.x * (it.width / 2), y: it.y - rh.side * d.y * (it.width / 2) };
      this.drag = { kind: 'resize', id: it.id, side: rh.side, anchor, moved: false };
      return;
    }
    // Wandendpunkte der ausgewählten Wand zuerst
    const ends: { wall: Wall; end: 'a' | 'b' }[] = [];
    for (const w of proj.walls) {
      if (dist(p, w.a) < tol) ends.push({ wall: w, end: 'a' });
      if (dist(p, w.b) < tol) ends.push({ wall: w, end: 'b' });
    }
    // Ecke mit einer gesperrten Wand bleibt fest
    if (ends.length && !ends.some((x) => x.wall.locked)) {
      store.select({ kind: 'wall', id: ends[0].wall.id });
      this.drag = { kind: 'wallEnd', points: ends, moved: false };
      return;
    }
    for (const o of proj.openings) {
      const w = store.wall(o.wallId);
      if (!w || o.locked) continue;
      const c = openingCenter(w, o);
      const pr = projectOnWall(w, p);
      if (Math.abs(pr.t - o.offset) < o.width / 2 && pr.distance < w.thickness / 2 + tol && dist(p, c) < o.width) {
        store.select({ kind: 'opening', id: o.id });
        this.drag = { kind: 'opening', id: o.id, moved: false };
        return;
      }
    }
    // Elemente: obere zuerst (Oberschränke liegen über Unterschränken)
    const items = [...proj.items].sort((a, b) => b.elevation - a.elevation);
    const sel = store.selection;
    // Bereits ausgewähltes Element bevorzugen, damit überlappende Elemente greifbar bleiben
    const hitItems = items.filter((i) => !i.locked && pointInItem(i, p));
    let target = hitItems[0];
    if (sel?.kind === 'item' && hitItems.some((i) => i.id === sel.id) && hitItems.length > 1 && !e.altKey) {
      target = hitItems.find((i) => i.id === sel.id)!;
    } else if (e.altKey && hitItems.length > 1 && sel?.kind === 'item') {
      const idx = hitItems.findIndex((i) => i.id === sel.id);
      target = hitItems[(idx + 1) % hitItems.length];
    }
    if (target) {
      store.select({ kind: 'item', id: target.id });
      this.drag = { kind: 'item', id: target.id, offset: sub(p, { x: target.x, y: target.y }), moved: false };
      return;
    }
    const wh = this.hitWall(p);
    if (wh) {
      store.select({ kind: 'wall', id: wh.wall.id });
      // an gesperrten Wänden hängende Wand nicht verschieben (die Ecken blieben sonst nicht verbunden)
      const w = wh.wall;
      const pinned = proj.walls.some((o) => o !== w && o.locked && [o.a, o.b].some((q) => dist(q, w.a) < 0.5 || dist(q, w.b) < 0.5));
      this.drag = pinned ? { kind: 'pan', start: { x: e.clientX, y: e.clientY }, ox: this.ox, oy: this.oy } : { kind: 'wall', id: w.id, last: p, moved: false };
      return;
    }
    // Klick in einen Raum wählt ihn aus (Ziehen verschiebt weiterhin die Ansicht)
    const room = this.roomAt(p);
    store.select(room ? { kind: 'room', id: room.id } : null);
    this.drag = { kind: 'pan', start: { x: e.clientX, y: e.clientY }, ox: this.ox, oy: this.oy };
  }

  /** Ansehen: Möbel (auch gesperrte) oder Raum unter dem Finger auswählen */
  private pickView(p: Vec2) {
    const it = [...store.project.items].sort((a, b) => b.elevation - a.elevation).find((i) => pointInItem(i, p));
    if (it) return store.select({ kind: 'item', id: it.id });
    const room = this.roomAt(p, true);
    store.select(room ? { kind: 'room', id: room.id } : null);
  }

  private roomAt(p: Vec2, withLocked = false): Room | undefined {
    return store.floor.rooms.find((r) => (withLocked || !r.locked) && r.polygon && r.polygon.length >= 3 && pointInPolygon(p, r.polygon));
  }

  /** Etage direkt darunter (als Durchpause beim Zeichnen) */
  private floorBelow() {
    const cur = store.floor;
    return store.house.floors.filter((f) => f.elevation < cur.elevation).sort((a, b) => b.elevation - a.elevation)[0];
  }

  private move(e: PointerEvent) {
    if (this.touches.has(e.pointerId)) this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinch && this.touches.size >= 2) {
      const [a, b] = [...this.touches.values()];
      const r = this.canvas.getBoundingClientRect();
      const pc = this.pinch;
      const nz = Math.max(0.1, Math.min(20, (pc.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / pc.d));
      const mx = (a.x + b.x) / 2 - r.left;
      const my = (a.y + b.y) / 2 - r.top;
      this.zoom = nz;
      this.ox = mx - ((pc.mx - pc.ox) / pc.zoom) * nz;
      this.oy = my - ((pc.my - pc.oy) / pc.zoom) * nz;
      this.draw();
      return;
    }
    const p = this.toWorld(e);
    this.cursor = p;
    if (this.tap && Math.hypot(e.clientX - this.tap.x, e.clientY - this.tap.y) > 6) this.tap = null;
    const d = this.drag;
    if (d?.kind === 'pan') {
      this.ox = d.ox + e.clientX - d.start.x;
      this.oy = d.oy + e.clientY - d.start.y;
      this.draw();
      return;
    }
    if (d?.kind === 'underlay') {
      const u = store.project.underlay!;
      u.x = d.ux + p.x - d.start.x;
      u.y = d.uy + p.y - d.start.y;
      this.draw();
      return;
    }
    if (d?.kind === 'resize') {
      const it = store.item(d.id);
      if (!it) return;
      const dir = { x: Math.cos(it.rotation), y: Math.sin(it.rotation) };
      // Abstand der gezogenen Kante zur festen Gegenkante entlang der Elementachse
      let w = ((p.x - d.anchor.x) * dir.x + (p.y - d.anchor.y) * dir.y) * d.side;
      if (!e.altKey) w = this.snapEdge(it, d.anchor, dir, d.side, w);
      w = Math.max(10, Math.round(w * 10) / 10);
      it.width = w;
      it.x = d.anchor.x + dir.x * d.side * (w / 2);
      it.y = d.anchor.y + dir.y * d.side * (w / 2);
      d.moved = true;
      store.emit();
      return;
    }
    if (d?.kind === 'item') {
      const it = store.item(d.id);
      if (!it) return;
      const raw = this.snapGrid(sub(p, d.offset), 1);
      snapItem(store.project, it, raw, !e.altKey);
      d.moved = true;
      store.emit();
      return;
    }
    if (d?.kind === 'wallEnd') {
      const q = this.snapPointExcluding(p, d.points.map((x) => x.wall), e.altKey);
      for (const pt of d.points) pt.wall[pt.end] = { ...q };
      this.moveOpeningsWithin(d.points.map((x) => x.wall));
      d.moved = true;
      store.emit();
      return;
    }
    if (d?.kind === 'wall') {
      const w = store.wall(d.id);
      if (!w) return;
      const delta = this.snapGrid(sub(p, d.last), 1);
      if (delta.x === 0 && delta.y === 0) return;
      // verbundene Wände mitziehen
      const oldA = { ...w.a };
      const oldB = { ...w.b };
      for (const o of store.project.walls) {
        if (o === w) continue;
        for (const end of ['a', 'b'] as const) {
          if (dist(o[end], oldA) < 0.5 || dist(o[end], oldB) < 0.5) o[end] = add(o[end], delta);
        }
      }
      w.a = add(w.a, delta);
      w.b = add(w.b, delta);
      d.last = add(d.last, delta);
      d.moved = true;
      store.emit();
      return;
    }
    if (d?.kind === 'opening') {
      const o = store.opening(d.id);
      const w = o && store.wall(o.wallId);
      if (!o || !w) return;
      const pr = projectOnWall(w, p);
      o.offset = Math.round(Math.max(o.width / 2, Math.min(pr.L - o.width / 2, pr.t)));
      d.moved = true;
      store.emit();
      return;
    }
    if (this.tool === 'place' && this.ghost) {
      snapItem(store.project, this.ghost, this.snapGrid(p, 1), !e.altKey);
    }
    if (this.tool === 'wall' || this.tool === 'door' || this.tool === 'window' || this.tool === 'place' || this.tool === 'calibrate' || this.tool === 'room') this.draw();
    else this.updateHoverCursor(p);
  }

  /** Positionen der beiden Breiten-Ziehpunkte (Mitte der linken/rechten Kante) */
  private resizeHandles(it: Item): { side: 1 | -1; p: Vec2 }[] {
    const d = { x: Math.cos(it.rotation), y: Math.sin(it.rotation) };
    return ([-1, 1] as const).map((side) => ({ side, p: { x: it.x + d.x * side * (it.width / 2), y: it.y + d.y * side * (it.width / 2) } }));
  }

  private hitResizeHandle(p: Vec2) {
    const sel = store.selection;
    if (sel?.kind !== 'item') return null;
    const it = store.item(sel.id);
    if (!it) return null;
    const tol = 9 / this.zoom;
    const h = this.resizeHandles(it).find((h) => dist(h.p, p) < tol);
    return h ? { item: it, side: h.side } : null;
  }

  /**
   * Fängt die gezogene Kante an Kanten benachbarter Elemente derselben Ausrichtung,
   * sonst ganze Zentimeter.
   */
  private snapEdge(it: Item, anchor: Vec2, dir: Vec2, side: 1 | -1, w: number) {
    const tol = 8 / this.zoom;
    const edge = (anchor.x * dir.x + anchor.y * dir.y) + side * w;
    let best = w;
    let bestD = tol;
    for (const o of store.project.items) {
      if (o.id === it.id || Math.abs(Math.sin(o.rotation - it.rotation)) > 0.01) continue;
      // nur Elemente in derselben Reihe
      const across = -(o.x - it.x) * dir.y + (o.y - it.y) * dir.x;
      if (Math.abs(across) > (o.depth + it.depth) / 2) continue;
      const oc = o.x * dir.x + o.y * dir.y;
      for (const oe of [oc - o.width / 2, oc + o.width / 2]) {
        const dd = Math.abs(oe - edge);
        if (dd < bestD) {
          bestD = dd;
          best = (oe - (anchor.x * dir.x + anchor.y * dir.y)) * side;
        }
      }
    }
    return best !== w ? best : Math.round(w);
  }

  private updateHoverCursor(p: Vec2) {
    if (this.viewOnly) {
      this.canvas.style.cursor = store.project.items.some((i) => pointInItem(i, p)) ? 'pointer' : 'grab';
      return;
    }
    const tol = 8 / this.zoom;
    const proj = store.project;
    let cur = 'default';
    const rh = this.hitResizeHandle(p);
    if (rh) cur = Math.abs(Math.cos(rh.item.rotation)) > 0.7 ? 'ew-resize' : 'ns-resize';
    else if (proj.walls.some((w) => !w.locked && (dist(p, w.a) < tol || dist(p, w.b) < tol))) cur = 'move';
    else if (proj.items.some((i) => !i.locked && pointInItem(i, p))) cur = 'grab';
    else if (this.hitWall(p)) cur = 'pointer';
    this.canvas.style.cursor = this.moveUnderlay ? 'move' : cur;
  }

  private up(e: PointerEvent) {
    this.touches.delete(e.pointerId);
    if (this.touches.size < 2) this.pinch = null;
    if (this.tap && this.viewOnly) this.pickView(this.tap.p);
    this.tap = null;
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.kind === 'underlay') store.commit();
    if ('moved' in d && d.moved) store.commit();
  }

  private snapPointExcluding(p: Vec2, exclude: Wall[], free: boolean): Vec2 {
    const tol = 12 / this.zoom;
    for (const w of store.project.walls) {
      if (exclude.includes(w)) continue;
      for (const q of [w.a, w.b]) if (dist(p, q) < tol) return { ...q };
    }
    if (free) return p;
    // orthogonal zur Gegenseite ausrichten
    const w = exclude[0];
    if (w) {
      const other = dist(w.a, p) < dist(w.b, p) ? w.b : w.a;
      if (Math.abs(p.x - other.x) < tol) return { x: other.x, y: Math.round(p.y) };
      if (Math.abs(p.y - other.y) < tol) return { x: Math.round(p.x), y: other.y };
    }
    return this.snapGrid(p, 1);
  }

  private moveOpeningsWithin(walls: Wall[]) {
    for (const o of store.project.openings) {
      const w = walls.find((x) => x.id === o.wallId);
      if (!w) continue;
      const L = wallLength(w);
      o.offset = Math.max(o.width / 2, Math.min(L - o.width / 2, o.offset));
    }
  }

  private key(e: KeyboardEvent) {
    if (this.viewOnly) return;
    const target = e.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
    if (!this.container.offsetParent) return; // 2D-Ansicht verborgen
    if (e.code === 'Space') {
      this.spaceDown = true;
      return;
    }
    if (this.tool === 'wall' && this.drawing.length) {
      if (/^[0-9.,]$/.test(e.key)) {
        this.typed += e.key.replace(',', '.');
        this.draw();
        e.preventDefault();
        return;
      }
      if (e.key === 'Backspace' && this.typed) {
        this.typed = this.typed.slice(0, -1);
        this.draw();
        e.preventDefault();
        return;
      }
      if (e.key === 'Enter') {
        const L = parseFloat(this.typed);
        if (L > 0) {
          const last = this.drawing[this.drawing.length - 1];
          const target = this.snapPoint(this.cursor, last);
          const dir = sub(target, last);
          const l = Math.hypot(dir.x, dir.y) || 1;
          this.addWallPoint({ x: last.x + (dir.x / l) * L, y: last.y + (dir.y / l) * L });
          this.typed = '';
        } else this.finishWall();
        e.preventDefault();
        return;
      }
    }
    if (e.key === 'Escape') {
      if (this.tool === 'wall' && this.drawing.length) this.finishWall();
      else this.setTool('select');
      return;
    }
    const sel = store.selection;
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel) {
      store.deleteSelection();
      e.preventDefault();
      return;
    }
    if ((e.key === 'l' || e.key === 'L') && sel && this.tool === 'select') {
      store.setLocked(sel, true);
      toast('Gesperrt – entsperren in der Etagen-Liste „Gesperrt“.');
      return;
    }
    if (e.key === 'r' || e.key === 'R') {
      const target = this.tool === 'place' ? this.ghost : sel?.kind === 'item' ? store.item(sel.id) : null;
      if (target) {
        target.rotation += (Math.PI / 2) * (e.shiftKey ? -1 : 1);
        delete target.wallId;
        if (this.tool === 'place') this.draw();
        else store.commit();
      }
    }
  }

  private addWallPoint(q: Vec2) {
    const last = this.drawing[this.drawing.length - 1];
    if (last && dist(last, q) < 1) return;
    if (last) {
      store.project.walls.push({ id: uid(), a: { ...last }, b: { ...q }, thickness: 12, height: this.defaultWallHeight() });
      store.commit();
      if (this.drawing.length > 1 && dist(q, this.drawing[0]) < 0.5) {
        this.drawing = [];
        this.draw();
        return;
      }
    }
    this.drawing.push(q);
    this.draw();
  }

  private defaultWallHeight() {
    const ws = store.project.walls;
    return ws.length ? ws[ws.length - 1].height : 260;
  }

  private finishWall() {
    this.drawing = [];
    this.typed = '';
    this.draw();
  }

  private hitWall(p: Vec2) {
    let best: { wall: Wall; t: number; d: number } | null = null;
    for (const w of store.project.walls) {
      if (w.locked) continue;
      const d = distToSegment(p, w.a, w.b);
      if (d < w.thickness / 2 + 6 / this.zoom && (!best || d < best.d)) best = { wall: w, t: projectOnWall(w, p).tc, d };
    }
    return best;
  }

  private makeOpening(type: OpeningType, w: Wall, t: number): Opening {
    const width = type === 'door' ? 90 : 120;
    const L = wallLength(w);
    return {
      id: uid(),
      wallId: w.id,
      type,
      offset: Math.round(Math.max(width / 2, Math.min(L - width / 2, t))),
      width,
      height: type === 'door' ? 210 : 130,
      sill: type === 'door' ? 0 : 95,
    };
  }

  // -------------------------------------------------------------------------
  // Zeichnen

  private ensureUnderlay() {
    const u = store.project.underlay;
    if (!u) {
      this.underlayImg = null;
      this.underlaySrc = '';
      return;
    }
    if (u.image !== this.underlaySrc) {
      this.underlaySrc = u.image;
      const img = new Image();
      img.onload = () => this.draw();
      img.src = u.image;
      this.underlayImg = img;
    }
  }

  draw() {
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const W = this.canvas.width / dpr;
    const H = this.canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.documentElement);
    const col = (n: string) => css.getPropertyValue(n).trim();
    ctx.fillStyle = col('--plan-bg');
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(this.ox, this.oy);
    ctx.scale(this.zoom, this.zoom);
    const z = this.zoom;
    const px = 1 / z;

    // Grundriss-Vorlage
    this.ensureUnderlay();
    const u = store.project.underlay;
    if (u && u.visible && this.underlayImg?.complete) {
      ctx.globalAlpha = u.opacity;
      ctx.drawImage(this.underlayImg, u.x, u.y, this.underlayImg.width * u.scale, this.underlayImg.height * u.scale);
      ctx.globalAlpha = 1;
    }

    // Raster
    const x0 = -this.ox / z;
    const y0 = -this.oy / z;
    const x1 = x0 + W / z;
    const y1 = y0 + H / z;
    const gridLevels: [number, string][] = [
      [10, col('--grid-minor')],
      [100, col('--grid-major')],
    ];
    for (const [step, c] of gridLevels) {
      if (step * z < 6) continue;
      ctx.strokeStyle = c;
      ctx.lineWidth = px;
      ctx.beginPath();
      for (let x = Math.floor(x0 / step) * step; x < x1; x += step) {
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y1);
      }
      for (let y = Math.floor(y0 / step) * step; y < y1; y += step) {
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
      }
      ctx.stroke();
    }

    const proj = store.project;
    const sel = store.selection;

    // Etage darunter als Durchpause
    const below = this.floorBelow();
    if (below?.walls.length) {
      ctx.strokeStyle = col('--ink-soft');
      ctx.globalAlpha = 0.35;
      ctx.setLineDash([6 * px, 4 * px]);
      for (const w of below.walls) {
        ctx.lineWidth = Math.max(px, w.thickness * 0.35);
        ctx.beginPath();
        ctx.moveTo(w.a.x, w.a.y);
        ctx.lineTo(w.b.x, w.b.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // Räume
    const rooms = store.floor.rooms;
    rooms.forEach((r, i) => {
      if (!r.polygon || r.polygon.length < 3) return;
      const selected = sel?.kind === 'room' && sel.id === r.id;
      ctx.beginPath();
      r.polygon.forEach((q, k) => (k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.closePath();
      ctx.fillStyle = `hsla(${(i * 67 + 200) % 360}, 55%, 60%, ${selected ? 0.28 : 0.12})`;
      ctx.fill();
      if (selected) {
        ctx.strokeStyle = col('--accent');
        ctx.lineWidth = 2 * px;
        ctx.setLineDash([6 * px, 4 * px]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    });
    // Vorschau beim Raum-Werkzeug
    if (this.tool === 'room') {
      const poly = !this.roomAt(this.cursor) && roomPolygon(proj.walls, this.cursor);
      if (poly) {
        ctx.beginPath();
        poly.forEach((q, k) => (k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
        ctx.closePath();
        ctx.fillStyle = col('--accent');
        ctx.globalAlpha = 0.18;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // Wände
    for (const w of proj.walls) {
      const d = wallDir(w);
      const n = wallNormal(w);
      const t = w.thickness / 2;
      const ext = (pt: Vec2) => (proj.walls.some((o) => o !== w && (dist(o.a, pt) < 1 || dist(o.b, pt) < 1)) ? t : 0);
      const a = sub(w.a, mul(d, ext(w.a)));
      const b = add(w.b, mul(d, ext(w.b)));
      ctx.beginPath();
      ctx.moveTo(a.x + n.x * t, a.y + n.y * t);
      ctx.lineTo(b.x + n.x * t, b.y + n.y * t);
      ctx.lineTo(b.x - n.x * t, b.y - n.y * t);
      ctx.lineTo(a.x - n.x * t, a.y - n.y * t);
      ctx.closePath();
      const selected = sel?.kind === 'wall' && sel.id === w.id;
      ctx.fillStyle = selected ? col('--accent') : col('--wall');
      ctx.fill();
    }
    // Öffnungen
    for (const o of proj.openings) {
      const w = store.wall(o.wallId);
      if (!w) continue;
      const d = wallDir(w);
      const n = wallNormal(w);
      const t = w.thickness / 2 + 0.5;
      const c = openingCenter(w, o);
      const a = sub(c, mul(d, o.width / 2));
      const b = add(c, mul(d, o.width / 2));
      ctx.beginPath();
      ctx.moveTo(a.x + n.x * t, a.y + n.y * t);
      ctx.lineTo(b.x + n.x * t, b.y + n.y * t);
      ctx.lineTo(b.x - n.x * t, b.y - n.y * t);
      ctx.lineTo(a.x - n.x * t, a.y - n.y * t);
      ctx.closePath();
      ctx.fillStyle = col('--plan-bg');
      ctx.fill();
      const selected = sel?.kind === 'opening' && sel.id === o.id;
      ctx.strokeStyle = selected ? col('--accent') : col('--ink');
      ctx.lineWidth = (selected ? 2.5 : 1.2) * px;
      ctx.stroke();
      if (o.type === 'window') {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      } else if (o.type === 'passage') {
        // Durchgang: nur die Öffnung, kein Aufschlag
      } else {
        // Türaufschlag
        const r = o.width;
        const hinge = add(a, mul(n, t));
        const start = Math.atan2(d.y, d.x);
        const sweep = Math.atan2(n.y, n.x);
        ctx.beginPath();
        ctx.moveTo(hinge.x, hinge.y);
        ctx.lineTo(hinge.x + n.x * r, hinge.y + n.y * r);
        ctx.stroke();
        ctx.setLineDash([4 * px, 4 * px]);
        ctx.beginPath();
        const ccw = ((sweep - start + Math.PI * 3) % (Math.PI * 2)) - Math.PI < 0;
        ctx.arc(hinge.x, hinge.y, r, start, sweep, ccw);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Elemente (untere zuerst)
    const items = [...proj.items].sort((a, b) => a.elevation - b.elevation);
    for (const it of items) this.drawItem(it, sel?.kind === 'item' && sel.id === it.id, col, px);
    if (this.ghost && this.tool === 'place') {
      ctx.globalAlpha = 0.6;
      this.drawItem(this.ghost, true, col, px);
      ctx.globalAlpha = 1;
    }
    // Schloss an gesperrten Objekten (nur beim Planen)
    if (!this.viewOnly) {
      for (const w of proj.walls) if (w.locked) this.drawLock(add(mul(w.a, 0.7), mul(w.b, 0.3)), col, px); // neben dem Maß in der Mitte
      for (const o of proj.openings) {
        const w = o.locked && store.wall(o.wallId);
        if (w) this.drawLock(openingCenter(w, o), col, px);
      }
      for (const it of proj.items) if (it.locked) this.drawLock({ x: it.x, y: it.y }, col, px);
    }

    // Raumnamen mit Lager-Kürzel und Fläche
    for (const r of rooms) {
      if (!r.polygon || r.polygon.length < 3) continue;
      const lp = roomLabelPoint(r);
      const area = Math.abs(polygonArea(r.polygon)) / 10000;
      ctx.save();
      ctx.translate(lp.x, lp.y);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `600 ${13 * px}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = col('--ink');
      ctx.fillText(r.locked && !this.viewOnly ? `${r.name} (gesperrt)` : r.name, 0, -8 * px);
      ctx.font = `${10.5 * px}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = col('--ink-soft');
      ctx.fillText(this.viewOnly ? r.code : `Lager ${r.code} · ${area.toFixed(1).replace('.', ',')} m²`, 0, 8 * px);
      ctx.restore();
    }

    // Wandmaße (nur beim Planen)
    ctx.font = `${11 * px}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const w of this.viewOnly ? [] : proj.walls) {
      const L = wallLength(w);
      if (L * z < 40) continue;
      const m = mul(add(w.a, w.b), 0.5);
      const n = wallNormal(w);
      const off = w.thickness / 2 + 14 * px;
      // Maß auf der Außenseite (vom Raummittelpunkt weg)
      const poly = proj.walls.flatMap((x) => [x.a, x.b]);
      const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
      const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
      const sgn = (m.x - cx) * n.x + (m.y - cy) * n.y >= 0 ? 1 : -1;
      const pos = add(m, mul(n, off * sgn));
      this.label(`${Math.round(L)} cm`, pos, Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x), col, px);
    }

    // Breiten-Ziehpunkte am ausgewählten Element
    if (sel?.kind === 'item' && this.tool === 'select' && !this.viewOnly) {
      const it = store.item(sel.id);
      if (it) {
        for (const h of this.resizeHandles(it)) {
          ctx.save();
          ctx.translate(h.p.x, h.p.y);
          ctx.rotate(it.rotation);
          ctx.fillStyle = '#fff';
          ctx.strokeStyle = col('--accent');
          ctx.lineWidth = 2 * px;
          ctx.beginPath();
          ctx.roundRect(-4 * px, -9 * px, 8 * px, 18 * px, 3 * px);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
        if (this.drag?.kind === 'resize') {
          const d = { x: Math.cos(it.rotation), y: Math.sin(it.rotation) };
          const n = { x: -d.y, y: d.x };
          const off = it.depth / 2 + 16 * px;
          this.label(`${Math.round(it.width * 10) / 10} cm`, { x: it.x + n.x * off, y: it.y + n.y * off }, it.rotation, col, px, true);
        }
      }
    }

    // Endpunkte der ausgewählten Wand
    if (sel?.kind === 'wall') {
      const w = store.wall(sel.id);
      if (w) for (const p of [w.a, w.b]) this.handle(p, col('--accent'), px);
    }

    // Wand-Zeichenwerkzeug
    if (this.tool === 'wall') {
      const last = this.drawing[this.drawing.length - 1];
      const q = this.snapPoint(this.cursor, last);
      if (last) {
        ctx.strokeStyle = col('--accent');
        ctx.lineWidth = 12;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        let end = q;
        const L = parseFloat(this.typed);
        if (L > 0) {
          const dd = sub(q, last);
          const l = Math.hypot(dd.x, dd.y) || 1;
          end = { x: last.x + (dd.x / l) * L, y: last.y + (dd.y / l) * L };
        }
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
        ctx.globalAlpha = 1;
        const len = this.typed ? `${this.typed}▌ cm` : `${Math.round(dist(last, end))} cm`;
        this.label(len, add(mul(add(last, end), 0.5), { x: 0, y: -18 * px }), 0, col, px, true);
      }
      this.handle(q, col('--accent'), px);
    }

    if (this.tool === 'door' || this.tool === 'window') {
      const hit = this.hitWall(this.cursor);
      if (hit) {
        const c = add(hit.wall.a, mul(wallDir(hit.wall), hit.t));
        this.handle(c, col('--accent'), px);
      }
    }

    if (this.tool === 'calibrate') {
      for (const p of this.calib) this.handle(p, '#e5484d', px);
      if (this.calib.length === 1) {
        ctx.strokeStyle = '#e5484d';
        ctx.lineWidth = 2 * px;
        ctx.beginPath();
        ctx.moveTo(this.calib[0].x, this.calib[0].y);
        ctx.lineTo(this.cursor.x, this.cursor.y);
        ctx.stroke();
      }
    }

    ctx.restore();

    // Maßstabsleiste
    const barCm = [10, 20, 50, 100, 200, 500].find((v) => v * z > 70) ?? 500;
    ctx.fillStyle = col('--ink');
    ctx.fillRect(16, H - 22, barCm * z, 3);
    ctx.font = '11px Inter, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(barCm >= 100 ? `${barCm / 100} m` : `${barCm} cm`, 16, H - 30);

    // Nordpfeil (wenn die Lage des Hauses gesetzt ist)
    const north = this.north?.();
    if (north !== null && north !== undefined) {
      const W = this.container.clientWidth;
      ctx.save();
      ctx.translate(W - 44, H - 50);
      ctx.fillStyle = col('--panel');
      ctx.strokeStyle = col('--line');
      ctx.beginPath();
      ctx.arc(0, 0, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      const rad = (north * Math.PI) / 180;
      ctx.fillStyle = col('--ink');
      ctx.font = '700 10px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('N', Math.sin(rad) * 28, -Math.cos(rad) * 28);
      ctx.rotate(rad);
      ctx.fillStyle = col('--accent');
      ctx.beginPath();
      ctx.moveTo(0, -15);
      ctx.lineTo(6, 3);
      ctx.lineTo(0, -1);
      ctx.lineTo(-6, 3);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  private handle(p: Vec2, color: string, px: number) {
    const ctx = this.ctx;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 * px;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5 * px, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  private label(text: string, p: Vec2, angle: number, col: (n: string) => string, px: number, accent = false) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(p.x, p.y);
    let a = angle;
    if (a > Math.PI / 2) a -= Math.PI;
    if (a < -Math.PI / 2) a += Math.PI;
    ctx.rotate(a);
    ctx.font = `${11 * px}px Inter, system-ui, sans-serif`;
    const w = ctx.measureText(text).width + 8 * px;
    ctx.fillStyle = accent ? col('--accent') : col('--panel');
    ctx.fillRect(-w / 2, -8 * px, w, 16 * px);
    ctx.fillStyle = accent ? '#fff' : col('--ink');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  /** Kleines Vorhängeschloss (Bildschirmgröße fest) */
  private drawLock(c: Vec2, col: (n: string) => string, px: number) {
    const ctx = this.ctx;
    const u = 5 * px;
    ctx.save();
    ctx.fillStyle = col('--plan-bg');
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(c.x, c.y, u * 1.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = col('--ink');
    ctx.fillStyle = col('--ink');
    ctx.lineWidth = 1.4 * px;
    ctx.beginPath();
    ctx.arc(c.x, c.y - u * 0.35, u * 0.6, Math.PI, 0);
    ctx.stroke();
    ctx.fillRect(c.x - u * 0.9, c.y - u * 0.35, u * 1.8, u * 1.3);
    ctx.restore();
  }

  private drawItem(it: Item, selected: boolean, col: (n: string) => string, px: number) {
    const ctx = this.ctx;
    const e = getEntry(it.type);
    const pts = itemCorners(it);
    const upper = e.kind === 'wall' || e.kind === 'hood' || e.kind === 'shelf' || e.kind === 'pendant';
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    if (e.kind === 'pendant' || e.kind === 'stool') {
      ctx.beginPath();
      ctx.arc(it.x, it.y, it.width / 2, 0, Math.PI * 2);
    }
    const lv = this.viewOnly ? this.fillOf?.(it.id) ?? null : null;
    if (lv !== null) {
      ctx.globalAlpha = upper ? 0.55 : 1;
      ctx.fillStyle = col(`--lv${lv}`);
    } else ctx.fillStyle = upper ? 'transparent' : selected ? col('--item-sel') : col('--item');
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = selected ? col('--accent') : col('--ink');
    ctx.lineWidth = (selected ? 2.2 : 1) * px;
    if (this.highlight.has(it.id)) {
      ctx.save();
      ctx.strokeStyle = col('--hl');
      ctx.lineWidth = 5 * px;
      ctx.stroke();
      ctx.restore();
    }
    if (upper) ctx.setLineDash([5 * px, 4 * px]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Symbole im lokalen System
    ctx.save();
    ctx.translate(it.x, it.y);
    ctx.rotate(it.rotation);
    const W = it.width;
    const D = it.depth;
    ctx.strokeStyle = col('--ink-soft');
    ctx.lineWidth = px;
    if (e.kind === 'sink') {
      const sw = Math.min(W - 16, 56);
      ctx.beginPath();
      ctx.roundRect(-sw / 2, -21, sw, 42, 4);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (e.kind === 'hob' || e.kind === 'island') {
      const cz = e.kind === 'island' ? D / 2 - 30 : 0;
      const hw = Math.min(W - 4, 78) / 2;
      for (const [x, y, r] of [[-hw / 2, -10, 9], [-hw / 2, 12, 7], [hw / 2, -10, 7], [hw / 2, 12, 9]])
        if (e.kind !== 'island' || W > 100) {
          ctx.beginPath();
          ctx.arc(x, y + cz, r, 0, Math.PI * 2);
          ctx.stroke();
        }
    }
    if (e.kind === 'oven' || e.kind === 'tallOven' || e.kind === 'dishwasher' || e.kind === 'tallFridge' || e.kind === 'fridgeFree') {
      ctx.beginPath();
      ctx.moveTo(-W / 2, -D / 2);
      ctx.lineTo(W / 2, D / 2);
      ctx.moveTo(W / 2, -D / 2);
      ctx.lineTo(-W / 2, D / 2);
      ctx.stroke();
    }
    // Spaltenteilung der Kochinsel (kurze Striche an Vorder- und ggf. Rückseite)
    if (e.kind === 'island') {
      const spans = islandColumnSpans(it);
      ctx.strokeStyle = col('--ink-soft');
      ctx.lineWidth = px;
      ctx.beginPath();
      for (let i = 1; i < spans.length; i++) {
        const x = spans[i][0] * 100;
        ctx.moveTo(x, D / 2);
        ctx.lineTo(x, D / 2 - 12);
        if (it.islandBack === 'doors') {
          ctx.moveTo(x, -D / 2);
          ctx.lineTo(x, -D / 2 + 12);
        }
      }
      ctx.stroke();
    }
    // Frontseite markieren
    if (e.snapToWall || e.kind === 'island') {
      ctx.strokeStyle = selected ? col('--accent') : col('--ink');
      ctx.lineWidth = 2.5 * px;
      ctx.beginPath();
      ctx.moveTo(-W / 2, D / 2);
      ctx.lineTo(W / 2, D / 2);
      ctx.stroke();
    }
    // Lager-Spalte des Möbels (z. B. „B“ → Plätze KU-B0, KU-B1 …)
    if (it.storageCol && W * this.zoom > 18) {
      const r = Math.min(9 * px, W / 3, D / 3);
      const cy = upper ? D / 4 : -D / 4;
      ctx.fillStyle = col('--accent');
      ctx.beginPath();
      ctx.arc(0, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.translate(0, cy);
      if (Math.cos(it.rotation) < -0.1) ctx.rotate(Math.PI);
      ctx.fillStyle = '#fff';
      ctx.font = `600 ${Math.min(10 * px, r * 1.3)}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(it.storageCol, 0, 0.5 * px);
      ctx.restore();
    }
    // Modelle aus der Bibliothek: Name statt Breite
    if (e.kind === 'model' && W * this.zoom > 30) {
      ctx.fillStyle = col('--ink-soft');
      ctx.font = `${10 * px}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (Math.cos(it.rotation) < -0.1) ctx.rotate(Math.PI);
      ctx.fillText((it.label || it.model?.name || '').slice(0, 24), 0, 0);
      ctx.restore();
      return;
    }
    // Beschriftung (Breite – nur beim Planen)
    if (!this.viewOnly && W * this.zoom > 34 && e.kind !== 'pendant' && e.kind !== 'stool') {
      ctx.fillStyle = col('--ink-soft');
      ctx.font = `${10 * px}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const flip = Math.cos(it.rotation) < -0.1;
      if (flip) ctx.rotate(Math.PI);
      ctx.fillText(`${Math.round(W)}`, 0, (upper ? -D / 4 : D / 4) * (flip ? -1 : 1));
    }
    ctx.restore();
  }
}
