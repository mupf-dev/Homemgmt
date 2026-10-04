// Online-Materialbibliotheken (Poly Haven, ambientCG – beide CC0).
// Suche läuft über die öffentlichen APIs; beim Import werden Farb-, Normal- und Rauheitskarte
// einmalig heruntergeladen und unter DATA_DIR/library/<quelle>/<id>/<auflösung>/ abgelegt.

import { inflateRawSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { importFurniMesh, searchFurniMesh } from './furnimesh.ts';

export type Source = 'polyhaven' | 'ambientcg';
export type Resolution = '1k' | '2k';

export interface LibraryHit {
  source: Source;
  id: string;
  name: string;
  thumb: string;
  categories: string[];
  /** reale Kantenlänge in cm (falls bekannt) */
  sizeCm?: number;
}

export interface ImportedTexture {
  source: Source;
  id: string;
  name: string;
  res: Resolution;
  image: string;
  normalImage?: string;
  roughnessImage?: string;
  thumb: string;
  sizeCm: number;
  categories: string[];
  metal: boolean;
}

const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const UA = { 'user-agent': 'Kuechenplaner/1.0 (+https://kuechenplaner.example.org)' };

async function getJson(url: string) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`Bibliothek antwortet mit ${r.status}`);
  return r.json();
}

async function getBuffer(url: string, maxBytes = 120 * 1024 * 1024) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error(`Download fehlgeschlagen (${r.status})`);
  const len = Number(r.headers.get('content-length') ?? 0);
  if (len > maxBytes) throw new Error('Datei zu groß');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > maxBytes) throw new Error('Datei zu groß');
  return buf;
}

const matches = (q: string, ...fields: (string | string[] | undefined)[]) => {
  if (!q) return true;
  const hay = fields.flat().filter(Boolean).join(' ').toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
};

// ---------------------------------------------------------------------------
// Poly Haven

let phCache: { at: number; data: Record<string, any> } | null = null;

async function polyhavenAssets() {
  if (!phCache || Date.now() - phCache.at > 6 * 3600_000) {
    phCache = { at: Date.now(), data: await getJson('https://api.polyhaven.com/assets?t=textures') };
  }
  return phCache.data;
}

async function searchPolyHaven(q: string, limit: number, offset: number) {
  const all = await polyhavenAssets();
  const hits: LibraryHit[] = [];
  const entries = Object.entries(all).sort((a, b) => (b[1].download_count ?? 0) - (a[1].download_count ?? 0));
  for (const [id, a] of entries) {
    if (!matches(q, id, a.name, a.tags, a.categories)) continue;
    hits.push({
      source: 'polyhaven',
      id,
      name: a.name ?? id,
      thumb: `https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=256&height=256`,
      categories: a.categories ?? [],
      sizeCm: Array.isArray(a.dimensions) ? Math.round(Math.max(...a.dimensions) / 10) : undefined,
    });
  }
  return { total: hits.length, hits: hits.slice(offset, offset + limit) };
}

async function importPolyHaven(id: string, res: Resolution, dir: string) {
  const [files, info] = await Promise.all([getJson(`https://api.polyhaven.com/files/${id}`), getJson(`https://api.polyhaven.com/info/${id}`)]);
  const pick = (key: string) => files?.[key]?.[res]?.jpg?.url ?? files?.[key]?.[res]?.png?.url;
  const diff = pick('Diffuse') ?? pick('diffuse') ?? pick('Color');
  if (!diff) throw new Error('Keine Farbtextur in dieser Auflösung verfügbar');
  const nor = pick('nor_gl');
  const rough = pick('Rough') ?? pick('rough');
  writeFileSync(join(dir, 'diff.jpg'), await getBuffer(diff));
  if (nor) writeFileSync(join(dir, 'nor.jpg'), await getBuffer(nor));
  if (rough) writeFileSync(join(dir, 'rough.jpg'), await getBuffer(rough));
  writeFileSync(join(dir, 'thumb.png'), await getBuffer(`https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=160&height=160`));
  const dims: number[] = Array.isArray(info.dimensions) ? info.dimensions : [];
  return {
    name: info.name ?? id,
    sizeCm: dims.length ? Math.round(Math.max(...dims) / 10) : 100,
    categories: info.categories ?? [],
    files: { nor: !!nor, rough: !!rough, thumb: 'thumb.png' },
  };
}

// ---------------------------------------------------------------------------
// ambientCG

