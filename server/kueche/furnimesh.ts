// 3D-Möbel von FurniMesh (furnimesh.com) – öffentliche Bibliotheksseiten, ohne Konto und ohne API-Schlüssel.
// Die Seiten werden gelesen (robots.txt erlaubt /library/, ihre /api/ ist tabu), die GLB-Dateien einmal geladen,
// verkleinert (Texturen 1024 px JPEG, Geometrie ausgedünnt) und auf typische Maße der Kategorie skaliert –
// die KI-erzeugten Modelle haben keine echten Maße. Eine ausdrückliche Lizenz nennt FurniMesh nicht
// („All GLB downloads are free with no signup“); Quelle und Link werden beim Modell vermerkt.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'https://furnimesh.com';
const UA = { 'user-agent': 'Mozilla/5.0 (compatible; Zuhause-Hausplaner/0.5; Bibliothek)' };
export const FM_ID_RE = /^[a-z-]{2,30}\/[a-z0-9-]{2,40}\/[a-z0-9-]{3,140}$/;

/** Kategorien der Auswahl → FurniMesh-Bereiche */
export const FM_CATEGORIES: Record<string, string> = {
  sitzen: 'seating', sofas: 'sofas', tische: 'tables', betten: 'beds', schraenke: 'storage', leuchten: 'lighting', bad: 'bathroom',
};

/** Typische Maße (cm: Breite, Tiefe, Höhe) je Unterkategorie – das Modell wird gleichmäßig auf diese Breite skaliert */
const TYPICAL: Record<string, [number, number, number]> = {
  sofa: [220, 95, 85], sectional: [280, 180, 85], loveseat: [160, 90, 85], 'sofa-bed': [210, 100, 90], armchair: [85, 85, 90],
  chair: [50, 55, 85], 'dining-chair': [55, 58, 85], 'office-chair': [65, 65, 110], 'bar-stool': [45, 45, 100], stool: [40, 40, 45],
  bench: [150, 45, 45], ottoman: [70, 70, 45], pouf: [50, 50, 40], 'dining-table': [160, 90, 75], 'coffee-table': [110, 60, 45],
  'side-table': [50, 50, 55], 'console-table': [120, 35, 80], table: [140, 80, 75], desk: [140, 70, 75], bed: [180, 210, 90],
  nightstand: [50, 40, 55], 'floor-lamp': [40, 40, 160], 'table-lamp': [30, 30, 50], 'wall-lamp': [25, 20, 30], pendant: [45, 45, 40],
  chandelier: [70, 70, 60], shelving: [80, 35, 180], bookcase: [80, 35, 200], cabinet: [100, 45, 90], sideboard: [180, 45, 80],
  dresser: [120, 50, 90], wardrobe: [120, 60, 210], 'tv-stand': [160, 40, 50], sink: [60, 45, 85], vanity: [80, 50, 85],
  bathtub: [170, 75, 60], toilet: [40, 65, 80], mirror: [60, 5, 80],
};
const SUB_DE: Record<string, string> = {
  sofa: 'Sofa', sectional: 'Ecksofa', loveseat: 'Zweisitzer', armchair: 'Sessel', chair: 'Stuhl', 'dining-chair': 'Esszimmerstuhl',
  'office-chair': 'Bürostuhl', 'bar-stool': 'Barhocker', stool: 'Hocker', bench: 'Bank', ottoman: 'Hocker', 'dining-table': 'Esstisch',
  'coffee-table': 'Couchtisch', 'side-table': 'Beistelltisch', 'console-table': 'Konsole', table: 'Tisch', desk: 'Schreibtisch',
  bed: 'Bett', nightstand: 'Nachttisch', 'floor-lamp': 'Stehleuchte', 'table-lamp': 'Tischleuchte', 'wall-lamp': 'Wandleuchte',
  pendant: 'Pendelleuchte', chandelier: 'Kronleuchter', shelving: 'Regal', bookcase: 'Bücherregal', cabinet: 'Schrank',
  sideboard: 'Sideboard', dresser: 'Kommode', wardrobe: 'Kleiderschrank', 'tv-stand': 'TV-Möbel', sink: 'Waschbecken',
  vanity: 'Waschtisch', bathtub: 'Badewanne', toilet: 'WC', mirror: 'Spiegel',
};

