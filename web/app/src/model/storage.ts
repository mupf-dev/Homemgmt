// Fächer eines Möbels: Schubladen, Böden hinter Türen, offene Regalböden. Jedes Fach ist im Lager ein Platz
// (Zeile = Nummer des Fachs, Spalte = Buchstabe des Möbels, Lager = Raum). Die Aufteilung folgt denselben Regeln wie
// die 3D-Modelle (models.ts), damit „Schublade 2“ im Lager genau die zweite Schublade im Bild ist.
// Maße in cm, lokal zum Möbel: x quer (links → rechts), y Höhe über Unterkante des Möbels, z Tiefe (Front = +depth/2).

import { getEntry, objectOf, type ItemKind } from './catalog.ts';
import { objectCompartments } from './objects.ts';
import type { Item, Project } from './types.ts';

export type CompartmentKind = 'drawer' | 'shelf' | 'door' | 'open' | 'cold' | 'freezer' | 'surface';

export interface Compartment {
  /** Zeile im Lager (0, 1, 2 … von oben nach unten bzw. bei Regalen von oben) */
  row: number;
  label: string;
  kind: CompartmentKind;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
}

/** Höhenverhältnisse der Auszüge je Anzahl (oben → unten) – wie DRAWER_RATIOS in models.ts */
const DRAWER_RATIOS: Record<number, number[]> = { 1: [1], 2: [1, 1], 3: [1, 1.5, 1.5], 4: [1, 1, 1, 1] };

/** Möbelarten, deren Böden-/Schubladenzahl einstellbar ist (Eigenschaft „levels“) */
export const LEVEL_KINDS: Partial<Record<ItemKind, { label: string; min: number; max: number; std: number }>> = {
  rack: { label: 'Böden', min: 1, max: 12, std: 5 },
  heavyRack: { label: 'Böden', min: 2, max: 8, std: 5 },
  cupboard: { label: 'Böden', min: 1, max: 10, std: 5 },
  wardrobe: { label: 'Böden', min: 1, max: 10, std: 5 },
  sideboard: { label: 'Böden', min: 1, max: 4, std: 2 },
  dresser: { label: 'Schubladen', min: 1, max: 8, std: 4 },
};

export const levelsOf = (it: Item, kind = getEntry(it.type).kind) =>
  Math.max(LEVEL_KINDS[kind]?.min ?? 1, Math.min(LEVEL_KINDS[kind]?.max ?? 50, Math.round(it.levels ?? LEVEL_KINDS[kind]?.std ?? 1)));

function drawers(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, ratios: number[], name = 'Schublade'): Omit<Compartment, 'row'>[] {
  const total = ratios.reduce((a, b) => a + b, 0);
  const n = ratios.length;
  let y = y1;
  return ratios.map((r, i) => {
    const h = ((y1 - y0) * r) / total;
    const c = { label: n === 1 ? name : `${name} ${i + 1}${i === 0 ? ' (oben)' : i === n - 1 ? ' (unten)' : ''}`, kind: 'drawer' as const, x0, x1, y0: y - h, y1: y, z0, z1 };
    y -= h;
    return c;
  });
}

/** Gleich hohe Böden von oben nach unten; label(i, n) benennt sie */
function shelves(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, n: number, kind: CompartmentKind, label: (i: number, n: number) => string): Omit<Compartment, 'row'>[] {
  const h = (y1 - y0) / n;
  return Array.from({ length: n }, (_, i) => ({ label: label(i, n), kind, x0, x1, y0: y1 - h * (i + 1), y1: y1 - h * i, z0, z1 }));
}
const boden = (prefix = 'Boden') => (i: number, n: number) => (n === 1 ? prefix : `${prefix} ${i + 1}${i === 0 ? ' (oben)' : i === n - 1 ? ' (unten)' : ''}`);

