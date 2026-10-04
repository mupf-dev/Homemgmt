// Das Haus als Ganzes: Etagen anlegen und migrieren, Etagen-Sicht für Editor/3D, Räume erkennen, Lager-Kürzel und
// Spaltenbuchstaben vergeben. Reine Logik – dieselbe Normalisierung läuft in der App (Anzeige) und auf dem Server
// (verbindlich, beim Speichern).

import type { Floor, FloorKind, House, Item, HouseSlot, Project, Room, Vec2 } from './types.ts';
import { compartments, colName } from './storage.ts';
import { pointInPolygon, polygonCentroid, roomPolygon, wallFaces } from './rooms.ts';
import { libraryObject, setHouseObjects } from './catalog.ts';
import { OBJ_PREFIX, validateObjectType, type ObjectType } from './objects.ts';

export const uid = () => Math.random().toString(36).slice(2, 10);

export const DEFAULT_SLOTS: Record<HouseSlot, string> = {
  front: 'lack-sage',
  carcass: 'lack-white',
  countertop: 'stone-marble',
  handle: 'metal-brass',
  channel: '@front',
  sink: 'metal-steel',
  backsplash: 'stone-marble',
  floor: 'floor-parquet',
  wall: 'wall-plaster',
  ceiling: 'wall-white',
};

export const DEFAULT_SETTINGS: Project['settings'] = { ceiling: false, backsplash: true, plinth: 10, countertopThickness: 4, timeOfDay: 14 };

export const FLOOR_KINDS: Record<FloorKind, string> = { basement: 'Keller', floor: 'Etage', attic: 'Dachgeschoss', outdoor: 'Außenbereich' };

export function makeFloor(over: Partial<Floor> = {}): Floor {
  return { id: uid(), name: 'Erdgeschoss', kind: 'floor', elevation: 0, height: 260, walls: [], openings: [], items: [], rooms: [], ...over };
}

export function emptyHouse(name = 'Mein Zuhause'): House {
  return { version: 2, name, floors: [makeFloor()], slots: { ...DEFAULT_SLOTS }, customMaterials: [], settings: { ...DEFAULT_SETTINGS } };
}

/** Planung im alten Format (eine Küche/Etage) als Etage */
export function projectToFloor(p: Project, over: Partial<Floor> = {}): Floor {
  return makeFloor({
    name: p.name || 'Erdgeschoss',
    height: Math.max(200, ...p.walls.map((w) => w.height)),
    walls: p.walls ?? [],
    openings: p.openings ?? [],
    items: p.items ?? [],
    underlay: p.underlay,
    ...over,
  });
}

/** Haus (Version 2) oder alte Planung (Version 1) → vollständiges Haus mit allen Feldern */
export function migrateHouse(raw: any): House {
  if (raw && raw.version === 2 && Array.isArray(raw.floors)) {
    const h = raw as House;
    // Möbelarten des Hauses sofort bekannt machen (Fächer, 3D), auch bevor normalisiert wird
    setHouseObjects(h.objectTypes);
    return {
      version: 2,
      name: h.name || 'Mein Zuhause',
      floors: h.floors.map((f) => ({ ...makeFloor(), ...f, walls: f.walls ?? [], openings: f.openings ?? [], items: f.items ?? [], rooms: f.rooms ?? [] })),
      slots: { ...DEFAULT_SLOTS, ...(h.slots ?? {}) },
      customMaterials: h.customMaterials ?? [],
      uv: h.uv,
      settings: { ...DEFAULT_SETTINGS, ...(h.settings ?? {}) },
      ...(h.objectTypes && Object.keys(h.objectTypes).length ? { objectTypes: h.objectTypes } : {}),
    };
  }
  const p = (raw ?? {}) as Project;
  // alte Einstellung „Dielenrichtung“ → Ausrichtung des Bodens
  const uv = p.settings?.floorRotation && !p.uv?.floor ? { ...(p.uv ?? {}), floor: { rotation: p.settings.floorRotation } } : p.uv;
  const settings = { ...DEFAULT_SETTINGS, ...(p.settings ?? {}) };
  delete settings.floorRotation;
  return {
    version: 2,
    name: 'Mein Zuhause',
    floors: [projectToFloor({ ...p, walls: p.walls ?? [], openings: p.openings ?? [], items: p.items ?? [] })],
    slots: { ...DEFAULT_SLOTS, ...(p.slots ?? {}) },
    customMaterials: p.customMaterials ?? [],
    uv,
    settings,
  };
}