export interface FmHit { id: string; name: string; thumb: string; categories: string[]; size: [number, number, number] | null; source: 'furnimesh' }

const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** Kurzer Name aus der langen Beschreibung: „A modern armchair featuring …“ → „Sessel · modern armchair“ */
function shortName(sub: string, alt: string) {
  let d = decode(alt).replace(/\s+—\s+free.*$/i, '').replace(/…$/, '').trim();
  d = d.replace(/^(a|an|the|pair of)\s+/i, '').split(/\s+(featuring|with|that|crafted|constructed|made|in|on|and|showcasing|characterized)\s+|[,.;]/i)[0];
  const de = SUB_DE[sub] ?? sub.replace(/-/g, ' ');
  return `${de} · ${d.slice(0, 48)}`;
}

/** Modellkarten aus einer Bibliotheksseite: Link, Beschreibung, Vorschaubild */
export function parseCards(html: string): FmHit[] {
  const out: FmHit[] = [];
  const seen = new Set<string>();
  const re = /<a\b[^>]*href="\/library\/([a-z-]+)\/([a-z0-9-]+)\/([a-z0-9-]+)\/"[^>]*>/g;
  for (let m; (m = re.exec(html)); ) {
    const [, cat, sub, slug] = m;
    const id = `${cat}/${sub}/${slug}`;
    if (seen.has(id) || !FM_ID_RE.test(id) || cat === 'format') continue;
    const chunk = html.slice(m.index, m.index + 6000);
    const alt = /<img\b[^>]*\balt="([^"]*)"/.exec(chunk)?.[1];
    const img = /https%3A%2F%2Fstorage\.googleapis\.com%2Ffurnimesh-3d%2F[^&"]+/.exec(chunk)?.[0] ?? /https:\/\/storage\.googleapis\.com\/furnimesh-3d\/[^"&\s]+\.(?:png|jpe?g|webp)/.exec(chunk)?.[0];
    if (!alt || !img) continue;
    seen.add(id);
    const enc = img.startsWith('https%3A') ? img : encodeURIComponent(img);
    out.push({ id, name: shortName(sub, alt), thumb: `${BASE}/_next/image/?url=${enc}&w=256&q=65`, categories: [cat, sub], size: TYPICAL[sub] ?? null, source: 'furnimesh' });
  }
  return out;
}

const pageCache = new Map<string, { at: number; hits: FmHit[] }>();
async function page(url: string) {
  const c = pageCache.get(url);
  if (c && Date.now() - c.at < 6 * 3600_000) return c.hits;
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`FurniMesh antwortet mit ${r.status}`);
  const hits = parseCards(await r.text());
  pageCache.set(url, { at: Date.now(), hits });
  if (pageCache.size > 300) pageCache.delete(pageCache.keys().next().value!);
  return hits;
}

/** Suche (englische Begriffe) oder Kategorie; blättert Seite für Seite, bis genug Treffer da sind */
export async function searchFurniMesh(q: string, cat: string, limit: number, offset: number) {
  const area = FM_CATEGORIES[cat];
  if (cat && !area) return { total: 0, hits: [] as FmHit[], more: false, note: 'Diese Kategorie gibt es bei FurniMesh nicht.' };
  const url = (n: number) => {
    const p = n > 1 ? `page=${n}` : '';
    if (q) return `${BASE}/library/search/?q=${encodeURIComponent(q)}${p ? '&' + p : ''}`;
    return `${BASE}/library/${area ?? 'format/glb'}/${p ? '?' + p : ''}`;
  };
  const all: FmHit[] = [];
  let more = true;
  for (let n = 1; all.length < offset + limit && n <= 40; n++) {
    const hits = (await page(url(n))).filter((h) => !all.some((a) => a.id === h.id));
    if (!hits.length) {
      more = false;
      break;
    }
    // bei Suche nach Kategorie filtern, falls gewählt
    all.push(...(area && q ? hits.filter((h) => h.categories[0] === area) : hits));
    if (q && hits.length < 24) {
      more = false; // Suchseiten: letzte Seite erreicht
      break;
    }
  }
  return { total: all.length + (more ? 1 : 0), hits: all.slice(offset, offset + limit), more };
}

