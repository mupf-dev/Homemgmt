import * as THREE from 'three';
import type { ColorAdjust, MaterialDef, MaterialSlot, Project, UVSettings } from './model/types.ts';
import { generate } from './procedural';
import { isDarkSurface } from './model/objects.ts';

export const SLOT_LABELS: Record<MaterialSlot, string> = {
  front: 'Fronten',
  carcass: 'Korpus',
  countertop: 'Arbeitsplatte',
  handle: 'Griffe',
  channel: 'Griffmulden',
  sink: 'Spülbecken',
  backsplash: 'Nischenrückwand',
  floor: 'Boden',
  wall: 'Wände',
  ceiling: 'Decke',
  appliance: 'Gerätefarbe',
};

export const CATEGORY_LABELS: Record<MaterialDef['category'], string> = {
  lack: 'Lack',
  holz: 'Holz',
  stein: 'Stein & Keramik',
  metall: 'Metall',
  fliese: 'Fliesen',
  boden: 'Boden',
  wand: 'Wand',
  eigene: 'Eigene Texturen',
};

// Mitgelieferte Texturen liegen unter der Basis der App (/kueche/textures/…)
const TEX = `${import.meta.env.BASE_URL}textures/`;

export const LIBRARY: MaterialDef[] = [
  { id: 'lack-white', name: 'Weiß matt', category: 'lack', color: '#f1f0eb', roughness: 0.55, metalness: 0, tileSize: 100 },
  { id: 'appliance-white', name: 'Gerät weiß', category: 'lack', color: '#f3f3f1', roughness: 0.32, metalness: 0, clearcoat: 0.6, tileSize: 100 },
  { id: 'lack-white-gloss', name: 'Weiß Hochglanz', category: 'lack', color: '#f6f6f4', roughness: 0.12, metalness: 0, clearcoat: 1, tileSize: 100 },
  { id: 'lack-cashmere', name: 'Kaschmir', category: 'lack', color: '#d8cdbd', roughness: 0.5, metalness: 0, tileSize: 100 },
  { id: 'lack-magnolia', name: 'Magnolie matt', category: 'lack', color: '#ebe4d4', roughness: 0.6, metalness: 0, tileSize: 100 },
  { id: 'lack-sage', name: 'Salbeigrün', category: 'lack', color: '#8b9a86', roughness: 0.5, metalness: 0, tileSize: 100 },
  { id: 'lack-navy', name: 'Nachtblau', category: 'lack', color: '#26354a', roughness: 0.45, metalness: 0, tileSize: 100 },
  { id: 'lack-terracotta', name: 'Terrakotta', category: 'lack', color: '#a8644a', roughness: 0.55, metalness: 0, tileSize: 100 },
  { id: 'lack-anthracite', name: 'Anthrazit', category: 'lack', color: '#38393b', roughness: 0.5, metalness: 0, tileSize: 100 },
  { id: 'lack-black', name: 'Schwarz matt', category: 'lack', color: '#1b1b1c', roughness: 0.6, metalness: 0, tileSize: 100 },

  { id: 'wood-oak', name: 'Eiche natur', category: 'holz', color: '#c09a6b', roughness: 0.55, metalness: 0, procedural: 'oak', tileSize: 80, bump: 1 },
  { id: 'wood-oak-smoked', name: 'Eiche geräuchert', category: 'holz', color: '#7a5a3e', roughness: 0.55, metalness: 0, procedural: 'oak', tileSize: 80, bump: 1 },
  { id: 'wood-walnut', name: 'Nussbaum', category: 'holz', color: '#6b4a33', roughness: 0.45, metalness: 0, procedural: 'walnut', tileSize: 80, bump: 1 },
  { id: 'wood-ash-white', name: 'Esche weiß', category: 'holz', color: '#e1d8c8', roughness: 0.6, metalness: 0, procedural: 'oak', tileSize: 80, bump: 1 },

  { id: 'stone-marble', name: 'Marmor Carrara', category: 'stein', color: '#efeeeb', roughness: 0.18, metalness: 0, clearcoat: 0.4, procedural: 'marble', tileSize: 160, bump: 0.3 },
  { id: 'stone-nero', name: 'Nero Marquina', category: 'stein', color: '#1d1d1f', roughness: 0.15, metalness: 0, clearcoat: 0.5, procedural: 'marbleDark', tileSize: 160, bump: 0.3 },
  { id: 'ceramic-sky', name: 'Keramik Sky (Näherung)', category: 'stein', color: '#e6e7e6', roughness: 0.42, metalness: 0, procedural: 'ceramicCloud', tileSize: 160, bump: 0.2 },
  { id: 'stone-concrete', name: 'Beton', category: 'stein', color: '#9a9893', roughness: 0.7, metalness: 0, procedural: 'concrete', tileSize: 120, bump: 1 },
  { id: 'stone-granite', name: 'Granit schwarz', category: 'stein', color: '#2c2c2e', roughness: 0.25, metalness: 0, procedural: 'granite', tileSize: 60, bump: 0.3 },
  { id: 'stone-terrazzo', name: 'Terrazzo', category: 'stein', color: '#ece8e0', roughness: 0.3, metalness: 0, procedural: 'terrazzo', tileSize: 60 },
  { id: 'stone-quartz', name: 'Quarzstein weiß', category: 'stein', color: '#f3f2ef', roughness: 0.22, metalness: 0, procedural: 'plaster', tileSize: 60, bump: 0.2 },

  // Spülbecken-Werkstoffe (Granitverbund wie BLANCO Silgranit: feine Körnung, seidenmatt)
  { id: 'sink-silgranit-anthracite', name: 'Silgranit Anthrazit', category: 'stein', color: '#3b3b3d', roughness: 0.55, metalness: 0, procedural: 'granite', tileSize: 25, bump: 0.25 },
  { id: 'sink-silgranit-black', name: 'Silgranit Schwarz', category: 'stein', color: '#202022', roughness: 0.55, metalness: 0, procedural: 'granite', tileSize: 25, bump: 0.25 },
  { id: 'sink-silgranit-rock', name: 'Silgranit Felsgrau', category: 'stein', color: '#77736d', roughness: 0.55, metalness: 0, procedural: 'granite', tileSize: 25, bump: 0.25 },
  { id: 'sink-silgranit-white', name: 'Silgranit Weiß', category: 'stein', color: '#e8e6e1', roughness: 0.55, metalness: 0, procedural: 'granite', tileSize: 25, bump: 0.2 },
  { id: 'sink-silgranit-champagne', name: 'Silgranit Champagner', category: 'stein', color: '#cdbfa6', roughness: 0.55, metalness: 0, procedural: 'granite', tileSize: 25, bump: 0.2 },
  { id: 'metal-steel', name: 'Edelstahl gebürstet', category: 'metall', color: '#c9cacc', roughness: 0.32, metalness: 1, procedural: 'brushed', tileSize: 40, bump: 0.3 },
  { id: 'metal-brass', name: 'Messing gebürstet', category: 'metall', color: '#c6a15b', roughness: 0.3, metalness: 1, procedural: 'brushed', tileSize: 40, bump: 0.3 },
  { id: 'metal-alu', name: 'Aluminium eloxiert', category: 'metall', color: '#c3c5c8', roughness: 0.38, metalness: 1, procedural: 'brushed', tileSize: 60, bump: 0.15 },
  { id: 'metal-black', name: 'Schwarz matt', category: 'metall', color: '#222224', roughness: 0.5, metalness: 0.6, tileSize: 100 },
  { id: 'metal-chrome', name: 'Chrom', category: 'metall', color: '#e4e5e7', roughness: 0.06, metalness: 1, tileSize: 100 },
  { id: 'metal-copper', name: 'Kupfer', category: 'metall', color: '#b87350', roughness: 0.28, metalness: 1, tileSize: 100 },

  { id: 'tile-subway-white', name: 'Metrofliese weiß', category: 'fliese', color: '#f2f1ee', roughness: 0.15, metalness: 0, procedural: 'subway', tileSize: 30, bump: 1 },
  { id: 'tile-subway-green', name: 'Metrofliese grün', category: 'fliese', color: '#4f6b5a', roughness: 0.12, metalness: 0, procedural: 'subway', tileSize: 30, bump: 1 },
  { id: 'tile-subway-blue', name: 'Metrofliese blau', category: 'fliese', color: '#3d5574', roughness: 0.12, metalness: 0, procedural: 'subway', tileSize: 30, bump: 1 },

  // Scans echter Böden (Poly Haven, CC0) mit Relief- und Rauheitskarte
  { id: 'floor-vinyl-oak', name: 'Vinyl Eiche natur', category: 'boden', color: '#ffffff', roughness: 0.6, metalness: 0, image: TEX + 'laminate_floor_02/diff.jpg', normalImage: TEX + 'laminate_floor_02/nor.jpg', roughnessImage: TEX + 'laminate_floor_02/rough.jpg', thumb: TEX + 'laminate_floor_02/thumb.jpg', aspect: 1, tileSize: 170, bump: 0.8, mapping: 'tile' },
  { id: 'floor-vinyl-oak-rustic', name: 'Vinyl Eiche rustikal', category: 'boden', color: '#ffffff', roughness: 0.6, metalness: 0, image: TEX + 'laminate_floor_03/diff.jpg', normalImage: TEX + 'laminate_floor_03/nor.jpg', roughnessImage: TEX + 'laminate_floor_03/rough.jpg', thumb: TEX + 'laminate_floor_03/thumb.jpg', aspect: 1, tileSize: 208, bump: 0.8, mapping: 'tile' },
  { id: 'floor-oak-plank', name: 'Eichendiele geölt', category: 'boden', color: '#ffffff', roughness: 0.6, metalness: 0, image: TEX + 'wood_floor/diff.jpg', normalImage: TEX + 'wood_floor/nor.jpg', roughnessImage: TEX + 'wood_floor/rough.jpg', thumb: TEX + 'wood_floor/thumb.jpg', aspect: 1, tileSize: 170, bump: 0.8, mapping: 'tile' },
  { id: 'floor-parquet', name: 'Eichenparkett', category: 'boden', color: '#b48e62', roughness: 0.45, metalness: 0, procedural: 'parquet', tileSize: 120, bump: 1 },
  { id: 'floor-parquet-dark', name: 'Parkett dunkel', category: 'boden', color: '#5e4330', roughness: 0.4, metalness: 0, procedural: 'parquet', tileSize: 120, bump: 1 },
  { id: 'floor-tile-light', name: 'Fliese hell 60×60', category: 'boden', color: '#d9d5cd', roughness: 0.45, metalness: 0, procedural: 'floortile', tileSize: 120, bump: 1 },
  { id: 'floor-tile-dark', name: 'Fliese anthrazit 60×60', category: 'boden', color: '#4a4a4b', roughness: 0.45, metalness: 0, procedural: 'floortile', tileSize: 120, bump: 1 },
  { id: 'floor-concrete', name: 'Estrich geschliffen', category: 'boden', color: '#a19e98', roughness: 0.35, metalness: 0, procedural: 'concrete', tileSize: 200, bump: 0.6 },

  { id: 'wall-white', name: 'Weiß', category: 'wand', color: '#f4f3ef', roughness: 0.9, metalness: 0, tileSize: 100 },
  { id: 'wall-plaster', name: 'Putz warmweiß', category: 'wand', color: '#ebe5da', roughness: 0.92, metalness: 0, procedural: 'plaster', tileSize: 150, bump: 1 },
  { id: 'wall-greige', name: 'Greige', category: 'wand', color: '#cbc2b5', roughness: 0.9, metalness: 0, procedural: 'plaster', tileSize: 150, bump: 1 },
  { id: 'wall-forest', name: 'Waldgrün', category: 'wand', color: '#3e4d43', roughness: 0.9, metalness: 0, procedural: 'plaster', tileSize: 150, bump: 1 },
  { id: 'wall-concrete', name: 'Sichtbeton', category: 'wand', color: '#a5a39e', roughness: 0.85, metalness: 0, procedural: 'concrete', tileSize: 150, bump: 1 },
];