async function searchAmbientCG(q: string, limit: number, offset: number) {
  const url =
    `https://ambientcg.com/api/v2/full_json?type=Material&limit=${limit}&offset=${offset}&sort=Popular` +
    `&include=imageData,dimensionsData,tagData` +
    (q ? `&q=${encodeURIComponent(q)}` : '');
  const d = await getJson(url);
  const hits: LibraryHit[] = (d.foundAssets ?? []).map((a: any) => ({
    source: 'ambientcg' as const,
    id: a.assetId,
    name: a.displayName ?? a.assetId,
    thumb: a.previewImage?.['256-PNG'] ?? a.previewImage?.['128-PNG'],
    categories: [a.displayCategory, ...(a.tags ?? [])].filter(Boolean),
    sizeCm: a.dimensionX > 0 ? Math.round(a.dimensionX) : undefined,
  }));
  return { total: d.numberOfResults ?? hits.length, hits };
}

/** Minimaler ZIP-Leser: liefert die Dateien, deren Name auf eines der Suffixe endet */
function unzip(buf: Buffer, wanted: (name: string) => boolean) {
  const out = new Map<string, Buffer>();
  // End of Central Directory suchen
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Ungültiges ZIP-Archiv');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Ungültiges ZIP-Verzeichnis');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted(name)) continue;
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(start, start + compSize);
    if (method === 0) out.set(name, Buffer.from(data));
    else if (method === 8) out.set(name, inflateRawSync(data));
  }
  return out;
}

async function importAmbientCG(id: string, res: Resolution, dir: string) {
  const meta = await getJson(`https://ambientcg.com/api/v2/full_json?id=${encodeURIComponent(id)}&include=imageData,dimensionsData,tagData`);
  const a = meta.foundAssets?.[0];
  if (!a) throw new Error('Material nicht gefunden');
  const zip = await getBuffer(`https://ambientcg.com/get?file=${encodeURIComponent(id)}_${res.toUpperCase()}-JPG.zip`);
  const files = unzip(zip, (n) => /_(Color|NormalGL|Roughness|Metalness)\.(jpg|png)$/i.test(n));
  const find = (suffix: string) => [...files.entries()].find(([n]) => new RegExp(`_${suffix}\\.(jpg|png)$`, 'i').test(n))?.[1];
  const color = find('Color');
  if (!color) throw new Error('Keine Farbtextur im Archiv');
  writeFileSync(join(dir, 'diff.jpg'), color);
  const nor = find('NormalGL');
  const rough = find('Roughness');
  if (nor) writeFileSync(join(dir, 'nor.jpg'), nor);
  if (rough) writeFileSync(join(dir, 'rough.jpg'), rough);
  const thumbUrl = a.previewImage?.['128-PNG'] ?? a.previewImage?.['256-PNG'];
  if (thumbUrl) writeFileSync(join(dir, 'thumb.png'), await getBuffer(thumbUrl));
  return {
    name: a.displayName ?? id,
    sizeCm: a.dimensionX > 0 ? Math.round(a.dimensionX) : 100,
    categories: [a.displayCategory, ...(a.tags ?? [])].filter(Boolean),
    files: { nor: !!nor, rough: !!rough, thumb: thumbUrl ? 'thumb.png' : 'diff.jpg', metal: !!find('Metalness') },
  };
}

// ---------------------------------------------------------------------------
// 3D-Modelle (Möbel, Deko, Leuchten, Pflanzen …) von Poly Haven – CC0, glTF mit PBR-Texturen

export interface ModelHit {
  id: string;
  name: string;
  thumb: string;
  categories: string[];
  /** Maße in cm: Breite (x), Tiefe (y), Höhe (z) */
  size: [number, number, number] | null;
}
export interface ImportedModel {
  source: 'polyhaven' | 'eigene' | 'furnimesh';
  id: string;
  name: string;
  url: string;
  thumb?: string;
  size: [number, number, number] | null;
  license: string;
}

