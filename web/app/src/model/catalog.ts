import type { FrontStyle, MaterialSlot } from './types.ts';
import { OBJ_PREFIX, type ObjectType } from './objects.ts';

export type ItemKind =
  | 'base'
  | 'sink'
  | 'hob'
  | 'oven'
  | 'dishwasher'
  | 'island'
  | 'wall'
  | 'tall'
  | 'tallFridge'
  | 'tallOven'
  | 'hood'
  | 'fridgeFree'
  | 'shelf'
  | 'table'
  | 'stool'
  | 'pendant'
  | 'panel'
  | 'gripV'
  | 'rack'
  | 'heavyRack'
  | 'cupboard'
  | 'wardrobe'
  | 'sideboard'
  | 'dresser'
  | 'workbench'
  | 'stairs'
  | 'model'
  /** Möbelart aus der Objektbibliothek (Daten statt Code, siehe objects.ts) */
  | 'custom';

export interface CatalogEntry {
  id: string;
  name: string;
  group: string;
  kind: ItemKind;
  width: number;
  depth: number;
  height: number;
  elevation: number;
  front?: FrontStyle;
  /** Wird an Wände angedockt */
  snapToWall: boolean;
  /** Hat eine Arbeitsplatte */
  countertop?: boolean;
  /** Breiten-Vorschläge im Eigenschaftsfenster */
  widths?: number[];
  /** Voreingestellte Materialien dieses Elements */
  materials?: Partial<Record<MaterialSlot, string>>;
  /** Möbelart aus der Bibliothek */
  object?: ObjectType;
}

const BASE_WIDTHS = [30, 40, 45, 50, 60, 80, 90, 100, 120];