export function allMaterials(p: Project): MaterialDef[] {
  return [...LIBRARY, ...p.customMaterials];
}

/** Standard der Gerätefront (Waschmaschine/Trockner) */
export const APPLIANCE_WHITE = 'appliance-white';

/** Dunkle oder metallische Oberfläche (z. B. Gerätefront → Schwarzglas-Blende, Chromring) */
export function isDarkOrMetal(def: MaterialDef) {
  return isDarkSurface(adjustHex(def.color, def.adjust), def.metalness ?? 0);
}

export function findMaterial(p: Project, id: string): MaterialDef {
  return allMaterials(p).find((m) => m.id === id) ?? LIBRARY[0];
}

// ---------------------------------------------------------------------------
// Three.js-Materialfabrik mit Cache

const procCache = new Map<string, { color: THREE.Texture; normal: THREE.Texture; roughness?: THREE.Texture }>();
const imageCache = new Map<string, THREE.Texture>();
const matCache = new Map<string, THREE.MeshPhysicalMaterial>();

/** Seitenverhältnisse geladener Bilder (für ältere Materialien ohne gespeichertes Verhältnis) */
const aspectCache = new Map<string, number>();
const imgKey = (url: string) => url.length + ':' + url.slice(-64);

function textureFromImage(url: string, srgb: boolean): THREE.Texture {
  const key = imgKey(url) + srgb;
  let t = imageCache.get(key);
  if (t) return t;
  const img = new Image();
  t = new THREE.Texture(img);
  const tex = t;
  img.onload = () => {
    refreshClones(tex);
    aspectCache.set(imgKey(url), img.width / img.height);
    document.dispatchEvent(new CustomEvent('kp-texture-loaded'));
  };
  img.src = url;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  imageCache.set(key, t);
  return t;
}

