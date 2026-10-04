// Möbelarten als Daten („Objektbibliothek“): Eine Möbelart beschreibt entweder einen Korpus aus Spalten und Elementen
// (Schublade, Tür mit Böden, Klappe, offenes Fach, Kühl-/Gefrierfach) – daraus entstehen 3D-Modell und Fächer – oder
// ein 3D-Modell (.glb) mit eingezeichneten Fächern. Format: zuhause-objekt/1 (JSON), geteilt per Datei oder über den
// Community-Katalog (Repo mupf-dev/homemgmt-object-library; dort liegt eine Kopie dieser Datei zum Prüfen – bei
// Formatänderungen mitziehen). Wird von App und Server gleichermaßen genutzt.

import type { MaterialSlot } from './types.ts';

export const OBJECT_FORMAT = 'zuhause-objekt/1';
/** Möbel aus der Bibliothek tragen als Typ „obj:<id>“ */
export const OBJ_PREFIX = 'obj:';

export type ElementKind = 'drawer' | 'door' | 'flap' | 'open' | 'cold' | 'freezer';
export const ELEMENT_KINDS: Record<ElementKind, string> = {
  drawer: 'Schublade',
  door: 'Tür',
  flap: 'Klappe',
  open: 'Offenes Fach',
  cold: 'Kühlfach',
  freezer: 'Gefrierfach',
};

export interface ObjElement {
  kind: ElementKind;
  /** relative Höhe innerhalb der Spalte */
  size: number;
  /** Böden hinter der Tür bzw. im offenen Fach (je Boden ein Fach im Lager) */
  shelves?: number;
  /** eigene Bezeichnung (sonst aus Art und Position) */
  label?: string;
}
export interface ObjColumn {
  /** relative Breite */
  size: number;
  elements: ObjElement[];
}
export interface KorpusBuild {
  type: 'korpus';
  /** Sockel in cm (0 = ohne) */
  plinth: number;
  /** Plattenstärke in cm */
  board: number;
  /** Rückwand */
  back: boolean;
  /** Arbeitsplatte oben (kein Fach): Stärke und Überstand vorne in cm; join = Teil der Küchenzeile, geht in
   *  angrenzende Unterschränke über. size.height ist die Gesamthöhe inklusive Platte. */
  countertop?: KorpusCountertop;
  /** Spalten von links nach rechts, Elemente je Spalte von oben nach unten */
  columns: ObjColumn[];
}
export interface KorpusCountertop {
  thickness: number;
  overhang: number;
  join?: boolean;
}
/** Fach eines 3D-Modells: Quader als Anteile 0 … 1 der Breite (x, links → rechts), Höhe (y, unten → oben), Tiefe (z, hinten → vorne) */
export interface ModelCompartment {
  label: string;
  kind: 'drawer' | 'shelf' | 'door' | 'open' | 'cold' | 'freezer';
  box: [number, number, number, number, number, number];
}
export interface ModelBuild {
  type: 'modell';
  /** url: lokal abgelegtes Modell (/library/models/…); file: Pfad im Community-Katalog (wird beim Installieren geladen) */
  model: { url?: string; file?: string; name?: string };
  compartments: ModelCompartment[];
}
export interface ObjectType {
  format: typeof OBJECT_FORMAT;
  /** eindeutig, klein, mit Punkt/Bindestrich: „community.kallax-4x4“, „eigene.werkzeugwagen“ */
  id: string;
  name: string;
  group: string;
  version: string;
  author?: string;
  license?: string;
  description?: string;
  size: { width: number; depth: number; height: number; elevation: number; widths?: number[] };
  snapToWall: boolean;
  materials?: Partial<Record<MaterialSlot, string>>;
  build: KorpusBuild | ModelBuild;
}