/** GLB laden, verkleinern, auf typische Breite skalieren und ablegen */
export async function importFurniMesh(modelDir: string, id: string, getBuffer: (url: string) => Promise<Buffer>) {
  if (!FM_ID_RE.test(id)) throw new Error('Ungültige Modell-ID');
  const [cat, sub, slug] = id.split('/');
  const dir = join(modelDir, 'furnimesh', slug);
  const metaFile = join(dir, 'meta.json');
  if (existsSync(metaFile)) return JSON.parse(readFileSync(metaFile, 'utf8'));
  const pageUrl = `${BASE}/library/${id}/`;
  const r = await fetch(pageUrl, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`FurniMesh antwortet mit ${r.status}`);
  const html = await r.text();
  const glb = /https:\/\/storage\.googleapis\.com\/furnimesh-3d\/gbl-files\/[A-Za-z0-9_-]+\.glb/.exec(html)?.[0];
  if (!glb) throw new Error('Für dieses Modell gibt es keine GLB-Datei.');
  const title = decode(/<meta\s+property="og:title"\s+content="([^"]*)"/.exec(html)?.[1] ?? '').replace(/\s*(3D Model)?\s*(—|\|).*$/i, '').replace(/\s*3D Model$/i, '').trim();
  const name = `${SUB_DE[sub] ?? sub.replace(/-/g, ' ')} · ${title || slug.replace(/-[a-z0-9]{6}$/, '').replace(/-/g, ' ')}`.slice(0, 80);
  const image = /<meta\s+property="og:image"\s+content="(https:\/\/storage\.googleapis\.com\/furnimesh-3d\/[^"]+)"/.exec(html)?.[1];

  const { NodeIO } = await import('@gltf-transform/core');
  const { dedup, prune, weld, simplify, textureCompress, getBounds } = await import('@gltf-transform/functions');
  const { MeshoptSimplifier } = await import('meshoptimizer');
  const sharp = (await import('sharp')).default;
  const io = new NodeIO();
  const doc = await io.readBinary(new Uint8Array(await getBuffer(glb)));
  await MeshoptSimplifier.ready;
  await doc.transform(dedup(), weld(), simplify({ simplifier: MeshoptSimplifier, ratio: 0.2, error: 0.001 }), prune(), textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [1024, 1024], quality: 82 }));
  // gleichmäßig skalieren: Breite (x) = typische Breite der Kategorie, Proportionen bleiben
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  const b = getBounds(scene);
  const w = b.max[0] - b.min[0];
  const want = (TYPICAL[sub]?.[0] ?? 80) / 100;
  const k = w > 1e-6 ? want / w : 1;
  for (const n of scene.listChildren()) {
    const s = n.getScale();
    const t = n.getTranslation();
    n.setScale([s[0] * k, s[1] * k, s[2] * k]);
    n.setTranslation([t[0] * k, t[1] * k, t[2] * k]);
  }
  const size: [number, number, number] = [Math.round(w * k * 100), Math.round((b.max[2] - b.min[2]) * k * 100), Math.round((b.max[1] - b.min[1]) * k * 100)];
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'model.glb'), await io.writeBinary(doc));
  let thumb: string | undefined;
  if (image) {
    try {
      writeFileSync(join(dir, 'thumb.jpg'), await sharp(await getBuffer(image)).resize(256, 256, { fit: 'contain', background: '#ffffff' }).jpeg({ quality: 80 }).toBuffer());
      thumb = `/library/models/furnimesh/${slug}/thumb.jpg`;
    } catch {
      /* ohne Vorschaubild */
    }
  }
  const meta = { source: 'furnimesh' as const, id, name, url: `/library/models/furnimesh/${slug}/model.glb`, thumb, size, license: `FurniMesh (frei herunterladbar, keine ausdrückliche Lizenz) · ${pageUrl}`, category: cat };
  writeFileSync(metaFile, JSON.stringify(meta));
  return meta;
}
