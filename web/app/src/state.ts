// Zustand der App: das ganze Haus, die aktive Etage und die Auswahl. Editor, 3D-Szene und Modelle arbeiten über
// store.project mit der aktiven Etage (Wände, Möbel …) – Materialien und Einstellungen gelten fürs ganze Haus.
// Undo/Redo umfasst das Haus; jede abgeschlossene Änderung (commit) erkennt Räume neu und vergibt Lager-Spalten.

import type { Floor, House, Item, Opening, Project, Selection, Wall } from './model/types.ts';
import { getEntry } from './model/catalog.ts';
import { emptyHouse, floorView, makeFloor, migrateHouse, normalizeHouse, uid as makeId } from './model/house.ts';

const STORAGE_KEY = 'zuhause.house.v2';
const OLD_KEY = 'kuechenplaner.project.v1';

export const uid = makeId;

type Listener = () => void;

/** Beispiel: Küche mit Insel in einem Raum (wie im früheren Küchenplaner) */
function exampleFloor(): Floor {
  const W = 460;
  const D = 400;
  const t = 12;
  const h = 260;
  const w1: Wall = { id: uid(), a: { x: 0, y: 0 }, b: { x: W, y: 0 }, thickness: t, height: h };
  const w2: Wall = { id: uid(), a: { x: W, y: 0 }, b: { x: W, y: D }, thickness: t, height: h };
  const w3: Wall = { id: uid(), a: { x: W, y: D }, b: { x: 0, y: D }, thickness: t, height: h };
  const w4: Wall = { id: uid(), a: { x: 0, y: D }, b: { x: 0, y: 0 }, thickness: t, height: h };
  const openings: Opening[] = [
    { id: uid(), wallId: w1.id, type: 'window', offset: 226, width: 100, height: 115, sill: 110 },
    { id: uid(), wallId: w2.id, type: 'window', offset: 210, width: 140, height: 150, sill: 75 },
    { id: uid(), wallId: w3.id, type: 'door', offset: 360, width: 90, height: 210, sill: 0 },
  ];
  const row: [string, number][] = [['tall-fridge', 60], ['tall-oven', 60], ['base-drawers', 60], ['sink', 80], ['dishwasher', 60], ['hob', 80], ['base-mixed', 40]];
  const items: Item[] = [];
  let x = t / 2;
  for (const [type, width] of row) {
    items.push(makeItem(type, { x: x + width / 2, y: t / 2 + 30, width, wallId: w1.id }));
    x += width;
  }
  items.push(makeItem('hood', { x: 366, y: t / 2 + 25, wallId: w1.id }));
  items.push(makeItem('wall-doors', { x: 426, y: t / 2 + 17.5, width: 40, wallId: w1.id }));
  items.push(makeItem('island', { x: 230, y: 235, rotation: Math.PI }));
  items.push(makeItem('pendant', { x: 190, y: 235 }));
  items.push(makeItem('pendant', { x: 270, y: 235 }));
  for (const sx of [180, 230, 280]) items.push(makeItem('stool', { x: sx, y: 318 }));
  return makeFloor({ walls: [w1, w2, w3, w4], openings, items, rooms: [{ id: uid(), name: 'Küche', code: '', seed: { x: 60, y: 120 } }] });
}

export function makeItem(type: string, over: Partial<Item> = {}): Item {
  const e = getEntry(type);
  return {
    id: uid(),
    type,
    x: 0,
    y: 0,
    rotation: 0,
    width: e.width,
    depth: e.depth,
    height: e.height,
    elevation: e.elevation,
    front: e.front,
    ...(e.materials ? { materials: { ...e.materials } } : {}),
    ...over,
  };
}

class Store {
  house: House;
  floorId: string;
  selection: Selection = null;
  /** Nur ansehen (geteilter Showroom / ohne Bearbeitungsrecht): nichts im Browser speichern */
  readonly = false;
  /** Kürzel anderer Lager (vom Server), damit Räume nicht dasselbe Kürzel bekommen */
  reservedCodes = new Set<string>();
  /** zuletzt gespeicherter Stand (Spalten bleiben stabil, siehe normalizeHouse) */
  savedHouse: House | null = null;
  private listeners = new Set<Listener>();
  private selListeners = new Set<Listener>();
  private floorListeners = new Set<Listener>();
  private commitListeners = new Set<Listener>();
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private saveTimer = 0;
  private view: Project;

  constructor() {
    this.house = this.load() ?? (() => {
      const h = emptyHouse();
      h.floors = [exampleFloor()];
      return h;
    })();
    normalizeHouse(this.house);
    this.floorId = this.house.floors[0].id;
    this.view = floorView(
      () => this.house,
      () => this.floor,
    );
    this.undoStack.push(this.snapshot());
  }

  /** Aktive Etage */
  get floor(): Floor {
    return this.house.floors.find((f) => f.id === this.floorId) ?? this.house.floors[0];
  }

  /** Aktive Etage als Planung (Wände, Öffnungen, Möbel der Etage; Materialien/Einstellungen des Hauses) */
  get project(): Project {
    return this.view;
  }