const SLOTS: MaterialSlot[] = ['front', 'carcass', 'countertop', 'handle', 'channel', 'sink', 'backsplash', 'floor', 'wall', 'ceiling'];
const ID_RE = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const VERSION_RE = /^\d{1,4}(?:\.\d{1,4}){0,2}$/;
/** Lageradressen haben höchstens zwei Ziffern je Fach */
export const MAX_COMPARTMENTS = 99;

const fail = (msg: string): never => {
  throw new Error(msg);
};
const str = (v: unknown, max: number, what: string, required = false) => {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : fail(`${what}: Text erwartet.`);
  if (required && !s) fail(`${what} fehlt.`);
  if (s.length > max) fail(`${what} ist zu lang (höchstens ${max} Zeichen).`);
  return s;
};
const num = (v: unknown, min: number, max: number, what: string, dflt?: number) => {
  const n = v == null && dflt !== undefined ? dflt : Number(v);
  if (!Number.isFinite(n) || n < min || n > max) fail(`${what} muss zwischen ${min} und ${max} liegen.`);
  return Math.round(n * 10) / 10;
};

function countertopOf(c: unknown): KorpusCountertop {
  if (typeof c !== 'object' || !c) fail('Arbeitsplatte: Angaben als Objekt { thickness, overhang, join }.');
  const o = c as Record<string, unknown>;
  return {
    thickness: num(o.thickness, 1, 10, 'Arbeitsplatte: Stärke', 4),
    overhang: num(o.overhang, 0, 10, 'Arbeitsplatte: Überstand', 2),
    ...(o.join === true ? { join: true } : {}),
  };
}

