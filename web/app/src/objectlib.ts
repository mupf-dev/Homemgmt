// Objektbibliothek in der App: Möbelarten vom Server laden (für Katalog und Hausplan), Symbol aus der Beschreibung,
// Export als Datei. Die Seiten zum Verwalten liegen in lager/objects.ts.

import { setLibraryObjects } from './model/catalog.ts';
import { korpusLayout, type ObjectType } from './model/objects.ts';

export interface LibraryRow {
  object: ObjectType;
  source: 'eigene' | 'community' | 'datei';
  sourceUrl: string | null;
  hidden: boolean;
  updatedAt: string;
}

let rows: LibraryRow[] = [];
export const libraryRows = () => rows;

/** Bibliothek vom Server holen und bekannt machen (ausgeblendete nicht im Katalog) */
export async function loadLibrary() {
  const r = await fetch('/api/objects', { credentials: 'same-origin' }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
  rows = r?.objects ?? [];
  setLibraryObjects(rows.filter((x) => !x.hidden).map((x) => x.object));
  document.dispatchEvent(new CustomEvent('zh-objects'));
  return rows;
}

/** Vorderansicht als kleines SVG (Spalten, Schubladen, Türen, Böden) */
export function objectIcon(t: ObjectType, w = 60, h = 40) {
  const s = 'stroke="currentColor" fill="none" stroke-width="1.3"';
  if (t.build.type === 'modell') return `<svg viewBox="0 0 ${w} ${h}"><path d="M${w / 2} 4 ${w / 2 + 14} 11v16l-14 8-14-8V11z M${w / 2 - 14} 11l14 8 14-8M${w / 2} 19v16" ${s}/></svg>`;
  const W = t.size.width;
  const H = t.size.height;
  const k = Math.min((w - 4) / W, (h - 4) / H);
  const ox = (w - W * k) / 2;
  const oy = (h - H * k) / 2;
  const X = (x: number) => (ox + (x + W / 2) * k).toFixed(1);
  const Y = (y: number) => (oy + (H - y) * k).toFixed(1);
  let d = `<rect x="${X(-W / 2)}" y="${Y(H)}" width="${(W * k).toFixed(1)}" height="${(H * k).toFixed(1)}" ${s}/>`;
  const ct = t.build.countertop;
  if (ct) d += `<rect x="${X(-W / 2 - 1)}" y="${Y(H)}" width="${((W + 2) * k).toFixed(1)}" height="${Math.max(1.5, ct.thickness * k).toFixed(1)}" fill="currentColor"/>`;
  for (const col of korpusLayout(t.build, W, H)) {
    for (const { el, y0, y1 } of col.elements) {
      d += `<rect x="${X(col.x0)}" y="${Y(y1)}" width="${((col.x1 - col.x0) * k).toFixed(1)}" height="${((y1 - y0) * k).toFixed(1)}" ${s}/>`;
      const cx = (col.x0 + col.x1) / 2;
      if (el.kind === 'drawer' || el.kind === 'flap') d += `<path d="M${X(cx - 3)} ${Y(y1 - (y1 - y0) * 0.25)}h${(6 * k * 10) / 10}" ${s}/>`;
      if (el.kind === 'open') for (let i = 1; i < (el.shelves ?? 1); i++) d += `<path d="M${X(col.x0)} ${Y(y1 - ((y1 - y0) * i) / (el.shelves ?? 1))}H${X(col.x1)}" ${s} stroke-dasharray="2 1.5"/>`;
      if (el.kind === 'door' || el.kind === 'cold' || el.kind === 'freezer') d += `<path d="M${X(col.x1 - 4)} ${Y((y0 + y1) / 2 + 4)}v${(8 * k).toFixed(1)}" ${s}/>`;
    }
  }
  return `<svg viewBox="0 0 ${w} ${h}">${d}</svg>`;
}

/** Möbelart als Datei speichern (.zuhause-objekt.json) */
export function downloadObject(t: ObjectType) {
  const { ...clean } = t;
  // lokale Modell-Adresse gehört nicht in die Datei (andere Installationen haben das Modell nicht)
  const out = clean.build.type === 'modell' ? { ...clean, build: { ...clean.build, model: { ...clean.build.model, url: undefined } } } : clean;
  const blob = new Blob([JSON.stringify(out, null, 2) + '\n'], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${t.id}.zuhause-objekt.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