  private snapshot() {
    return JSON.stringify(this.house);
  }

  private load(): House | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(OLD_KEY);
      if (!raw) return null;
      return migrateHouse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  onSelection(fn: Listener) {
    this.selListeners.add(fn);
    return () => this.selListeners.delete(fn);
  }
  /** Etagenwechsel oder neue Etagenliste */
  onFloor(fn: Listener) {
    this.floorListeners.add(fn);
    return () => this.floorListeners.delete(fn);
  }
  /** Abgeschlossene Änderung (für das Speichern auf dem Server) */
  onCommit(fn: Listener) {
    this.commitListeners.add(fn);
    return () => this.commitListeners.delete(fn);
  }

  /** Benachrichtigt Ansichten ohne Undo-Eintrag (z. B. während des Ziehens) */
  emit() {
    this.listeners.forEach((l) => l());
  }

  /** Räume erkennen, Kürzel und Spalten vergeben (wie auf dem Server) */
  normalize() {
    normalizeHouse(this.house, this.reservedCodes, this.savedHouse);
  }

  /** Schließt eine Aktion ab: Normalisieren + Undo-Schritt + Speichern + Benachrichtigen */
  commit() {
    this.normalize();
    const snap = this.snapshot();
    const changed = this.undoStack[this.undoStack.length - 1] !== snap;
    if (changed) {
      this.undoStack.push(snap);
      if (this.undoStack.length > 80) this.undoStack.shift();
      this.redoStack = [];
    }
    this.emit();
    this.scheduleSave();
    if (changed) this.commitListeners.forEach((l) => l());
  }

  private restore(snap: string) {
    this.house = JSON.parse(snap);
    if (!this.house.floors.some((f) => f.id === this.floorId)) this.floorId = this.house.floors[0].id;
    this.validateSelection();
    this.floorListeners.forEach((l) => l());
    this.emit();
    this.scheduleSave();
    this.commitListeners.forEach((l) => l());
  }

  undo() {
    if (this.undoStack.length < 2) return;
    this.redoStack.push(this.undoStack.pop()!);
    this.restore(this.undoStack[this.undoStack.length - 1]);
  }

  redo() {
    const snap = this.redoStack.pop();
    if (!snap) return;
    this.undoStack.push(snap);
    this.restore(snap);
  }

  /** Ganzes Haus ersetzen (Laden vom Server, Import). keepUndo = false: Verlauf beginnt neu */
  replace(raw: House | Project, { keepUndo = false, notify = true } = {}) {
    const keepFloor = this.floorId;
    this.house = migrateHouse(raw);
    this.normalize();
    this.floorId = this.house.floors.some((f) => f.id === keepFloor) ? keepFloor : this.house.floors[0].id;
    this.selection = null;
    if (!keepUndo) {
      this.undoStack = [this.snapshot()];
      this.redoStack = [];
    } else this.undoStack.push(this.snapshot());
    this.save();
    this.floorListeners.forEach((l) => l());
    this.selListeners.forEach((l) => l());
    this.emit();
    if (notify) this.commitListeners.forEach((l) => l());
  }

  /** Nur Werte übernehmen, die der Server beim Speichern festlegt (Kürzel, Umrisse, Spalten) – ohne Undo-Eintrag */
  applyServerNormalization(server: House) {
    const rooms = new Map(server.floors.flatMap((f) => f.rooms.map((r) => [r.id, r] as const)));
    const cols = new Map(server.floors.flatMap((f) => f.items.map((i) => [i.id, i.storageCol] as const)));
    const codes = new Map(server.floors.map((f) => [f.id, f.code]));
    let changed = false;
    for (const f of this.house.floors) {
      if (codes.has(f.id) && f.code !== codes.get(f.id)) {
        f.code = codes.get(f.id);
        changed = true;
      }
      for (const r of f.rooms) {
        const s = rooms.get(r.id);
        if (s && s.code !== r.code) {
          r.code = s.code;
          changed = true;
        }
      }
      for (const it of f.items) {
        if (cols.has(it.id) && cols.get(it.id) !== it.storageCol) {
          if (cols.get(it.id)) it.storageCol = cols.get(it.id);
          else delete it.storageCol;
          changed = true;
        }
      }
    }
    if (changed) {
      this.undoStack[this.undoStack.length - 1] = this.snapshot();
      this.save();
      this.emit();
    }
    return changed;
  }

  // --- Etagen ---

  setFloor(id: string) {
    if (id === this.floorId || !this.house.floors.some((f) => f.id === id)) return;
    this.floorId = id;
    this.selection = null;
    this.floorListeners.forEach((l) => l());
    this.selListeners.forEach((l) => l());
    this.emit();
  }

  addFloor(over: Partial<Floor> = {}) {
    const f = makeFloor(over);
    this.house.floors.push(f);
    this.sortFloors();
    this.floorId = f.id;
    this.selection = null;
    this.floorListeners.forEach((l) => l());
    this.commit();
    return f;
  }