/** Kategorien für die Auswahl (deutsch) → Poly-Haven-Kategorien */
export const MODEL_CATEGORIES: Record<string, string[]> = {
  sitzen: ['seating'],
  tische: ['table'],
  betten: ['bed'],
  schraenke: ['shelves'],
  leuchten: ['lighting'],
  pflanzen: ['plants'],
  deko: ['decorative'],
  kueche: ['dishes', 'food', 'appliances'],
  elektronik: ['electronics'],
  buero: ['office'],
  aufbewahrung: ['containers'],
  werkzeug: ['tools'],
  garten: ['plants', 'flowers', 'potted plants', 'trees', 'nature', 'rocks', 'ground cover', 'grass'],
  sonstiges: ['props', 'industrial', 'structures', 'instrument', 'books', 'vases', 'wall decoration'],
};
/** Deutsche Suchbegriffe → englische Begriffe der Bibliothek (Poly Haven ist englisch verschlagwortet) */
const DE_EN: Record<string, string> = {
  stuhl: 'chair', stühle: 'chair', sessel: 'armchair', sofa: 'sofa', couch: 'sofa', hocker: 'stool', bank: 'bench', tisch: 'table',
  schreibtisch: 'desk', bett: 'bed', schrank: 'cabinet', regal: 'shelf', kommode: 'drawer', lampe: 'lamp', leuchte: 'lamp',
  pflanze: 'plant', blume: 'flower', topf: 'pot', vase: 'vase', kiste: 'crate', korb: 'basket', box: 'box', fass: 'barrel',
  uhr: 'clock', spiegel: 'mirror', teppich: 'rug', buch: 'book', bücher: 'book', bild: 'frame', fernseher: 'tv', radio: 'radio',
  computer: 'computer', telefon: 'phone', tasse: 'mug', teller: 'plate', schüssel: 'bowl', flasche: 'bottle', glas: 'glass',
  kanne: 'kettle', besteck: 'cutlery', obst: 'fruit', werkzeug: 'tool', hammer: 'hammer', säge: 'saw', leiter: 'ladder',
  eimer: 'bucket', baum: 'tree', stein: 'rock', holz: 'wood', kerze: 'candle', gitarre: 'guitar', klavier: 'piano', koffer: 'suitcase',
};
const translate = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean).map((w) => DE_EN[w] ?? w).join(' ');
const INTERIOR = new Set(['furniture', 'decorative', 'lighting', 'plants', 'appliances', 'dishes', 'electronics', 'seating', 'table', 'shelves', 'bed', 'office', 'containers', 'food']);
const OUTDOOR = new Set(['nature', 'rocks', 'trees', 'ground cover', 'structures', 'buildings', 'industrial']);

let phModels: { at: number; data: Record<string, any> } | null = null;
async function polyhavenModels() {
  if (!phModels || Date.now() - phModels.at > 6 * 3600_000) phModels = { at: Date.now(), data: await getJson('https://api.polyhaven.com/assets?t=models') };
  return phModels.data;
}
const sizeOf = (dims: unknown): [number, number, number] | null =>
  Array.isArray(dims) && dims.length === 3 ? [Math.round(dims[0] / 10), Math.round(dims[1] / 10), Math.round(dims[2] / 10)] : null;

/** Suche; ohne Kategorie und ohne `all` nur Einrichtung (keine Felsen, Bäume, Industrie …) */
async function searchModels(q: string, cat: string, limit: number, offset: number, everything = false, source = 'polyhaven') {
  if (source === 'furnimesh') return searchFurniMesh(translate(q), cat, limit, offset);
  const all = await polyhavenModels();
  const want = MODEL_CATEGORIES[cat];
  q = translate(q);
  const hits: ModelHit[] = [];
  for (const [id, a] of Object.entries(all).sort((x, y) => (y[1].download_count ?? 0) - (x[1].download_count ?? 0))) {
    const cats: string[] = a.categories ?? [];
    const interior = cats.some((c) => INTERIOR.has(c)) && !(cats.some((c) => OUTDOOR.has(c)) && !cats.includes('furniture'));
    if (!interior && !want && !everything) continue;
    if (want && !cats.some((c) => want.includes(c))) continue;
    if (!matches(q, id, a.name, a.tags, cats)) continue;
    hits.push({ id, name: a.name ?? id, thumb: `https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=256&height=256`, categories: cats, size: sizeOf(a.dimensions) });
  }
  return { total: hits.length, hits: hits.slice(offset, offset + limit) };
}