/** Fächer eines Möbels (leer = kein Stauraum, z. B. Geschirrspüler, Hocker, Leuchte) */
export function compartments(it: Item, settings: Project['settings']): Compartment[] {
  if (it.passage) return []; // Durchgang in Schrankoptik: kein Stauraum
  const kind = getEntry(it.type).kind;
  const W = it.width;
  const D = it.depth;
  const H = it.height;
  const P = settings.plinth ?? 10;
  const T = settings.countertopThickness ?? 4;
  const x0 = -W / 2;
  const x1 = W / 2;
  const zF = D / 2;
  const zB = -D / 2;
  let list: Omit<Compartment, 'row'>[] = [];

  switch (kind) {
    case 'custom': {
      // Möbelart aus der Bibliothek: Fächer aus ihrer Beschreibung (Maße in cm, Unterkante = 0 wie hier)
      const t = objectOf(it.type);
      list = t ? objectCompartments(t, W, D, H).map((c) => ({ label: c.label, kind: c.kind, x0: c.x0, x1: c.x1, y0: c.y0, y1: c.y1, z0: c.z0, z1: c.z1 })) : [];
      break;
    }
    case 'base':
    case 'hob': {
      const y0 = P;
      const y1 = H - T;
      if (kind === 'hob' || it.front === 'drawers') list = drawers(x0, x1, y0, y1, zB, zF, DRAWER_RATIOS[Math.max(1, Math.min(4, it.drawers ?? 3))]);
      else if (it.front === 'mixed') {
        list = [
          ...drawers(x0, x1, y1 - 15, y1, zB, zF, [1]),
          ...shelves(x0, x1, y0, y1 - 15, zB, zF, 2, 'door', (i) => (i === 0 ? 'Einlegeboden' : 'Boden unten')),
        ];
      } else list = shelves(x0, x1, y0, y1, zB, zF, 2, 'door', (i) => (i === 0 ? 'Einlegeboden' : 'Boden unten'));
      break;
    }
    case 'sink':
      list = [{ label: 'Unter der Spüle', kind: 'door', x0, x1, y0: P, y1: H - T - 20, z0: zB, z1: zF }];
      break;
    case 'oven':
      list = drawers(x0, x1, P, H - T - 59.5, zB, zF, [1], 'Schublade unter dem Backofen');
      break;
    case 'island': {
      const cabD = Math.min(60, D - 5);
      const n = it.columnWidths?.filter((w) => w > 0).length || (it.columns && it.columns > 0 ? Math.round(it.columns) : Math.max(1, Math.round(W / 80)));
      const widths = it.columnWidths?.filter((w) => w > 0);
      const sum = widths?.reduce((a, b) => a + b, 0) ?? n;
      let x = x0;
      for (let c = 0; c < n; c++) {
        const cw = widths ? (widths[c] / sum) * W : W / n;
        const ratios = it.columnFronts?.[c] ?? DRAWER_RATIOS[Math.max(1, Math.min(4, it.drawers ?? 3))];
        for (const d of drawers(x, x + cw, P, H - T, zF - cabD, zF, ratios)) list.push({ ...d, label: `${n > 1 ? `Spalte ${c + 1} · ` : ''}${d.label}` });
        x += cw;
      }
      if (it.islandBack === 'doors') list.push({ label: 'Rückseite (Türen)', kind: 'door', x0, x1, y0: P, y1: H - T, z0: zB, z1: zF - cabD });
      break;
    }
    case 'wall':
      list = shelves(x0, x1, 0, H, zB, zF, 2, it.front === 'open' ? 'open' : 'door', (i) => (i === 0 ? 'Boden oben' : 'Boden unten'));
      break;
    case 'tall': {
      if (it.front === 'single') list = shelves(x0, x1, P, H, zB, zF, 5, 'door', boden());
      else {
        const split = P + (H - P) * 0.6;
        list = [
          ...shelves(x0, x1, split, H, zB, zF, 2, 'door', (i) => `Oben, Boden ${i + 1}`),
          ...shelves(x0, x1, P, split, zB, zF, 3, 'door', (i) => `Unten, Boden ${i + 1}`),
        ];
      }
      break;
    }
    case 'tallFridge': {
      const split = P + 72;
      const top = Math.min(H, split + 122);
      list = [
        ...(H - top > 5 ? [{ label: 'Aufsatzschrank', kind: 'door' as const, x0, x1, y0: top, y1: H, z0: zB, z1: zF }] : []),
        ...shelves(x0, x1, split, top, zB, zF, 3, 'cold', (i) => `Kühlschrank, ${['oben', 'Mitte', 'unten'][i]}`),
        ...shelves(x0, x1, P, split, zB, zF, 3, 'freezer', (i) => `Gefrierfach ${i + 1}`),
      ];
      break;
    }
    case 'tallOven':
      if (it.front === 'doors') {
        const ovenY0 = P + 50.7;
        const ovenY1 = ovenY0 + 59.5;
        list = [
          { label: 'Fach über dem Backofen', kind: 'door', x0, x1, y0: ovenY1, y1: H, z0: zB, z1: zF },
          { label: 'Fach unter dem Backofen', kind: 'door', x0, x1, y0: P, y1: ovenY0, z0: zB, z1: zF },
        ];
      } else {
        const micro = P + 60 + 59.5 + 38.5;
        list = [
          ...(H - micro > 5 ? [{ label: 'Aufsatzschrank', kind: 'door' as const, x0, x1, y0: micro, y1: H, z0: zB, z1: zF }] : []),
          ...drawers(x0, x1, P, P + 60, zB, zF, [1, 1]),
        ];
      }
      break;
    case 'fridgeFree': {
      const split = -W / 2 + W * 0.42;
      list = [
        ...shelves(split, x1, 2, H, zB, zF, 3, 'cold', (i) => `Kühlteil, ${['oben', 'Mitte', 'unten'][i]}`),
        ...shelves(x0, split, 2, H, zB, zF, 3, 'freezer', (i) => `Gefrierteil ${i + 1}`),
      ];
      break;
    }
    case 'shelf':
      list = [{ label: 'Ablage', kind: 'surface', x0, x1, y0: H, y1: H + 25, z0: zB, z1: zF }];
      break;
    case 'rack':
    case 'heavyRack': {
      const n = levelsOf(it, kind);
      // n Böden: der unterste liegt knapp über dem Boden, der Raum über dem obersten zählt als Fach
      const h = (H - 3) / n;
      list = Array.from({ length: n }, (_, i) => ({ label: boden()(i, n), kind: 'open' as const, x0, x1, y0: H - h * (i + 1), y1: H - h * i, z0: zB, z1: zF }));
      break;
    }
    case 'cupboard':
    case 'wardrobe':
      list = shelves(x0, x1, P, H - 2, zB, zF, levelsOf(it, kind), 'door', boden());
      break;
    case 'sideboard':
      list = shelves(x0, x1, P, H - 2, zB, zF, levelsOf(it, kind), 'door', boden());
      break;
    case 'dresser': {
      const n = levelsOf(it, kind);
      list = drawers(x0, x1, P, H - 2, zB, zF, Array(n).fill(1));
      break;
    }
    case 'workbench':
      list = [
        { label: 'Arbeitsfläche', kind: 'surface', x0, x1, y0: H, y1: H + 30, z0: zB, z1: zF },
        { label: 'Ablage unten', kind: 'open', x0, x1, y0: 12, y1: Math.min(45, H - 10), z0: zB, z1: zF },
      ];
      break;
    default:
      list = [];
  }
  return list.slice(0, 100).map((c, row) => ({ ...c, row }));
}

/** Anzeigename eines Möbels (eigener Name oder Katalogname mit Breite) */
export const itemName = (it: Item) => it.label?.trim() || it.model?.name || `${getEntry(it.type).name} ${Math.round(it.width)}`;

/** Spaltenbuchstaben A … Z, AA … (wie im Lager) */
export function colName(i: number) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