/**
 * Eine Etage in der Form, mit der Editor, 3D-Szene und Modelle arbeiten (Project). Wände, Öffnungen, Möbel und Vorlage
 * gehören zur Etage, Name, Materialien und Einstellungen zum Haus – Lesen und Schreiben gehen direkt durch.
 */
export function floorView(house: House | (() => House), floor: Floor | (() => Floor)): Project {
  const H = typeof house === 'function' ? house : () => house;
  const F = typeof floor === 'function' ? floor : () => floor;
  const view = { version: 1 } as Project;
  const on = (obj: () => any, keys: string[]) => {
    for (const k of keys) {
      Object.defineProperty(view, k, {
        enumerable: true,
        get: () => obj()[k],
        set: (v) => {
          if (v === undefined) delete obj()[k];
          else obj()[k] = v;
        },
      });
    }
  };
  on(F, ['walls', 'openings', 'items', 'underlay']);
  on(H, ['name', 'slots', 'customMaterials', 'uv', 'settings']);
  return view;
}

// ---------------------------------------------------------------------------
// Lager-Kürzel

export const CODE_RE = /^[A-Z][A-Z0-9]{0,3}$/;

const translit = (s: string) =>
  s.toUpperCase().replace(/Ä/g, 'AE').replace(/Ö/g, 'OE').replace(/Ü/g, 'UE').replace(/ß/g, 'SS').replace(/[^A-Z0-9 ]/g, '');

/** Kürzel aus einem Namen: „Küche“ → KU, „Wohnzimmer“ → WO, „Bad OG“ → BO; bei Kollision weitere Buchstaben/Ziffern */
export function suggestCode(name: string, taken: Set<string>): string {
  const clean = translit(name).replace(/AE/g, 'A').replace(/OE/g, 'O').replace(/UE/g, 'U');
  const words = clean.split(/\s+/).filter(Boolean);
  const letters = words.join('');
  const cands: string[] = [];
  if (words.length > 1) cands.push(words.map((w) => w[0]).join('').slice(0, 4));
  if (letters.length) {
    cands.push(letters.slice(0, 2));
    for (let i = 2; i < Math.min(letters.length, 8); i++) cands.push(letters[0] + letters[i]);
    cands.push(letters.slice(0, 3));
  }
  for (const c of cands) if (CODE_RE.test(c) && !taken.has(c)) return c;
  const base = CODE_RE.test(cands[0] ?? '') ? cands[0].slice(0, 3) : 'R';
  for (let i = 2; i < 1000; i++) {
    const c = `${base}${i}`.slice(0, 4);
    if (CODE_RE.test(c) && !taken.has(c)) return c;
  }
  return 'X' + uid().slice(0, 3).toUpperCase();
}

// ---------------------------------------------------------------------------
// Normalisieren: Räume erkennen, Kürzel und Spalten vergeben

/** Lager eines Möbels: der Raum, in dem seine Mitte liegt – sonst die Etage selbst */
export function roomOf(floor: Floor, it: Pick<Item, 'x' | 'y'>): Room | null {
  return floor.rooms.find((r) => r.polygon && r.polygon.length >= 3 && pointInPolygon({ x: it.x, y: it.y }, r.polygon)) ?? null;
}

/** Schlüssel des Lagers, zu dem ein Möbel gehört: Raum-ID oder „floor:<Etagen-ID>“ */
export const storageKey = (floor: Floor, room: Room | null) => (room ? `room:${room.id}` : `floor:${floor.id}`);

/**
 * Bringt das Haus in einen gültigen Zustand (verändert es direkt):
 * - Raumumrisse aus den Wänden neu bestimmen (bleibt der Punkt außerhalb jeder Fläche, gilt der letzte Umriss)
 * - Lager-Kürzel für Räume und Etagen: gültig und im ganzen Haus eindeutig, „reserved“ = Kürzel anderer Lager
 * - Spaltenbuchstaben für Möbel mit Fächern: je Lager eindeutig, bestehende bleiben. Mit „previous“ (zuletzt
 *   gespeicherter Stand) behalten Möbel, die im selben Raum bleiben, Vorrang vor hinzugekommenen; fehlende Buchstaben
 *   werden von dort übernommen – so ändern sich Adressen nur, wenn ein Möbel wirklich umzieht.
 */
/**
 * Möbelarten aus der Bibliothek im Haus führen: fehlende Kopien aus der Bibliothek übernehmen (beim Platzieren),
 * nicht mehr verwendete entfernen, ungültige verwerfen. Danach sind sie für Fächer und 3D bekannt.
 */