// ---------------------------------------------------------------------------
// Farbanpassung

export function hasAdjust(a?: ColorAdjust) {
  return !!a && !!(a.hue || a.saturation || a.brightness || a.contrast || (a.tint && a.tintAmount));
}

/** Pixel-Funktion: RGB (0…1) anpassen – Farbton (YIQ-Drehung), Sättigung, Kontrast, Helligkeit, Tönung */
export function makeAdjuster(a: ColorAdjust, avgLum?: number) {
  const hue = ((a.hue ?? 0) * Math.PI) / 180;
  const sat = 1 + (a.saturation ?? 0) / 100;
  const con = 1 + (a.contrast ?? 0) / 100;
  const bri = (a.brightness ?? 0) / 100;
  const tAmt = a.tint ? (a.tintAmount ?? 0) / 100 : 0;
  // Farbwerte der Bilder liegen in sRGB vor – die Wahlfarbe ebenfalls als sRGB verwenden
  const tn = parseInt((a.tint ?? '#ffffff').replace('#', ''), 16);
  const tcLin: [number, number, number] = [((tn >> 16) & 255) / 255, ((tn >> 8) & 255) / 255, (tn & 255) / 255];
  const cosH = Math.cos(hue), sinH = Math.sin(hue);
  return (r: number, g: number, b: number): [number, number, number] => {
    // Farbton drehen im YIQ-Raum
    if (hue) {
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      let i = 0.596 * r - 0.274 * g - 0.322 * b;
      let q = 0.211 * r - 0.523 * g + 0.312 * b;
      const i2 = i * cosH - q * sinH;
      q = i * sinH + q * cosH;
      i = i2;
      r = y + 0.956 * i + 0.621 * q;
      g = y - 0.272 * i - 0.647 * q;
      b = y - 1.106 * i + 1.703 * q;
    }
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r = l + (r - l) * sat;
    g = l + (g - l) * sat;
    b = l + (b - l) * sat;
    r = (r - 0.5) * con + 0.5;
    g = (g - 0.5) * con + 0.5;
    b = (b - 0.5) * con + 0.5;
    if (bri > 0) {
      r += (1 - r) * bri;
      g += (1 - g) * bri;
      b += (1 - b) * bri;
    } else if (bri < 0) {
      r *= 1 + bri;
      g *= 1 + bri;
      b *= 1 + bri;
    }
    if (tAmt) {
      // Einfärben wie mit Farbe: Zielfarbe = gewählte Farbe, die Struktur der Textur bleibt
      // als relative Hell-/Dunkel-Abweichung vom Durchschnitt erhalten.
      const l2 = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const rel = avgLum && avgLum > 0.02 ? l2 / avgLum : 1;
      const k = 1 + (rel - 1) * 0.85;
      r = r + (tcLin[0] * k - r) * tAmt;
      g = g + (tcLin[1] * k - g) * tAmt;
      b = b + (tcLin[2] * k - b) * tAmt;
    }
    const c = (v: number) => Math.max(0, Math.min(1, v));
    return [c(r), c(g), c(b)];
  };
}