export const CATALOG: CatalogEntry[] = [
  { id: 'base-doors', name: 'Unterschrank Tür', group: 'Unterschränke', kind: 'base', width: 60, depth: 60, height: 90, elevation: 0, front: 'doors', snapToWall: true, countertop: true, widths: BASE_WIDTHS },
  { id: 'base-drawers', name: 'Unterschrank Auszüge', group: 'Unterschränke', kind: 'base', width: 60, depth: 60, height: 90, elevation: 0, front: 'drawers', snapToWall: true, countertop: true, widths: BASE_WIDTHS },
  { id: 'base-mixed', name: 'Unterschrank Schublade + Tür', group: 'Unterschränke', kind: 'base', width: 60, depth: 60, height: 90, elevation: 0, front: 'mixed', snapToWall: true, countertop: true, widths: BASE_WIDTHS },
  { id: 'sink', name: 'Spülenschrank', group: 'Unterschränke', kind: 'sink', width: 80, depth: 60, height: 90, elevation: 0, front: 'doors', snapToWall: true, countertop: true, widths: [60, 80, 90, 100] },
  { id: 'hob', name: 'Kochfeldschrank', group: 'Unterschränke', kind: 'hob', width: 80, depth: 60, height: 90, elevation: 0, front: 'drawers', snapToWall: true, countertop: true, widths: [60, 80, 90] },
  { id: 'oven', name: 'Backofen-Unterschrank', group: 'Unterschränke', kind: 'oven', width: 60, depth: 60, height: 90, elevation: 0, snapToWall: true, countertop: true, widths: [60] },
  { id: 'dishwasher', name: 'Geschirrspüler (integriert)', group: 'Unterschränke', kind: 'dishwasher', width: 60, depth: 60, height: 90, elevation: 0, snapToWall: true, countertop: true, widths: [45, 60] },
  { id: 'island', name: 'Kochinsel', group: 'Unterschränke', kind: 'island', width: 200, depth: 100, height: 90, elevation: 0, front: 'drawers', snapToWall: false, countertop: true, widths: [120, 160, 180, 200, 240, 280] },

  { id: 'wall-doors', name: 'Oberschrank', group: 'Oberschränke', kind: 'wall', width: 60, depth: 35, height: 72, elevation: 145, front: 'doors', snapToWall: true, widths: BASE_WIDTHS },
  { id: 'wall-open', name: 'Oberschrank offen', group: 'Oberschränke', kind: 'wall', width: 60, depth: 35, height: 72, elevation: 145, front: 'open', snapToWall: true, widths: BASE_WIDTHS },
  { id: 'hood', name: 'Dunstabzugshaube', group: 'Oberschränke', kind: 'hood', width: 90, depth: 50, height: 95, elevation: 155, snapToWall: true, widths: [60, 80, 90, 120] },
  { id: 'shelf', name: 'Wandboard', group: 'Oberschränke', kind: 'shelf', width: 120, depth: 25, height: 4, elevation: 150, snapToWall: true, materials: { countertop: 'wood-oak' }, widths: [60, 90, 120, 160, 200] },

  { id: 'tall-doors', name: 'Hochschrank', group: 'Hochschränke', kind: 'tall', width: 60, depth: 60, height: 216, elevation: 0, front: 'doors', snapToWall: true, widths: [40, 45, 50, 60] },
  { id: 'tall-fridge', name: 'Hochschrank Kühlschrank', group: 'Hochschränke', kind: 'tallFridge', width: 60, depth: 60, height: 216, elevation: 0, snapToWall: true, widths: [60] },
  { id: 'tall-oven', name: 'Hochschrank Backofen', group: 'Hochschränke', kind: 'tallOven', width: 60, depth: 60, height: 216, elevation: 0, front: 'doors', snapToWall: true, widths: [60] },
  { id: 'fridge-free', name: 'Side-by-Side Kühlschrank', group: 'Hochschränke', kind: 'fridgeFree', width: 91, depth: 72, height: 178, elevation: 0, snapToWall: true, widths: [70, 91] },
  { id: 'grip-v', name: 'Griffleiste senkrecht', group: 'Hochschränke', kind: 'gripV', width: 2.5, depth: 60, height: 232.8, elevation: 0, snapToWall: true },
  { id: 'panel', name: 'Seitenwange', group: 'Hochschränke', kind: 'panel', width: 4, depth: 62, height: 90, elevation: 0, snapToWall: true },

  { id: 'rack', name: 'Regal offen', group: 'Schränke & Regale', kind: 'rack', width: 80, depth: 35, height: 180, elevation: 0, snapToWall: true, widths: [40, 60, 80, 100, 120], materials: { carcass: 'wood-oak' } },
  { id: 'heavy-rack', name: 'Schwerlastregal', group: 'Schränke & Regale', kind: 'heavyRack', width: 100, depth: 50, height: 180, elevation: 0, snapToWall: true, widths: [75, 90, 100, 120, 150] },
  { id: 'cupboard', name: 'Vorratsschrank', group: 'Schränke & Regale', kind: 'cupboard', width: 80, depth: 40, height: 200, elevation: 0, front: 'doors', snapToWall: true, widths: [40, 60, 80, 100] },
  { id: 'wardrobe', name: 'Kleiderschrank', group: 'Schränke & Regale', kind: 'wardrobe', width: 100, depth: 60, height: 220, elevation: 0, front: 'doors', snapToWall: true, widths: [50, 100, 150, 200, 250] },
  { id: 'sideboard', name: 'Sideboard', group: 'Schränke & Regale', kind: 'sideboard', width: 160, depth: 45, height: 80, elevation: 0, front: 'doors', snapToWall: true, widths: [120, 160, 200, 240] },
  { id: 'dresser', name: 'Kommode', group: 'Schränke & Regale', kind: 'dresser', width: 80, depth: 45, height: 90, elevation: 0, front: 'drawers', snapToWall: true, widths: [40, 60, 80, 100, 120] },
  { id: 'workbench', name: 'Werkbank', group: 'Schränke & Regale', kind: 'workbench', width: 150, depth: 70, height: 90, elevation: 0, snapToWall: true, widths: [120, 150, 200], materials: { countertop: 'wood-oak' } },

  { id: 'model', name: '3D-Modell', group: '_bibliothek', kind: 'model', width: 60, depth: 60, height: 80, elevation: 0, snapToWall: false },
  { id: 'stairs', name: 'Treppe', group: 'Einrichtung', kind: 'stairs', width: 100, depth: 360, height: 280, elevation: 0, snapToWall: true },
  { id: 'table', name: 'Esstisch', group: 'Einrichtung', kind: 'table', width: 180, depth: 90, height: 75, elevation: 0, snapToWall: false, widths: [120, 160, 180, 220], materials: { countertop: 'wood-oak' } },
  { id: 'stool', name: 'Barhocker', group: 'Einrichtung', kind: 'stool', width: 40, depth: 40, height: 65, elevation: 0, snapToWall: false, materials: { countertop: 'wood-oak' } },
  { id: 'pendant', name: 'Pendelleuchte', group: 'Einrichtung', kind: 'pendant', width: 30, depth: 30, height: 30, elevation: 170, snapToWall: false },
];