/** Möbelart prüfen und vereinheitlichen – wirft eine verständliche Meldung bei Fehlern */
export function validateObjectType(raw: unknown): ObjectType {
  if (!raw || typeof raw !== 'object') fail('Keine Möbelart (JSON-Objekt erwartet).');
  const o = raw as Record<string, any>;
  if (o.format !== OBJECT_FORMAT) fail(`Unbekanntes Format „${o.format ?? ''}“ – erwartet ${OBJECT_FORMAT}.`);
  const id = str(o.id, 60, 'Kennung', true).toLowerCase();
  if (!ID_RE.test(id)) fail('Kennung: nur Kleinbuchstaben, Ziffern, Punkt und Bindestrich (z. B. „eigene.schuhschrank“).');
  const version = str(o.version, 20, 'Version', true);
  if (!VERSION_RE.test(version)) fail('Version im Format 1, 1.2 oder 1.2.3.');
  const s = o.size ?? {};
  const size = {
    width: num(s.width, 5, 1000, 'Breite'),
    depth: num(s.depth, 5, 300, 'Tiefe'),
    height: num(s.height, 2, 400, 'Höhe'),
    elevation: num(s.elevation, 0, 300, 'Abstand vom Boden', 0),
    ...(Array.isArray(s.widths) && s.widths.length ? { widths: s.widths.slice(0, 12).map((w: unknown) => num(w, 5, 1000, 'Breiten-Vorschlag')) } : {}),
  };
  const materials: Partial<Record<MaterialSlot, string>> = {};
  for (const [k, v] of Object.entries(o.materials ?? {})) {
    if (SLOTS.includes(k as MaterialSlot) && typeof v === 'string' && v.length <= 80) materials[k as MaterialSlot] = v;
  }
  const b = o.build ?? fail('Aufbau (build) fehlt.');
  let build: KorpusBuild | ModelBuild;
  if (b.type === 'korpus') {
    if (!Array.isArray(b.columns) || !b.columns.length) fail('Mindestens eine Spalte.');
    if (b.columns.length > 12) fail('Höchstens 12 Spalten.');
    build = {
      type: 'korpus',
      plinth: num(b.plinth, 0, 40, 'Sockel', 0),
      board: num(b.board, 0.5, 6, 'Plattenstärke', 1.8),
      back: b.back !== false,
      ...(b.countertop != null && b.countertop !== false ? { countertop: countertopOf(b.countertop) } : {}),
      columns: b.columns.map((c: any, ci: number) => {
        if (!Array.isArray(c?.elements) || !c.elements.length) fail(`Spalte ${ci + 1}: mindestens ein Element.`);
        if (c.elements.length > 20) fail(`Spalte ${ci + 1}: höchstens 20 Elemente.`);
        return {
          size: num(c.size, 0.05, 20, `Spalte ${ci + 1}: Breite`, 1),
          elements: c.elements.map((e: any, ei: number) => {
            const where = `Spalte ${ci + 1}, Element ${ei + 1}`;
            if (!(e?.kind in ELEMENT_KINDS)) fail(`${where}: unbekannte Art „${e?.kind ?? ''}“.`);
            const el: ObjElement = { kind: e.kind, size: num(e.size, 0.05, 20, `${where}: Höhe`, 1) };
            if ((e.kind === 'door' || e.kind === 'open') && e.shelves != null) el.shelves = Math.round(num(e.shelves, 1, 12, `${where}: Böden`));
            const label = str(e.label, 40, `${where}: Bezeichnung`);
            if (label) el.label = label;
            return el;
          }),
        };
      }),
    };
    const ct = (build as KorpusBuild).countertop;
    if (ct && size.height - ct.thickness - (build as KorpusBuild).plinth - 2 * (build as KorpusBuild).board < 5) fail('Höhe reicht nicht für Sockel, Korpus und Arbeitsplatte.');
  } else if (b.type === 'modell') {
    const m = b.model ?? {};
    const url = str(m.url, 200, 'Modell-Adresse');
    const file = str(m.file, 200, 'Modell-Datei');
    if (url && !/^\/library\/models\/[\w./-]+\.glb$/.test(url)) fail('Modell-Adresse: nur hochgeladene Modelle (/library/models/….glb).');
    if (file && !/^[\w./-]+\.glb$/.test(file) || file.includes('..')) fail('Modell-Datei: Pfad im Katalog (….glb).');
    if (!url && !file) fail('3D-Modell fehlt.');
    if (!Array.isArray(b.compartments)) fail('Fächer fehlen.');
    if (b.compartments.length > MAX_COMPARTMENTS) fail(`Höchstens ${MAX_COMPARTMENTS} Fächer.`);
    build = {
      type: 'modell',
      model: { ...(url ? { url } : {}), ...(file ? { file } : {}), ...(m.name ? { name: str(m.name, 80, 'Modellname') } : {}) },
      compartments: b.compartments.map((c: any, i: number) => {
        const box = Array.isArray(c?.box) && c.box.length === 6 ? c.box.map((v: unknown) => num(v, 0, 1, `Fach ${i + 1}: Lage`)) : fail(`Fach ${i + 1}: Lage (box) fehlt.`);
        if (box[0] >= box[1] || box[2] >= box[3] || box[4] >= box[5]) fail(`Fach ${i + 1}: Anfang muss vor Ende liegen.`);
        const kind = ['drawer', 'shelf', 'door', 'open', 'cold', 'freezer'].includes(c.kind) ? c.kind : 'shelf';
        return { label: str(c.label, 40, `Fach ${i + 1}: Bezeichnung`, true), kind, box };
      }),
    };
  } else return fail(`Unbekannter Aufbau „${b.type ?? ''}“ (korpus oder modell).`);
  const t: ObjectType = {
    format: OBJECT_FORMAT, id, version,
    name: str(o.name, 60, 'Name', true),
    group: str(o.group, 40, 'Gruppe') || 'Eigene Möbel',
    ...(o.author ? { author: str(o.author, 60, 'Autor') } : {}),
    ...(o.license ? { license: str(o.license, 40, 'Lizenz') } : {}),
    ...(o.description ? { description: str(o.description, 500, 'Beschreibung') } : {}),
    size,
    snapToWall: o.snapToWall !== false,
    ...(Object.keys(materials).length ? { materials } : {}),
    build,
  };
  if (objectCompartmentCount(t) > MAX_COMPARTMENTS) fail(`Zu viele Fächer (höchstens ${MAX_COMPARTMENTS}).`);
  return t;
}