export function createLibrary(dataDir: string) {
  const root = join(dataDir, 'library');
  mkdirSync(root, { recursive: true });
  const inFlight = new Map<string, Promise<ImportedTexture>>();

  async function search(source: Source, q: string, limit = 48, offset = 0) {
    limit = Math.min(96, Math.max(1, limit));
    offset = Math.max(0, offset);
    return source === 'polyhaven' ? searchPolyHaven(q, limit, offset) : searchAmbientCG(q, limit, offset);
  }

  function toResult(source: Source, id: string, res: Resolution, meta: any): ImportedTexture {
    const base = `/library/${source}/${id}/${res}`;
    const cats: string[] = meta.categories ?? [];
    return {
      source,
      id,
      res,
      name: meta.name,
      image: `${base}/diff.jpg`,
      normalImage: meta.files.nor ? `${base}/nor.jpg` : undefined,
      roughnessImage: meta.files.rough ? `${base}/rough.jpg` : undefined,
      thumb: `${base}/${meta.files.thumb}`,
      sizeCm: meta.sizeCm,
      categories: cats,
      metal: !!meta.files.metal || cats.some((c) => /metal/i.test(c)),
    };
  }

  async function importTexture(source: Source, id: string, res: Resolution): Promise<ImportedTexture> {
    if (source !== 'polyhaven' && source !== 'ambientcg') throw new Error('Unbekannte Bibliothek');
    if (!ID_RE.test(id)) throw new Error('Ungültige Material-ID');
    if (res !== '1k' && res !== '2k') throw new Error('Ungültige Auflösung');
    const dir = join(root, source, id, res);
    const metaFile = join(dir, 'meta.json');
    if (existsSync(metaFile)) return toResult(source, id, res, JSON.parse(readFileSync(metaFile, 'utf8')));
    const key = `${source}/${id}/${res}`;
    let job = inFlight.get(key);
    if (!job) {
      job = (async () => {
        mkdirSync(dir, { recursive: true });
        const meta = source === 'polyhaven' ? await importPolyHaven(id, res, dir) : await importAmbientCG(id, res, dir);
        writeFileSync(metaFile, JSON.stringify(meta));
        return toResult(source, id, res, meta);
      })().finally(() => inFlight.delete(key));
      inFlight.set(key, job);
    }
    return job;
  }

  // --- 3D-Modelle ---
  const modelDir = join(root, 'models');
  const modelJobs = new Map<string, Promise<ImportedModel>>();
  const safeRel = (rel: string) => {
    if (!/^[A-Za-z0-9_./-]+$/.test(rel) || rel.split('/').some((p) => p === '..' || p === '')) throw new Error(`Ungültiger Dateipfad im Modell: ${rel}`);
    return rel;
  };

  async function importModel(id: string, res: Resolution = '1k'): Promise<ImportedModel> {
    if (!ID_RE.test(id)) throw new Error('Ungültige Modell-ID');
    if (res !== '1k' && res !== '2k') throw new Error('Ungültige Auflösung');
    const dir = join(modelDir, 'polyhaven', id, res);
    const metaFile = join(dir, 'meta.json');
    if (existsSync(metaFile)) return JSON.parse(readFileSync(metaFile, 'utf8'));
    const key = `${id}/${res}`;
    let job = modelJobs.get(key);
    if (!job) {
      job = (async () => {
        const [files, info] = await Promise.all([getJson(`https://api.polyhaven.com/files/${id}`), getJson(`https://api.polyhaven.com/info/${id}`)]);
        const g = files?.gltf?.[res]?.gltf;
        if (!g?.url) throw new Error('Kein glTF in dieser Auflösung verfügbar');
        mkdirSync(dir, { recursive: true });
        const main = safeRel(g.url.split('/').pop());
        writeFileSync(join(dir, main), await getBuffer(g.url));
        for (const [rel, f] of Object.entries<any>(g.include ?? {})) {
          const target = join(dir, safeRel(rel));
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, await getBuffer(f.url));
        }
        writeFileSync(join(dir, 'thumb.png'), await getBuffer(`https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=256&height=256`));
        const meta: ImportedModel = {
          source: 'polyhaven', id, name: info.name ?? id, url: `/library/models/polyhaven/${id}/${res}/${main}`,
          thumb: `/library/models/polyhaven/${id}/${res}/thumb.png`, size: sizeOf(info.dimensions),
          license: `CC0 · Poly Haven${info.authors ? ` · ${Object.keys(info.authors).join(', ')}` : ''}`,
        };
        writeFileSync(metaFile, JSON.stringify(meta));
        return meta;
      })().finally(() => modelJobs.delete(key));
      modelJobs.set(key, job);
    }
    return job;
  }

  /** FurniMesh-Modell: einmal laden und verkleinern (gleichzeitige Anfragen teilen sich den Download) */
  function importFurniMeshModel(id: string): Promise<ImportedModel> {
    const key = `fm:${id}`;
    let job = modelJobs.get(key);
    if (!job) {
      job = importFurniMesh(modelDir, id, (url) => getBuffer(url)).finally(() => modelJobs.delete(key));
      modelJobs.set(key, job);
    }
    return job;
  }

  /** Eigenes Modell (.glb, binäres glTF) – Name der Datei bleibt der Anzeigename */
  function uploadModel(buf: Buffer, name: string): ImportedModel {
    if (buf.length < 20 || buf.toString('latin1', 0, 4) !== 'glTF') throw new Error('Bitte ein Modell im Format .glb (binäres glTF) hochladen.');
    if (buf.length > 50 * 1024 * 1024) throw new Error('Das Modell ist größer als 50 MB.');
    const hash = createHash('sha256').update(buf).digest('hex').slice(0, 24);
    const dir = join(modelDir, 'eigene');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${hash}.glb`), buf);
    const clean = name.replace(/\.glb$/i, '').replace(/[^\p{L}\p{N} _.-]/gu, '').slice(0, 60) || 'Eigenes Modell';
    return { source: 'eigene', id: hash, name: clean, url: `/library/models/eigene/${hash}.glb`, size: null, license: 'eigenes Modell' };
  }

  return { root, search, importTexture, searchModels, importModel, importFurniMeshModel, uploadModel };
}