// ---------------------------------------------------------------------------
// Möbelarten aus der Objektbibliothek. Das Haus führt eine Kopie jeder verwendeten Möbelart (house.objectTypes) –
// sie hat Vorrang, damit bestehende Möbel und ihre Lagerplätze sich nicht ungefragt ändern. Die Bibliothek liefert die
// Möbelarten zum Neu-Platzieren.

const houseObjects = new Map<string, ObjectType>();
const libraryObjects = new Map<string, ObjectType>();
/** Entwurf im Editor (Vorschau, noch nicht gespeichert) – Typ „obj:~vorschau“ */
let previewObject: ObjectType | null = null;
export const PREVIEW_TYPE = OBJ_PREFIX + '~vorschau';
export function setPreviewObject(t: ObjectType | null) {
  previewObject = t;
}

const entryOf = (t: ObjectType): CatalogEntry => ({
  id: OBJ_PREFIX + t.id, name: t.name, group: t.group, kind: 'custom',
  width: t.size.width, depth: t.size.depth, height: t.size.height, elevation: t.size.elevation,
  snapToWall: t.snapToWall, widths: t.size.widths, materials: t.materials, object: t,
});

/** Möbelarten des Hauses (aus house.objectTypes) bekannt machen */
export function setHouseObjects(defs: Record<string, ObjectType> | undefined) {
  houseObjects.clear();
  for (const [id, t] of Object.entries(defs ?? {})) houseObjects.set(id, t);
}
/** Möbelarten der Bibliothek (zum Platzieren) bekannt machen */
export function setLibraryObjects(list: ObjectType[]) {
  libraryObjects.clear();
  for (const t of list) libraryObjects.set(t.id, t);
}
export const libraryObject = (id: string) => libraryObjects.get(id);
export const libraryEntries = () => [...libraryObjects.values()].map(entryOf);
/** Möbelart eines Möbels (Kopie im Haus, sonst Bibliothek) */
export function objectOf(type: string): ObjectType | undefined {
  if (!type.startsWith(OBJ_PREFIX)) return undefined;
  if (type === PREVIEW_TYPE) return previewObject ?? undefined;
  const id = type.slice(OBJ_PREFIX.length);
  return houseObjects.get(id) ?? libraryObjects.get(id);
}

/** Unbekannte Möbelart (z. B. gelöscht): neutraler Kasten ohne Fächer */
const UNKNOWN: CatalogEntry = { id: 'obj:?', name: 'Unbekannte Möbelart', group: '', kind: 'custom', width: 60, depth: 60, height: 80, elevation: 0, snapToWall: false };

export function getEntry(type: string): CatalogEntry {
  if (type.startsWith(OBJ_PREFIX)) {
    const t = objectOf(type);
    return t ? entryOf(t) : { ...UNKNOWN, id: type };
  }
  return CATALOG.find((c) => c.id === type) ?? CATALOG[0];
}