/** Fächer einer Möbelart als Quader in cm, lokal wie in storage.ts (x quer, y Höhe über Unterkante, z Tiefe, Front = +D/2) */
export interface ObjCompartment {
  label: string;
  kind: 'drawer' | 'shelf' | 'door' | 'open' | 'cold' | 'freezer';
  x0: number; x1: number; y0: number; y1: number; z0: number; z1: number;
}

/** Spalten (x-Bereiche) und Elemente (y-Bereiche) eines Korpus in cm – gemeinsam für 3D und Fächer */
export function korpusLayout(b: KorpusBuild, W: number, H: number) {
  const t = b.board;
  const inner0 = -W / 2 + t;
  const innerW = W - 2 * t - (b.columns.length - 1) * t;
  const totalC = b.columns.reduce((s, c) => s + c.size, 0);
  const y0 = b.plinth + t;
  // mit Arbeitsplatte endet der Korpus unter der Platte
  const y1 = H - (b.countertop?.thickness ?? 0) - t;
  let x = inner0;
  return b.columns.map((c) => {
    const w = (innerW * c.size) / totalC;
    const col = { x0: x, x1: x + w, elements: [] as { el: ObjElement; y0: number; y1: number }[] };
    x += w + t;
    const totalE = c.elements.reduce((s, e) => s + e.size, 0);
    let y = y1;
    for (const el of c.elements) {
      const h = ((y1 - y0) * el.size) / totalE;
      col.elements.push({ el, y0: y - h, y1: y });
      y -= h;
    }
    return col;
  });
}

const nth = (name: string, i: number, n: number) => (n === 1 ? name : `${name} ${i + 1}${i === 0 ? ' (oben)' : i === n - 1 ? ' (unten)' : ''}`);

/** Fächer einer Möbelart (Reihenfolge = Zeile im Lager: Spalte für Spalte von links, darin von oben nach unten) */
export function objectCompartments(t: ObjectType, W: number, D: number, H: number): ObjCompartment[] {
  const b = t.build;
  if (b.type === 'modell') {
    return b.compartments.map((c) => ({
      label: c.label, kind: c.kind,
      x0: -W / 2 + c.box[0] * W, x1: -W / 2 + c.box[1] * W,
      y0: c.box[2] * H, y1: c.box[3] * H,
      z0: -D / 2 + c.box[4] * D, z1: -D / 2 + c.box[5] * D,
    }));
  }
  const cols = korpusLayout(b, W, H);
  const z0 = -D / 2 + (b.back ? b.board : 0);
  const z1 = D / 2;
  const out: ObjCompartment[] = [];
  const multi = cols.length > 1;
  cols.forEach((col, ci) => {
    const prefix = multi ? `${cols.length === 2 ? (ci === 0 ? 'Links' : 'Rechts') : `Spalte ${ci + 1}`} · ` : '';
    // gleiche Elementarten in der Spalte durchzählen (Schublade 1, 2 …)
    const counts = new Map<ElementKind, number>();
    for (const e of col.elements) counts.set(e.el.kind, (counts.get(e.el.kind) ?? 0) + 1);
    const seen = new Map<ElementKind, number>();
    for (const { el, y0, y1 } of col.elements) {
      const i = seen.get(el.kind) ?? 0;
      seen.set(el.kind, i + 1);
      const base = el.label || nth(ELEMENT_KINDS[el.kind], i, counts.get(el.kind)!);
      const kind = el.kind === 'drawer' ? 'drawer' : el.kind === 'open' ? 'open' : el.kind === 'cold' ? 'cold' : el.kind === 'freezer' ? 'freezer' : 'door';
      const n = el.kind === 'door' || el.kind === 'open' ? el.shelves ?? 1 : 1;
      const h = (y1 - y0) / n;
      for (let k = 0; k < n; k++) {
        out.push({ label: `${prefix}${n > 1 ? `${base} · ${nth('Boden', k, n)}` : base}`, kind, x0: col.x0, x1: col.x1, y0: y1 - h * (k + 1), y1: y1 - h * k, z0, z1 });
      }
    }
  });
  return out;
}
export const objectCompartmentCount = (t: ObjectType) => objectCompartments(t, t.size.width, t.size.depth, t.size.height).length;