/** Grundfarbe (Hex, sRGB) anpassen */
export function adjustHex(hex: string, a?: ColorAdjust) {
  if (!hasAdjust(a)) return hex;
  const n = parseInt(hex.replace('#', ''), 16);
  const [r, g, b] = makeAdjuster(a!)(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  return '#' + [r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}

/** Bild/Canvas mit Anpassung in ein neues Canvas zeichnen (max. Kantenlänge begrenzt) */
export function adjustCanvas(src: CanvasImageSource & { width: number; height: number }, a: ColorAdjust, maxSize = 2048) {
  const s = Math.min(1, maxSize / Math.max(src.width, src.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(src.width * s));
  c.height = Math.max(1, Math.round(src.height * s));
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  // durchschnittliche Helligkeit nach den übrigen Anpassungen (für das Einfärben)
  const pre = makeAdjuster({ ...a, tintAmount: 0 });
  let sum = 0;
  let n = 0;
  const step = Math.max(4, Math.floor(d.length / 4 / 20000) * 4);
  for (let i = 0; i < d.length; i += step) {
    const [r, g, b] = pre(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255);
    sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    n++;
  }
  const f = makeAdjuster(a, n ? sum / n : undefined);
  for (let i = 0; i < d.length; i += 4) {
    const [r, g, b] = f(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255);
    d[i] = r * 255;
    d[i + 1] = g * 255;
    d[i + 2] = b * 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const adjustedCache = new Map<string, THREE.Texture>();

/** angepasste Farbtextur – bei Bildern asynchron, sobald das Bild geladen ist */
function adjustedTexture(def: MaterialDef): THREE.Texture {
  const key = JSON.stringify([def.image ? def.image.length + def.image.slice(-40) : def.procedural + def.color, def.adjust]);
  let t = adjustedCache.get(key);
  if (t) return t;
  if (def.procedural) {
    const src = proceduralTextures(def).color.image as HTMLCanvasElement;
    t = new THREE.CanvasTexture(adjustCanvas(src, def.adjust!));
  } else {
    // Bis das Bild geladen ist, bleibt das (noch unvollständige) Bild die Quelle – three.js lädt dann
    // nichts hoch. Ein Platzhalter-Canvas würde die GPU-Textur in falscher Größe fest anlegen (schwarz).
    const img = new Image();
    t = new THREE.Texture(img);
    const tex = t;
    img.onload = () => {
      tex.image = adjustCanvas(img, def.adjust!, 4096);
      refreshClones(tex);
      aspectCache.set(imgKey(def.image!), img.width / img.height);
      document.dispatchEvent(new CustomEvent('kp-texture-loaded'));
    };
    img.src = def.image!;
  }
  t.colorSpace = THREE.SRGBColorSpace;
  adjustedCache.set(key, t);
  return t;
}

function proceduralTextures(def: MaterialDef) {
  const key = def.procedural + def.color;
  let r = procCache.get(key);
  if (r) return r;
  const res = generate(def.procedural!, def.color);
  const color = new THREE.CanvasTexture(res.color);
  color.colorSpace = THREE.SRGBColorSpace;
  const normal = new THREE.CanvasTexture(res.normal);
  const roughness = res.roughness ? new THREE.CanvasTexture(res.roughness) : undefined;
  r = { color, normal, roughness };
  procCache.set(key, r);
  return r;
}

/** Fläche, auf die eine Textur im Modus „strecken“ eingepasst wird (UV-Koordinaten in Metern) */
export interface UVExtent {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  /** Waagerechte Fläche (v zeigt nach vorn) – Bild so ausrichten, dass es von vorn lesbar ist */
  horizontal?: boolean;
}

export function materialAspect(def: MaterialDef) {
  if (!def.image) return 1;
  return def.aspect ?? aspectCache.get(imgKey(def.image)) ?? 1;
}

/**
 * Textur-Matrix aus Materialgröße, Darstellungsmodus und Element-Einstellungen.
 * Die Mesh-UVs liegen in Metern (Box-Projektion), die Matrix bildet sie auf Bildkoordinaten ab.
 */
export function uvMatrix(def: MaterialDef, s?: UVSettings, extent?: UVExtent) {
  const mode = s?.mode ?? def.mapping ?? 'tile';
  const rotDeg = (s?.rotation ?? 0) + (def.rotation ?? (def.rotate ? 90 : 0));
  const rot = (rotDeg * Math.PI) / 180;
  const scale = Math.max(0.01, s?.scale ?? 1);
  const offX = (s?.offsetX ?? 0) / 100;
  const offY = (s?.offsetY ?? 0) / 100;
  const T = (x: number, y: number) => new THREE.Matrix3().set(1, 0, x, 0, 1, y, 0, 0, 1);
  const S = (x: number, y: number) => new THREE.Matrix3().set(x, 0, 0, 0, y, 0, 0, 0, 1);
  const R = (a: number) => new THREE.Matrix3().set(Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1);
  // waagerechte Flächen: v zeigt nach vorn -> spiegeln, damit das Bild von vorn betrachtet aufrecht steht
  const F = S(1, extent?.horizontal ? -1 : 1);
  const m = new THREE.Matrix3();
  if (mode === 'stretch' && extent && extent.u1 > extent.u0 && extent.v1 > extent.v0) {
    const du = extent.u1 - extent.u0;
    const dv = extent.v1 - extent.v0;
    const cu = (extent.u0 + extent.u1) / 2;
    const cv = (extent.v0 + extent.v1) / 2;
    // Umriss der Fläche im gedrehten Bildsystem -> Bild genau darauf einpassen
    const c = Math.abs(Math.cos(rot));
    const sn = Math.abs(Math.sin(rot));
    const w = du * c + dv * sn;
    const h = du * sn + dv * c;
    m.copy(T(0.5 + offX, 0.5 + offY)).multiply(S(1 / (w * scale), 1 / (h * scale))).multiply(R(-rot)).multiply(F).multiply(T(-cu, -cv));
  } else {
    const tw = (Math.max(1, def.tileSize) / 100) * scale;
    const th = tw / materialAspect(def);
    m.copy(T(offX, offY)).multiply(S(1 / tw, 1 / th)).multiply(R(-rot)).multiply(F);
  }
  return m;
}

/** Element-Einstellungen überschreiben die Projekt-Einstellungen feldweise */
export function mergeUV(base?: UVSettings, over?: UVSettings): UVSettings | undefined {
  if (!base) return over;
  if (!over) return base;
  return { ...base, ...over };
}

/**
 * Überträgt eine UV-Matrix in offset/repeat/rotation der Textur.
 * Wichtig: Der Pathtracer setzt beim Umkopieren der Bilder `matrixAutoUpdate` zurück und
 * berechnet die Matrix aus diesen Werten neu – eine direkt gesetzte Matrix ginge dabei verloren.
 * Three.js bildet (mit center = 0) ab: L = S(repeat) · R(−rotation), Translation = offset.
 * uvMatrix erzeugt nur Matrizen dieser Form (Skalierung nach Drehung), daher für jeden Winkel exakt.
 */
function applyMatrix(t: THREE.Texture, m: THREE.Matrix3) {
  const e = m.elements; // spaltenweise
  const L00 = e[0], L10 = e[1], L01 = e[3], L11 = e[4];
  // Three.js: L = [[sx·c, sx·s], [−sy·s, sy·c]] mit c = cos(rotation), s = sin(rotation)
  const rot = Math.atan2(L01, L00);
  const c = Math.cos(rot);
  const sn = Math.sin(rot);
  const useCos = Math.abs(c) >= Math.abs(sn);
  const sx = useCos ? L00 / c : L01 / sn;
  const sy = useCos ? L11 / c : -L10 / sn;
  t.center.set(0, 0);
  t.rotation = rot;
  t.repeat.set(sx, sy);
  t.offset.set(e[6], e[7]);
  t.matrixAutoUpdate = true;
  t.updateMatrix();
}

/** Klone je Ausgangstextur – müssen nach nachträglichem Laden ebenfalls neu hochgeladen werden */
const textureClones = new WeakMap<THREE.Texture, Set<THREE.Texture>>();

/** Ausgangstextur hat neue Bilddaten: alle Klone neu hochladen lassen */
function refreshClones(src: THREE.Texture) {
  src.needsUpdate = true;
  textureClones.get(src)?.forEach((c) => {
    c.image = src.image;
    c.needsUpdate = true;
  });
}

function setupTexture(src: THREE.Texture, matrix: THREE.Matrix3, anisotropy: number, clamp = false) {
  // jede Material-Instanz bekommt einen Klon, damit die Transformation unabhängig ist
  const t = src.clone();
  if (!textureClones.has(src)) textureClones.set(src, new Set());
  textureClones.get(src)!.add(t);
  t.source = src.source;
  // gestreckte Texturen nicht wiederholen: am Rand die Randpixel fortsetzen statt die Gegenseite zu zeigen
  t.wrapS = t.wrapT = clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  applyMatrix(t, matrix);
  t.anisotropy = anisotropy;
  t.needsUpdate = true;
  return t;
}

let maxAnisotropy = 8;
export function setMaxAnisotropy(n: number) {
  maxAnisotropy = n;
}

export function getMaterial(def: MaterialDef, uv?: UVSettings, extent?: UVExtent): THREE.MeshPhysicalMaterial {
  const textured = !!(def.image || def.procedural);
  const matrix = textured ? uvMatrix(def, uv, extent) : new THREE.Matrix3();
  const clamp = (uv?.mode ?? def.mapping ?? 'tile') === 'stretch' && !!extent;
  const key = JSON.stringify([
    def.id, def.color, def.roughness, def.metalness, def.clearcoat, def.bump,
    def.image?.length, def.image?.slice(-40), def.normalImage?.length, def.roughnessImage?.length, def.adjust,
    textured ? matrix.elements.map((e) => Math.round(e * 1e5)) : 0, clamp,
  ]);
  const cached = matCache.get(key);
  if (cached) return cached;

  const m = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(adjustHex(def.color, def.adjust)),
    roughness: def.roughness,
    metalness: def.metalness,
    clearcoat: def.clearcoat ?? 0,
    clearcoatRoughness: 0.08,
  });
  m.name = def.name;

  if (def.image) {
    m.color.set('#ffffff');
    m.map = setupTexture(hasAdjust(def.adjust) ? adjustedTexture(def) : textureFromImage(def.image, true), matrix, maxAnisotropy, clamp);
    if (def.normalImage) {
      m.normalMap = setupTexture(textureFromImage(def.normalImage, false), matrix, maxAnisotropy, clamp);
      const b = def.bump ?? 1;
      m.normalScale.set(b, b);
    }
    if (def.roughnessImage) {
      m.roughnessMap = setupTexture(textureFromImage(def.roughnessImage, false), matrix, maxAnisotropy, clamp);
      m.roughness = 1;
    }
  } else if (def.procedural) {
    const t = proceduralTextures(def);
    m.color.set('#ffffff');
    m.map = setupTexture(hasAdjust(def.adjust) ? adjustedTexture(def) : t.color, matrix, maxAnisotropy, clamp);
    if (def.bump) {
      m.normalMap = setupTexture(t.normal, matrix, maxAnisotropy, clamp);
      m.normalScale.set(def.bump, def.bump);
    }
    if (t.roughness) {
      m.roughnessMap = setupTexture(t.roughness, matrix, maxAnisotropy, clamp);
      m.roughness = Math.min(1, def.roughness * 2);
    }
  }
  matCache.set(key, m);
  return m;
}

/** Platzhalter-ID: Material wie die Fronten (z. B. für Griffmulden) */
export const MATCH_FRONT = '@front';

/** Ermittelt das Material eines Bereichs inkl. Element-Überschreibung und „wie Fronten“ */
export function slotMaterialDef(p: Project, slot: MaterialSlot, override?: string, frontOverride?: string): MaterialDef {
  const id = override ?? p.slots[slot];
  // Gerätefront ohne eigene Farbe: Gerät weiß (wie die festen Gerätematerialien)
  if (!id) return findMaterial(p, APPLIANCE_WHITE);
  if (id === MATCH_FRONT) return findMaterial(p, frontOverride ?? p.slots.front);
  return findMaterial(p, id);
}

export function slotMaterial(p: Project, slot: MaterialSlot, override?: string, frontOverride?: string, uv?: UVSettings, extent?: UVExtent) {
  return getMaterial(slotMaterialDef(p, slot, override, frontOverride), uv, extent);
}

/** Hat das Material eine Textur (Bild oder prozedural)? */
export function isTextured(def: MaterialDef) {
  return !!(def.image || def.procedural);
}

// Feste Materialien für Geräte & Details
export const FIXED = {
  glass: new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0, metalness: 0, transmission: 1, ior: 1.5, thickness: 0.004, transparent: true, opacity: 0.25 }),
  blackGlass: new THREE.MeshPhysicalMaterial({ color: '#0b0b0c', roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02 }),
  steel: new THREE.MeshPhysicalMaterial({ color: '#c8c9cb', roughness: 0.28, metalness: 1 }),
  graniteSink: new THREE.MeshPhysicalMaterial({ color: '#2f3032', roughness: 0.55, metalness: 0 }),
  anthraciteMetal: new THREE.MeshPhysicalMaterial({ color: '#3b3c3f', roughness: 0.38, metalness: 0.35, clearcoat: 0.3 }),
  chrome: new THREE.MeshPhysicalMaterial({ color: '#e8e9ea', roughness: 0.05, metalness: 1 }),
  darkMetal: new THREE.MeshPhysicalMaterial({ color: '#2a2a2c', roughness: 0.45, metalness: 0.8 }),
  rubber: new THREE.MeshPhysicalMaterial({ color: '#141414', roughness: 0.8, metalness: 0 }),
  frame: new THREE.MeshPhysicalMaterial({ color: '#f2f2f0', roughness: 0.4, metalness: 0 }),
  frameDark: new THREE.MeshPhysicalMaterial({ color: '#2e3033', roughness: 0.45, metalness: 0.3 }),
  ovenWindow: new THREE.MeshPhysicalMaterial({ color: '#161718', roughness: 0.05, metalness: 0.2, clearcoat: 1 }),
  lampShade: new THREE.MeshPhysicalMaterial({ color: '#1e1e1f', roughness: 0.35, metalness: 0.7, side: THREE.DoubleSide }),
  bulb: new THREE.MeshPhysicalMaterial({ color: '#fff5e0', emissive: new THREE.Color('#ffd9a0'), emissiveIntensity: 6 }),
  fabric: new THREE.MeshPhysicalMaterial({ color: '#d7cfc2', roughness: 0.95, metalness: 0, sheen: 1, sheenColor: new THREE.Color('#ffffff') }),
  outdoor: new THREE.MeshPhysicalMaterial({ color: '#9cb38c', roughness: 1 }),
};

/**
 * Lädt ein hochgeladenes Bild, skaliert es auf max. Kantenlänge herunter
 * und liefert eine kompakte Data-URL (JPEG bzw. PNG).
 */
export function readImageFile(file: File, maxSize = 2048, png = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const s = Math.min(1, maxSize / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * s);
        c.height = Math.round(img.height * s);
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
        resolve(png ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.9));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

const thumbCache = new Map<string, string>();

/** CSS für Vorschaukacheln (prozedurale Texturen in kleiner Auflösung) */
export function swatchStyle(def: MaterialDef): string {
  if (hasAdjust(def.adjust) && (def.image || def.procedural)) {
    const tex = adjustedTexture(def);
    const src = tex.image as HTMLCanvasElement;
    if (src.width > 4) {
      const c = document.createElement('canvas');
      c.width = c.height = 96;
      const ctx = c.getContext('2d')!;
      const side = Math.min(src.width, src.height);
      ctx.drawImage(src, (src.width - side) / 2, (src.height - side) / 2, side, side, 0, 0, 96, 96);
      return `background-image:url(${c.toDataURL('image/jpeg', 0.85)});background-size:cover`;
    }
  }
  if (!def.image && !def.procedural && hasAdjust(def.adjust)) return `background:${adjustHex(def.color, def.adjust)}`;
  if (def.image) return `background-image:url(${def.thumb ?? def.image});background-size:cover`;
  if (def.procedural) {
    const key = def.procedural + def.color;
    let url = thumbCache.get(key);
    if (!url) {
      url = generate(def.procedural, def.color, 128).color.toDataURL('image/jpeg', 0.85);
      thumbCache.set(key, url);
    }
    return `background-image:url(${url});background-size:cover`;
  }
  return `background:${def.color}`;
}