export function syncHouseObjects(house: House) {
  const used = new Set(house.floors.flatMap((f) => f.items.map((it) => it.type)).filter((t) => t.startsWith(OBJ_PREFIX)).map((t) => t.slice(OBJ_PREFIX.length)));
  const next: Record<string, ObjectType> = {};
  for (const id of used) {
    const have = house.objectTypes?.[id];
    let t: ObjectType | undefined;
    try {
      t = have ? validateObjectType(have) : libraryObject(id);
    } catch {
      t = undefined;
    }
    if (t) next[id] = t;
  }
  if (Object.keys(next).length) house.objectTypes = next;
  else delete house.objectTypes;
  setHouseObjects(house.objectTypes);
}

export function normalizeHouse(house: House, reserved: Set<string> = new Set(), previous?: House | null) {
  syncHouseObjects(house);
  const taken = new Set(reserved);
  const claim = (want: string | undefined, name: string) => {
    let c = String(want ?? '').toUpperCase();
    if (!CODE_RE.test(c) || taken.has(c)) c = suggestCode(name, taken);
    taken.add(c);
    return c;
  };
  for (const f of house.floors) {
    const faces = wallFaces(f.walls);
    for (const r of f.rooms) {
      const poly = r.manual && r.polygon?.length ? null : roomPolygon(f.walls, r.seed, faces);
      if (poly) r.polygon = poly.map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }));
      r.name = String(r.name ?? '').trim().slice(0, 40) || 'Raum';
      r.code = claim(r.code, r.name);
    }
  }
  for (const f of house.floors) {
    const loose = f.items.some((it) => !roomOf(f, it) && compartments(it, house.settings).length);
    if (loose || f.code) f.code = claim(f.code, f.name);
  }
  // Spalten je Lager
  const before = new Map<string, { key: string; col: string }>();
  for (const u of previous ? storageUnits(previous) : []) for (const s of u.items) before.set(s.item.id, { key: u.key, col: s.col });
  const used = new Map<string, Set<string>>();
  const pending: { key: string; it: Item }[] = [];
  const candidates: { key: string; it: Item; stays: boolean }[] = [];
  for (const f of house.floors) {
    for (const it of f.items) {
      if (!compartments(it, house.settings).length) {
        delete it.storageCol;
        continue;
      }
      const key = storageKey(f, roomOf(f, it));
      const prev = before.get(it.id);
      if (!it.storageCol && prev) it.storageCol = prev.col;
      candidates.push({ key, it, stays: prev?.key === key && prev.col === it.storageCol });
    }
  }
  // erst die Möbel, die bleiben, dann die übrigen (stabile Reihenfolge)
  candidates.sort((a, b) => Number(b.stays) - Number(a.stays));
  for (const { key, it } of candidates) {
    const set = used.get(key) ?? new Set<string>();
    used.set(key, set);
    if (it.storageCol && /^[A-Z]{1,3}$/.test(it.storageCol) && !set.has(it.storageCol)) set.add(it.storageCol);
    else pending.push({ key, it });
  }
  for (const { key, it } of pending) {
    const set = used.get(key)!;
    let i = 0;
    while (set.has(colName(i))) i++;
    it.storageCol = colName(i);
    set.add(it.storageCol);
  }
  return house;
}

/** Ein Lager des Hauses mit seinen Möbeln und Fächern – Grundlage für den Abgleich mit dem Lager */
export interface StorageUnit {
  key: string;
  floorId: string;
  roomId: string | null;
  name: string;
  code: string;
  items: { item: Item; col: string; compartments: ReturnType<typeof compartments> }[];
}

export function storageUnits(house: House): StorageUnit[] {
  const units = new Map<string, StorageUnit>();
  for (const f of house.floors) {
    for (const r of f.rooms) units.set(storageKey(f, r), { key: storageKey(f, r), floorId: f.id, roomId: r.id, name: r.name, code: r.code, items: [] });
    for (const it of f.items) {
      const comps = compartments(it, house.settings);
      if (!comps.length || !it.storageCol) continue;
      const room = roomOf(f, it);
      const key = storageKey(f, room);
      if (!units.has(key)) units.set(key, { key, floorId: f.id, roomId: null, name: `${f.name} (ohne Raum)`, code: f.code ?? '', items: [] });
      units.get(key)!.items.push({ item: it, col: it.storageCol, compartments: comps });
    }
  }
  return [...units.values()];
}

/** Mittelpunkt eines Raums (für Beschriftungen) */
export function roomLabelPoint(r: Room): Vec2 {
  const poly = r.polygon;
  if (!poly?.length) return r.seed;
  const c = polygonCentroid(poly);
  if (pointInPolygon(c, poly)) return c;
  return pointInPolygon(r.seed, poly) ? r.seed : poly[0];
}