  removeFloor(id: string) {
    if (this.house.floors.length < 2) return;
    this.house.floors = this.house.floors.filter((f) => f.id !== id);
    if (this.floorId === id) this.floorId = this.house.floors[0].id;
    this.selection = null;
    this.floorListeners.forEach((l) => l());
    this.commit();
  }

  sortFloors() {
    this.house.floors.sort((a, b) => a.elevation - b.elevation);
  }

  /** Etagen-Eigenschaften geändert (Name, Höhe …) */
  floorChanged() {
    this.sortFloors();
    this.floorListeners.forEach((l) => l());
    this.commit();
  }

  reset(empty = false) {
    const h = emptyHouse();
    if (!empty) h.floors = [exampleFloor()];
    this.replace(h);
  }

  /** Gesperrte Objekte lassen sich nicht auswählen (Entsperren geht über die Etagen-Liste) */
  select(sel: Selection) {
    if (sel && this.lockedSel(sel)) sel = null;
    this.selection = sel;
    this.selListeners.forEach((l) => l());
    this.emit();
  }

  private validateSelection() {
    const s = this.selection;
    if (!s) return;
    const f = this.floor;
    const ok =
      (s.kind === 'item' && f.items.some((i) => i.id === s.id)) ||
      (s.kind === 'wall' && f.walls.some((i) => i.id === s.id)) ||
      (s.kind === 'opening' && f.openings.some((i) => i.id === s.id)) ||
      (s.kind === 'room' && f.rooms.some((i) => i.id === s.id));
    if (!ok) this.select(null);
    else this.selListeners.forEach((l) => l());
  }

  private scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.save(), 400);
  }

  /** Entwurf im Browser (zusätzlich zum Server – hilft offline und bei Verbindungsabbruch) */
  save(): boolean {
    if (this.readonly) return true;
    try {
      localStorage.setItem(STORAGE_KEY, this.snapshot());
      return true;
    } catch (e) {
      console.warn('Speichern im Browser fehlgeschlagen (zu große Texturen?)', e);
      return false;
    }
  }

  // Hilfsfunktionen (aktive Etage)
  item(id: string) {
    return this.floor.items.find((i) => i.id === id);
  }
  wall(id: string) {
    return this.floor.walls.find((w) => w.id === id);
  }
  opening(id: string) {
    return this.floor.openings.find((o) => o.id === id);
  }
  room(id: string) {
    return this.floor.rooms.find((r) => r.id === id);
  }

  /** Objekt einer Auswahl, falls gesperrt */
  lockedSel(s: NonNullable<Selection>) {
    const o = s.kind === 'item' ? this.item(s.id) : s.kind === 'wall' ? this.wall(s.id) : s.kind === 'opening' ? this.opening(s.id) : this.room(s.id);
    return !!o?.locked;
  }

  /** Alle gesperrten Objekte der aktiven Etage */
  lockedObjects(): { sel: NonNullable<Selection>; obj: { locked?: boolean } }[] {
    const f = this.floor;
    return [
      ...f.walls.filter((x) => x.locked).map((x) => ({ sel: { kind: 'wall' as const, id: x.id }, obj: x })),
      ...f.openings.filter((x) => x.locked).map((x) => ({ sel: { kind: 'opening' as const, id: x.id }, obj: x })),
      ...f.items.filter((x) => x.locked).map((x) => ({ sel: { kind: 'item' as const, id: x.id }, obj: x })),
      ...f.rooms.filter((x) => x.locked).map((x) => ({ sel: { kind: 'room' as const, id: x.id }, obj: x })),
    ];
  }

  /** Sperren/Entsperren (rückgängig machbar); beim Sperren wird die Auswahl aufgehoben */
  setLocked(s: NonNullable<Selection>, on: boolean) {
    const o = s.kind === 'item' ? this.item(s.id) : s.kind === 'wall' ? this.wall(s.id) : s.kind === 'opening' ? this.opening(s.id) : this.room(s.id);
    if (!o) return;
    if (on) o.locked = true;
    else delete o.locked;
    if (on && this.selection?.kind === s.kind && this.selection.id === s.id) this.select(null);
    this.commit();
  }

  deleteSelection() {
    const s = this.selection;
    if (!s || this.lockedSel(s)) return;
    if (s.kind === 'wall' && this.floor.openings.some((o) => o.wallId === s.id && o.locked)) {
      document.dispatchEvent(new CustomEvent('kp-toast', { detail: 'In dieser Wand sitzen gesperrte Fenster/Türen – erst entsperren.' }));
      return;
    }
    const f = this.floor;
    if (s.kind === 'item') f.items = f.items.filter((i) => i.id !== s.id);
    if (s.kind === 'opening') f.openings = f.openings.filter((o) => o.id !== s.id);
    if (s.kind === 'room') f.rooms = f.rooms.filter((r) => r.id !== s.id);
    if (s.kind === 'wall') {
      f.walls = f.walls.filter((w) => w.id !== s.id);
      f.openings = f.openings.filter((o) => o.wallId !== s.id);
      f.items.forEach((i) => {
        if (i.wallId === s.id) delete i.wallId;
      });
    }
    this.select(null);
    this.commit();
  }
}

export const store = new Store();