// ---------------------------------------------------------------------------
// Vorlagen für den Editor (frei veränderbar; die eingebauten Möbel selbst bleiben unverändert)

const base = (id: string, name: string, group: string, size: ObjectType['size'], build: KorpusBuild, extra: Partial<ObjectType> = {}): ObjectType => ({
  format: OBJECT_FORMAT, id, name, group, version: '1.0', size, snapToWall: true, build, ...extra,
});
export const TEMPLATES: ObjectType[] = [
  base('eigene.regal', 'Regal offen', 'Schränke & Regale', { width: 80, depth: 35, height: 180, elevation: 0, widths: [40, 60, 80, 100] },
    { type: 'korpus', plinth: 0, board: 1.8, back: true, columns: [{ size: 1, elements: [{ kind: 'open', size: 1, shelves: 5 }] }] }),
  base('eigene.vorratsschrank', 'Vorratsschrank', 'Schränke & Regale', { width: 80, depth: 40, height: 200, elevation: 0 },
    { type: 'korpus', plinth: 8, board: 1.8, back: true, columns: [{ size: 1, elements: [{ kind: 'door', size: 1, shelves: 5 }] }] }),
  base('eigene.kommode', 'Kommode', 'Schränke & Regale', { width: 80, depth: 45, height: 90, elevation: 0 },
    { type: 'korpus', plinth: 8, board: 1.8, back: true, columns: [{ size: 1, elements: [{ kind: 'drawer', size: 1 }, { kind: 'drawer', size: 1 }, { kind: 'drawer', size: 1 }, { kind: 'drawer', size: 1 }] }] }),
  base('eigene.unterschrank', 'Unterschrank Schubladen', 'Unterschränke', { width: 60, depth: 60, height: 90, elevation: 0, widths: [40, 60, 80] },
    { type: 'korpus', plinth: 10, board: 1.8, back: true, columns: [{ size: 1, elements: [{ kind: 'drawer', size: 1 }, { kind: 'drawer', size: 1.5 }, { kind: 'drawer', size: 1.5 }] }] }),
  base('eigene.kleiderschrank', 'Kleiderschrank', 'Schränke & Regale', { width: 100, depth: 60, height: 220, elevation: 0 },
    { type: 'korpus', plinth: 5, board: 1.8, back: true, columns: [{ size: 1, elements: [{ kind: 'door', size: 1, shelves: 5 }] }, { size: 1, elements: [{ kind: 'door', size: 1, shelves: 5 }] }] }),
  base('eigene.oberschrank', 'Oberschrank', 'Oberschränke', { width: 60, depth: 35, height: 72, elevation: 145 },
    { type: 'korpus', plinth: 0, board: 1.8, back: true, columns: [{ size: 1, elements: [{ kind: 'door', size: 1, shelves: 2 }] }] }),
];

/** Neue, eindeutige Kennung für eine Kopie */
export function copyId(id: string, taken: Set<string>) {
  const stem = `eigene.${id.replace(/^[^.]*\./, '').replace(/-\d+$/, '')}`;
  let n = 2;
  let next = stem;
  while (taken.has(next)) next = `${stem}-${n++}`;
  return next;
}

/** Versionen vergleichen: > 0 wenn a neuer ist als b */
export function compareVersions(a: string, b: string) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}
