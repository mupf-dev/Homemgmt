import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Item, MaterialSlot, Project } from './model/types.ts';
import { getEntry } from './model/catalog.ts';
import { levelsOf } from './model/storage.ts';
import { appliancePanel, korpusLayout, type KorpusBuild } from './model/objects.ts';
import { modelInstance } from './modelLoader';
import { FIXED, isDarkOrMetal, mergeUV, slotMaterial, slotMaterialDef, type UVExtent } from './materials';
import type { CountertopRun } from './model/geom.ts';

/**
 * Setzt UV-Koordinaten in Metern per Box-Projektion (dominante Normalenachse),
 * damit Texturen unabhängig von der Teilegröße im realen Maßstab erscheinen.
 */
export function applyBoxUV(geo: THREE.BufferGeometry, offset = new THREE.Vector3()) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + offset.x;
    const y = pos.getY(i) + offset.y;
    const z = pos.getZ(i) + offset.z;
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    const nz = Math.abs(nor.getZ(i));
    if (nx >= ny && nx >= nz) {
      uv[i * 2] = z;
      uv[i * 2 + 1] = y;
    } else if (ny >= nx && ny >= nz) {
      uv[i * 2] = x;
      uv[i * 2 + 1] = z;
    } else {
      uv[i * 2] = x;
      uv[i * 2 + 1] = y;
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, shadows = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadows;
  m.receiveShadow = true;
  return m;
}

/** Quader, Ursprung in der Mitte; optional mit gerundeten Kanten */
export function box(w: number, h: number, d: number, mat: THREE.Material, radius = 0, uvOffset?: THREE.Vector3) {
  const r = Math.min(radius, w / 2.01, h / 2.01, d / 2.01);
  const geo = r > 0.0005 ? new RoundedBoxGeometry(w, h, d, 2, r) : new THREE.BoxGeometry(w, h, d);
  applyBoxUV(geo, uvOffset);
  return mesh(geo, mat);
}

/**
 * UV-Versatz des aktuell gebauten Elements in Weltkoordinaten (entlang/quer zur Ausrichtung),
 * damit Maserungen über benachbarte Schränke hinweg durchlaufen.
 */
const uvBase = new THREE.Vector3();

/** Quader zwischen Min/Max-Koordinaten */
function boxAt(g: THREE.Object3D, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, mat: THREE.Material, radius = 0) {
  const w = x1 - x0;
  const h = y1 - y0;
  const d = z1 - z0;
  if (w <= 0.0001 || h <= 0.0001 || d <= 0.0001) return null;
  const c = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const m = box(w, h, d, mat, radius, c.clone().add(uvBase));
  m.position.copy(c);
  g.add(m);
  return m;
}

function cylinder(r: number, h: number, mat: THREE.Material, seg = 24) {
  const geo = new THREE.CylinderGeometry(r, r, h, seg);
  return mesh(geo, mat);
}

export interface BuildContext {
  project: Project;
  ceilingHeight: number;
  /** Fensterbrüstung oberhalb des Elements an der Wand (m), begrenzt die Rückwand */
  backsplashLimit?: number;
  /** Zusammenhängende Arbeitsplatte, zu der das Element gehört */
  run?: CountertopRun;
}

const GAP = 0.003;
const FRONT_T = 0.019;
/** Höhe einer Griffmulde (grifflose Küche) */
const CHANNEL = 0.032;
/** Tiefe der Griffmulde hinter der Frontoberfläche */
const CHANNEL_DEPTH = FRONT_T + 0.0005;

/** Grifflos-Modus des aktuell gebauten Elements (wird in buildItem gesetzt) */
let handleless = false;
/** Helligkeit der Leuchten (Projekteinstellung) */
let lampScale = 1;

/**
 * Front mit Griffmulde: Die Front wird oben bzw. unten um die Muldenhöhe gekürzt,
 * dahinter sitzt ein zurückgesetztes Muldenprofil im Griffmaterial.
 */
function channelFront(g: THREE.Group, x0: number, x1: number, y0: number, y1: number, zFront: number, side: 'top' | 'bottom', fm: THREE.Material, hm: THREE.Material) {
  const fy0 = side === 'bottom' ? y0 + CHANNEL : y0;
  const fy1 = side === 'top' ? y1 - CHANNEL : y1;
  boxAt(g, x0, x1, fy0, fy1, zFront - FRONT_T, zFront, fm, 0.0015);
  // Muldenprofil: Rückwand + Boden-/Deckenschenkel (L-Profil)
  const c0 = side === 'top' ? y1 - CHANNEL : y0;
  const c1 = side === 'top' ? y1 : y0 + CHANNEL;
  // Profil sitzt direkt vor der Korpusfront und bildet die sichtbare, dunkle Mulde
  const zb = zFront - CHANNEL_DEPTH;
  boxAt(g, x0, x1, c0, c1, zb, zb + 0.0015, hm);
}

type Mats = (slot: MaterialSlot) => THREE.Material;

export function buildItem(item: Item, ctx: BuildContext): THREE.Group {
  const g = new THREE.Group();
  g.userData.itemId = item.id;
  const entry = getEntry(item.type);
  const p = ctx.project;
  handleless = !!p.settings.handleless;
  lampScale = p.settings.lampIntensity ?? 1;
  const cr = Math.cos(item.rotation);
  const sr = Math.sin(item.rotation);
  uvBase.set((item.x * cr + item.y * sr) / 100, item.elevation / 100, (-item.x * sr + item.y * cr) / 100);

  // Fläche für „auf ganze Fläche strecken“ je Bereich (in UV-Metern)
  const iw = item.width / 100;
  const ih = item.height / 100;
  const id = item.depth / 100;
  const itemFace: UVExtent = { u0: uvBase.x - iw / 2, u1: uvBase.x + iw / 2, v0: uvBase.y, v1: uvBase.y + ih };
  const extentFor = (slot: MaterialSlot): UVExtent => {
    if (slot === 'countertop') {
      if (ctx.run) return { ...ctx.run, horizontal: true };
      return { u0: uvBase.x - iw / 2, u1: uvBase.x + iw / 2, v0: uvBase.z - id / 2, v1: uvBase.z + id / 2, horizontal: true };
    }
    if (slot === 'backsplash') {
      const top = uvBase.y + ih;
      return { u0: ctx.run?.u0 ?? itemFace.u0, u1: ctx.run?.u1 ?? itemFace.u1, v0: top, v1: top + 0.6 };
    }
    return itemFace;
  };
  const mat: Mats = (slot) =>
    slotMaterial(p, slot, item.materials?.[slot], item.materials?.front, mergeUV(p.uv?.[slot], item.uv?.[slot]), extentFor(slot));

  const W = item.width / 100;
  const D = item.depth / 100;
  const H = item.height / 100;
  const P = p.settings.plinth / 100;
  const T = p.settings.countertopThickness / 100;

  switch (entry.kind) {
    case 'base':
    case 'sink':
    case 'hob':
    case 'oven':
    case 'dishwasher':
    case 'island':
      buildBase(g, item, entry.kind, W, D, H, P, T, mat, ctx);
      break;
    case 'wall':
      buildWallCabinet(g, item, W, D, H, mat);
      break;
    case 'tall':
    case 'tallFridge':
    case 'tallOven':
      buildTall(g, item, entry.kind, W, D, H, P, mat);
      break;
    case 'hood':
      buildHood(g, W, D, H, ctx, item);
      break;
    case 'fridgeFree':
      buildFridge(g, W, D, H);
      break;
    case 'shelf':
      boxAt(g, -W / 2, W / 2, 0, H, -D / 2, D / 2, mat('countertop'), 0.002);
      break;
    case 'panel':
      boxAt(g, -W / 2, W / 2, 0, H, -D / 2, D / 2, mat('front'), 0.002);
      break;
    case 'gripV': {
      // senkrechte Kehlleiste (C-Profil) zwischen Hochschränken: zurückgesetzte Mulde über die Fronthöhe
      boxAt(g, -W / 2, W / 2, 0, P, -D / 2 + 0.02, D / 2 - 0.06, mat('front'));
      boxAt(g, -W / 2, W / 2, P, H, -D / 2, D / 2 - 0.03, mat('channel'));
      break;
    }
    case 'table':
      buildTable(g, W, D, H, mat);
      break;
    case 'stool':
      buildStool(g, W, H, mat);
      break;
    case 'pendant':
      buildPendant(g, item, ctx);
      break;
    case 'rack':
    case 'heavyRack':
      buildRack(g, item, entry.kind, W, D, H, mat);
      break;
    case 'cupboard':
    case 'wardrobe':
    case 'sideboard':
      buildCupboard(g, entry.kind, W, D, H, P, mat);
      break;
    case 'dresser':
      buildDresser(g, item, W, D, H, P, mat);
      break;
    case 'workbench':
      buildWorkbench(g, W, D, H, mat);
      break;
    case 'stairs':
      buildStairs(g, item, W, D, H);
      break;
    case 'model':
      if (item.model?.url) g.add(modelInstance(item.model.url, W, D, H));
      break;
    case 'custom': {
      const t = entry.object;
      if (!t) {
        boxAt(g, -W / 2, W / 2, 0, H, -D / 2, D / 2, mat('carcass'));
        break;
      }
      if (t.build.type === 'modell') {
        if (t.build.model.url) g.add(modelInstance(t.build.model.url, W, D, H));
      } else {
        // Gerätefront: ohne eigene Farbe die festen Gerätematerialien (weiß, Blende hellgrau)
        const ov = item.materials?.appliance;
        const appliance: ApplianceLook = ov ? { body: mat('appliance'), dark: isDarkOrMetal(slotMaterialDef(p, 'appliance', ov)) } : { body: APPLIANCE.white, dark: false };
        buildKorpus(g, t.build, W, D, H, mat, appliance);
      }
      break;
    }
  }
  return g;
}

/**
 * Möbelart aus der Bibliothek: Korpus aus Seiten, Boden, Deckel, Rückwand und Trennwänden; je Element eine Front
 * (Schublade, Tür, Klappe, Kühl-/Gefrierfach) oder offene Böden. Die Aufteilung kommt aus korpusLayout – dieselbe wie
 * für die Fächer im Lager.
 */
function buildKorpus(g: THREE.Group, b: KorpusBuild, W: number, D: number, Htotal: number, mat: Mats, appliance: ApplianceLook) {
  const cm = mat('carcass');
  // Arbeitsplatte oben (volle Breite, Überstand vorne); in einer Küchenzeile läuft ihre Textur über ctx.run weiter
  const ctT = (b.countertop?.thickness ?? 0) / 100;
  const H = Htotal - ctT;
  const t = b.board / 100;
  const P = b.plinth / 100;
  const zB = -D / 2;
  const zF = D / 2;
  const hasFronts = b.columns.some((c) => c.elements.some((e) => e.kind !== 'open'));
  const zC = hasFronts ? zF - FRONT_T - 0.001 : zF; // Korpus endet hinter den Fronten
  if (P > 0) boxAt(g, -W / 2 + 0.001, W / 2 - 0.001, 0, P, zB + 0.02, zC - 0.04, mat('front'));
  boxAt(g, -W / 2, -W / 2 + t, P, H, zB, zC, cm, 0.001);
  boxAt(g, W / 2 - t, W / 2, P, H, zB, zC, cm, 0.001);
  boxAt(g, -W / 2 + t, W / 2 - t, H - t, H, zB, zC, cm, 0.001);
  boxAt(g, -W / 2 + t, W / 2 - t, P, P + t, zB, zC, cm, 0.001);
  if (b.back) boxAt(g, -W / 2 + t, W / 2 - t, P + t, H - t, zB, zB + Math.min(t, 0.008), cm);
  const cols = korpusLayout(b, W * 100, Htotal * 100);
  const fronts: FrontRect[] = [];
  cols.forEach((col, ci) => {
    const x0 = col.x0 / 100;
    const x1 = col.x1 / 100;
    // Trennwand rechts der Spalte
    if (ci < cols.length - 1) boxAt(g, x1, x1 + t, P + t, H - t, zB, zC, cm, 0.001);
    col.elements.forEach(({ el, y0: ey0, y1: ey1 }, ei) => {
      const y0 = ey0 / 100;
      const y1 = ey1 / 100;
      // Zwischenboden unter jedem Element (außer dem untersten)
      if (ei < col.elements.length - 1) boxAt(g, x0, x1, y0 - t / 2, y0 + t / 2, zB, zC, cm, 0.001);
      if (el.kind === 'open') {
        const n = el.shelves ?? 1;
        for (let k = 1; k < n; k++) {
          const y = y1 - ((y1 - y0) * k) / n;
          boxAt(g, x0, x1, y - t / 2, y + t / 2, zB + 0.006, zF - 0.005, cm, 0.001);
        }
        return;
      }
      // Fronten reichen bis zur Mitte der angrenzenden Platten
      const fx0 = ci === 0 ? -W / 2 : x0 - t / 2;
      const fx1 = ci === cols.length - 1 ? W / 2 : x1 + t / 2;
      const fy0 = ei === col.elements.length - 1 ? P : y0 - t / 2;
      const fy1 = ei === 0 ? H : y1 + t / 2;
      // Waschmaschine/Trockner: Gerätefront in Gerätefarben statt Möbelfront
      if (el.kind === 'washer' || el.kind === 'dryer') return buildApplianceFront(g, el.kind, fx0, fx1, fy0, fy1, zF, appliance);
      if (el.kind === 'drawer' || el.kind === 'flap' || el.kind === 'freezer') fronts.push({ x0: fx0, x1: fx1, y0: fy0, y1: fy1, handle: el.kind === 'flap' ? 'bottom' : 'top' });
      else if (el.kind === 'door' && fx1 - fx0 > 0.62) fronts.push(...doorFronts(fx0, fx1, fy0, fy1, false));
      else fronts.push({ x0: fx0, x1: fx1, y0: fy0, y1: fy1, handle: ci === cols.length - 1 && cols.length > 1 ? 'left' : 'right' });
    });
  });
  addFronts(g, fronts, zF, mat);
  if (b.countertop) boxAt(g, -W / 2, W / 2, H, Htotal, zB, zF + b.countertop.overhang / 100, mat('countertop'));
}

// Gerätefarben (unabhängig von Fronten und grifflos): weißes Gehäuse, hellgraue Blende, getöntes Glas
const APPLIANCE = {
  white: new THREE.MeshPhysicalMaterial({ color: '#f3f3f1', roughness: 0.32, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.15 }),
  panel: new THREE.MeshPhysicalMaterial({ color: '#d9dadb', roughness: 0.35, metalness: 0, clearcoat: 0.4 }),
  seam: new THREE.MeshPhysicalMaterial({ color: '#c4c5c6', roughness: 0.5, metalness: 0 }),
  glass: new THREE.MeshPhysicalMaterial({ color: '#2c3a44', roughness: 0.04, metalness: 0, clearcoat: 1, transparent: true, opacity: 0.55 }),
  drum: new THREE.MeshPhysicalMaterial({ color: '#8d9296', roughness: 0.35, metalness: 0.9 }),
  drumDark: new THREE.MeshPhysicalMaterial({ color: '#3d4144', roughness: 0.5, metalness: 0.6 }),
};

/** Farbe der Gerätefront: Gehäuse und Waschmittelschublade; dunkel/metallisch → Schwarzglas-Blende, Chromring */
interface ApplianceLook {
  body: THREE.Material;
  dark: boolean;
}

/** Front einer Waschmaschine bzw. eines Trockners über der Elementfläche (Meter, Frontebene z) */
function buildApplianceFront(g: THREE.Group, kind: 'washer' | 'dryer', x0: number, x1: number, y0: number, y1: number, z: number, look: ApplianceLook) {
  const panelMat = look.dark ? FIXED.blackGlass : APPLIANCE.panel;
  const w = x1 - x0 - GAP;
  const cx = (x0 + x1) / 2;
  const panelH = appliancePanel((y1 - y0) * 100) / 100;
  const pTop = y1 - GAP / 2;
  const pY = pTop - panelH / 2;
  // Gehäusefront und Bedienblende
  boxAt(g, cx - w / 2, cx + w / 2, y0 + GAP / 2, pTop - panelH - 0.002, z - 0.02, z, look.body, 0.004);
  boxAt(g, cx - w / 2, cx + w / 2, pTop - panelH, pTop, z - 0.02, z + 0.004, panelMat, 0.004);
  // Blende: links Schublade (Waschmittel bzw. Kondenswasser), Mitte Display, rechts Drehknopf
  const dW = Math.min(0.17, w * 0.3);
  const dH = panelH * 0.62;
  boxAt(g, cx - w / 2 + 0.012, cx - w / 2 + 0.012 + dW, pY - dH / 2, pY + dH / 2, z + 0.004, z + 0.008, look.body, 0.003);
  boxAt(g, cx - w / 2 + 0.03, cx - w / 2 + 0.012 + dW - 0.018, pY - dH / 2 + 0.006, pY - dH / 2 + 0.012, z + 0.008, z + 0.01, APPLIANCE.seam);
  const dispW = Math.min(0.12, w * 0.22);
  boxAt(g, cx - dispW / 2 + w * 0.06, cx + dispW / 2 + w * 0.06, pY - panelH * 0.16, pY + panelH * 0.16, z + 0.004, z + 0.007, FIXED.blackGlass, 0.002);
  const kR = Math.min(0.03, panelH * 0.3, w * 0.07);
  const knob = mesh(new THREE.CylinderGeometry(kR, kR * 1.04, 0.018, 40), FIXED.chrome);
  knob.rotation.x = Math.PI / 2;
  knob.position.set(cx + w / 2 - kR - 0.03, pY, z + 0.013);
  g.add(knob);
  const knobTop = mesh(new THREE.CylinderGeometry(kR * 0.8, kR * 0.8, 0.002, 40), panelMat);
  knobTop.rotation.x = Math.PI / 2;
  knobTop.position.set(knob.position.x, pY, z + 0.0225);
  g.add(knobTop);
  // Bullauge: Türring, dahinter Trommel, davor getöntes Glas; Griff rechts
  const lowTop = pTop - panelH;
  const lowH = lowTop - y0;
  const R = Math.max(0.03, Math.min(w * 0.34, lowH * 0.36));
  const cy = y0 + lowH * 0.56;
  // Türring: Waschmaschine Chrom; Trockner anthrazit, auf dunkler Front Chrom
  const ringMat = kind === 'washer' || look.dark ? FIXED.chrome : FIXED.anthraciteMetal;
  const ring = mesh(new THREE.TorusGeometry(R, R * 0.13, 20, 72), ringMat);
  ring.position.set(cx, cy, z + 0.012);
  g.add(ring);
  const disc = (r: number, d: number, zc: number, m: THREE.Material) => {
    const c = mesh(new THREE.CylinderGeometry(r, r, d, 64), m, false);
    c.rotation.x = Math.PI / 2;
    c.position.set(cx, cy, zc);
    g.add(c);
  };
  disc(R * 0.92, 0.002, z + 0.001, APPLIANCE.drum);
  disc(R * 0.5, 0.002, z + 0.002, APPLIANCE.drumDark);
  // Mitnehmer der Trommel
  for (let k = 0; k < 3; k++) {
    const a = (k * Math.PI * 2) / 3 + Math.PI / 2;
    const rib = box(R * 0.32, R * 0.07, 0.003, APPLIANCE.drumDark);
    rib.position.set(cx + Math.cos(a) * R * 0.7, cy + Math.sin(a) * R * 0.7, z + 0.003);
    rib.rotation.z = a;
    g.add(rib);
  }
  disc(R * 0.95, 0.004, z + 0.01, APPLIANCE.glass);
  const hx = Math.min(cx + R * 1.12, cx + w / 2 - 0.02);
  boxAt(g, hx - 0.012, hx + 0.012, cy - R * 0.32, cy + R * 0.32, z + 0.006, z + 0.024, ringMat, 0.006);
  // unten rechts Serviceklappe (Flusensieb/Pumpe); Trockner unten links Lüftungsgitter
  const fW = Math.min(0.13, w * 0.24);
  const fH = Math.min(0.09, (cy - R * 1.13 - y0) * 0.75);
  if (fH > 0.02) {
    const fy = y0 + 0.025;
    boxAt(g, cx + w / 2 - 0.03 - fW, cx + w / 2 - 0.03, fy, fy + fH, z, z + 0.002, APPLIANCE.seam, 0.002);
    boxAt(g, cx + w / 2 - 0.03 - fW + 0.003, cx + w / 2 - 0.033, fy + 0.003, fy + fH - 0.003, z + 0.002, z + 0.003, look.body, 0.002);
    if (kind === 'dryer') {
      const gx = cx - w / 2 + 0.03;
      for (let k = 0; k < 5; k++) {
        const yy = fy + 0.008 + ((fH - 0.016) * k) / 4;
        boxAt(g, gx, gx + fW, yy - 0.003, yy + 0.003, z, z + 0.002, FIXED.frameDark);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Möbel außerhalb der Küche. Böden und Schubladen liegen genau wie die Fächer in model/storage.ts.

const OSB = new THREE.MeshPhysicalMaterial({ color: '#c9a878', roughness: 0.85, metalness: 0 });

function buildRack(g: THREE.Group, item: Item, kind: string, W: number, D: number, H: number, mat: Mats) {
  const n = levelsOf(item);
  const h = (H - 0.03) / n;
  const t = 0.018;
  if (kind === 'heavyRack') {
    // Stahlpfosten an den Ecken, Böden aus Spanplatte
    const post = 0.035;
    for (const x of [-W / 2, W / 2 - post]) for (const z of [-D / 2, D / 2 - post]) boxAt(g, x, x + post, 0, H, z, z + post, FIXED.darkMetal);
    for (let i = 0; i < n; i++) {
      const y = H - h * (i + 1);
      boxAt(g, -W / 2 + 0.005, W / 2 - 0.005, y, y + t, -D / 2 + 0.005, D / 2 - 0.005, OSB);
      boxAt(g, -W / 2, W / 2, y - 0.03, y, D / 2 - 0.02, D / 2, FIXED.darkMetal); // Querträger vorne
    }
    return;
  }
  const cm = mat('carcass');
  boxAt(g, -W / 2, -W / 2 + t, 0, H, -D / 2, D / 2, cm, 0.001);
  boxAt(g, W / 2 - t, W / 2, 0, H, -D / 2, D / 2, cm, 0.001);
  boxAt(g, -W / 2 + t, W / 2 - t, H - t, H, -D / 2, D / 2, cm, 0.001);
  boxAt(g, -W / 2 + t, W / 2 - t, t, H - t, -D / 2, -D / 2 + 0.006, cm);
  for (let i = 0; i < n; i++) {
    const y = Math.max(0, H - h * (i + 1));
    boxAt(g, -W / 2 + t, W / 2 - t, y, y + t, -D / 2 + 0.006, D / 2 - 0.005, cm, 0.001);
  }
}

function buildCupboard(g: THREE.Group, kind: string, W: number, D: number, H: number, P: number, mat: Mats) {
  const zFront = D / 2;
  boxAt(g, -W / 2 + 0.001, W / 2 - 0.001, 0, P, -D / 2 + 0.02, zFront - 0.06, mat('front'));
  boxAt(g, -W / 2, W / 2, P, H, -D / 2, zFront - FRONT_T - 0.001, mat('carcass'));
  // Türen: Kleiderschrank je ca. 50 cm eine Tür, sonst wie bei Küchenschränken
  let fronts: FrontRect[];
  if (kind === 'wardrobe') {
    const n = Math.max(1, Math.round(W / 0.5));
    fronts = Array.from({ length: n }, (_, i) => ({ x0: -W / 2 + (W / n) * i, x1: -W / 2 + (W / n) * (i + 1), y0: P, y1: H, handle: (i % 2 ? 'left' : 'right') as FrontRect['handle'] }));
  } else if (kind === 'sideboard') {
    const n = Math.max(1, Math.round(W / 0.4));
    fronts = Array.from({ length: n }, (_, i) => ({ x0: -W / 2 + (W / n) * i, x1: -W / 2 + (W / n) * (i + 1), y0: P, y1: H - 0.002, handle: 'top' as const }));
  } else fronts = doorFronts(-W / 2, W / 2, P, H, false);
  addFronts(g, fronts, zFront, mat);
}

function buildDresser(g: THREE.Group, item: Item, W: number, D: number, H: number, P: number, mat: Mats) {
  const zFront = D / 2;
  boxAt(g, -W / 2 + 0.001, W / 2 - 0.001, 0, P, -D / 2 + 0.02, zFront - 0.06, mat('front'));
  boxAt(g, -W / 2, W / 2, P, H, -D / 2, zFront - FRONT_T - 0.001, mat('carcass'));
  addFronts(g, drawerFronts(-W / 2, W / 2, P, H - 0.02, Array(levelsOf(item)).fill(1)), zFront, mat);
}

const STAIR_WOOD = new THREE.MeshPhysicalMaterial({ color: '#b98d5a', roughness: 0.55, metalness: 0 });

/** Treppe: Stufen steigen zur Rückseite (lokal −z) an, Wangen seitlich */
function buildStairs(g: THREE.Group, item: Item, W: number, D: number, H: number) {
  const n = Math.max(2, Math.round(item.levels ?? Math.round(H / 0.18)));
  const run = D / n;
  const rise = H / n;
  for (let i = 0; i < n; i++) {
    const z1 = D / 2 - i * run;
    boxAt(g, -W / 2 + 0.04, W / 2 - 0.04, (i + 1) * rise - 0.04, (i + 1) * rise, z1 - run - 0.03, z1, STAIR_WOOD, 0.003);
  }
  // Wangen als schräge Bretter
  const len = Math.hypot(D, H);
  for (const x of [-W / 2 + 0.02, W / 2 - 0.02]) {
    const s = box(0.04, 0.28, len, FIXED.frame, 0.002);
    s.position.set(x, H / 2, 0);
    s.rotation.x = Math.atan2(H, D);
    g.add(s);
  }
}

function buildWorkbench(g: THREE.Group, W: number, D: number, H: number, mat: Mats) {
  boxAt(g, -W / 2, W / 2, H - 0.04, H, -D / 2, D / 2, mat('countertop'), 0.002);
  const leg = 0.05;
  for (const x of [-W / 2 + 0.03, W / 2 - 0.03 - leg]) for (const z of [-D / 2 + 0.03, D / 2 - 0.03 - leg]) boxAt(g, x, x + leg, 0, H - 0.04, z, z + leg, FIXED.darkMetal);
  boxAt(g, -W / 2 + 0.04, W / 2 - 0.04, 0.12, 0.14, -D / 2 + 0.04, D / 2 - 0.04, OSB);
}

// ---------------------------------------------------------------------------

interface FrontRect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Griffausrichtung */
  handle: 'top' | 'left' | 'right' | 'bottom' | 'none';
  mat?: THREE.Material;
}

function addFronts(g: THREE.Group, fronts: FrontRect[], zFront: number, mat: Mats) {
  const fm = mat('front');
  const hm = mat('handle');
  for (const f of fronts) {
    const x0 = f.x0 + GAP / 2;
    const x1 = f.x1 - GAP / 2;
    const y0 = f.y0 + GAP / 2;
    const y1 = f.y1 - GAP / 2;
    if (handleless && f.handle !== 'none') {
      channelFront(g, x0, x1, y0, y1, zFront, 'top', f.mat ?? fm, mat('channel'));
      continue;
    }
    boxAt(g, x0, x1, y0, y1, zFront - FRONT_T, zFront, f.mat ?? fm, 0.0015);
    addHandle(g, f.handle, x0, x1, y0, y1, zFront, hm);
  }
}

function addHandle(g: THREE.Group, side: FrontRect['handle'], x0: number, x1: number, y0: number, y1: number, z: number, hm: THREE.Material) {
  if (side === 'none') return;
  const w = x1 - x0;
  const h = y1 - y0;
  const r = 0.006;
  const standoff = 0.028;
  const horizontal = side === 'top' || side === 'bottom';
  const len = horizontal ? Math.min(0.32, Math.max(0.12, w * 0.45)) : Math.min(0.32, Math.max(0.12, h * 0.35));
  const bar = new THREE.Group();
  const rod = cylinder(r, len, hm, 16);
  rod.position.set(0, 0, standoff);
  bar.add(rod);
  for (const s of [-1, 1]) {
    const leg = cylinder(r * 0.8, standoff, hm, 12);
    leg.rotation.x = Math.PI / 2;
    leg.position.set(0, s * (len / 2 - 0.012), standoff / 2);
    bar.add(leg);
  }
  if (horizontal) bar.rotation.z = Math.PI / 2;
  const inset = 0.045;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  if (side === 'top') bar.position.set(cx, y1 - inset, z);
  if (side === 'bottom') bar.position.set(cx, y0 + inset, z);
  if (side === 'left') bar.position.set(x0 + inset, horizontal ? cy : y1 - len / 2 - 0.06, z);
  if (side === 'right') bar.position.set(x1 - inset, horizontal ? cy : y1 - len / 2 - 0.06, z);
  g.add(bar);
}

function doorFronts(x0: number, x1: number, y0: number, y1: number, handleTop: boolean): FrontRect[] {
  const w = x1 - x0;
  if (w > 0.62) {
    const m = (x0 + x1) / 2;
    return [
      { x0, x1: m, y0, y1, handle: 'right' },
      { x0: m, x1, y0, y1, handle: 'left' },
    ];
  }
  return [{ x0, x1, y0, y1, handle: handleTop ? 'right' : 'right' }];
}

function drawerFronts(x0: number, x1: number, y0: number, y1: number, ratios: number[]): FrontRect[] {
  const total = ratios.reduce((a, b) => a + b, 0);
  const res: FrontRect[] = [];
  let y = y1;
  for (const r of ratios) {
    const h = ((y1 - y0) * r) / total;
    res.push({ x0, x1, y0: y - h, y1: y, handle: 'top' });
    y -= h;
  }
  return res;
}

/** Höhenverhältnisse der Auszüge je Anzahl (oben → unten) */
const DRAWER_RATIOS: Record<number, number[]> = { 1: [1], 2: [1, 1], 3: [1, 1.5, 1.5], 4: [1, 1, 1, 1] };

/** Spalten einer Kochinsel als [x0, x1] in Metern (lokal, links → rechts) */
export function islandColumnSpans(item: Item, W = item.width / 100): [number, number][] {
  const widths = item.columnWidths?.filter((w) => w > 0);
  if (widths?.length) {
    const sum = widths.reduce((a, b) => a + b, 0);
    let x = -W / 2;
    return widths.map((w) => {
      const span: [number, number] = [x, x + (w / sum) * W];
      x = span[1];
      return span;
    });
  }
  const n = islandColumns(item, W);
  return Array.from({ length: n }, (_, i) => [-W / 2 + (W / n) * i, -W / 2 + (W / n) * (i + 1)] as [number, number]);
}

/** Spaltenzahl einer Kochinsel: eingestellt oder automatisch (ca. 80 cm je Spalte) */
export function islandColumns(item: Item, W = item.width / 100) {
  return item.columns && item.columns > 0 ? Math.round(item.columns) : Math.max(1, Math.round(W / 0.8));
}

function buildBase(g: THREE.Group, item: Item, kind: string, W: number, D: number, H: number, P: number, T: number, mat: Mats, ctx: BuildContext) {
  const carcassTop = H - T;
  const isIsland = kind === 'island';
  // Insel-Rückseite: Theke mit Sitzüberstand oder zweite Schrankreihe mit Türen
  const backDoors = isIsland && item.islandBack === 'doors';
  const waterfall = isIsland && (item.waterfall ?? !backDoors);
  const cabD = isIsland ? Math.min(0.6, D - 0.05) : D;
  const zFront = D / 2;
  const zBack = zFront - cabD;

  // Sockel (zurückgesetzt)
  boxAt(g, -W / 2 + 0.001, W / 2 - 0.001, 0, P, zBack + 0.02, zFront - 0.06, mat('front'));
  // Korpus (Spülenschrank: oben offen, damit das Becken Platz hat)
  if (kind === 'sink') {
    const cm = mat('carcass');
    const t = 0.016;
    const zf = zFront - FRONT_T - 0.001;
    boxAt(g, -W / 2, W / 2, P, P + t, zBack, zf, cm);
    boxAt(g, -W / 2, -W / 2 + t, P, carcassTop, zBack, zf, cm);
    boxAt(g, W / 2 - t, W / 2, P, carcassTop, zBack, zf, cm);
    boxAt(g, -W / 2 + t, W / 2 - t, P, carcassTop, zBack, zBack + 0.008, cm);
  } else boxAt(g, -W / 2, W / 2, P, carcassTop, zBack, zFront - FRONT_T - 0.001, mat('carcass'));

  // Fronten
  let fronts: FrontRect[] = [];
  const y0 = P;
  const y1 = carcassTop - 0.002;
  if (kind === 'oven') {
    const ovenH = 0.595;
    buildOvenFront(g, -W / 2, W / 2, y1 - ovenH, y1, zFront);
    fronts = drawerFronts(-W / 2, W / 2, y0, y1 - ovenH, [1]);
  } else if (kind === 'dishwasher') {
    fronts = [{ x0: -W / 2, x1: W / 2, y0, y1, handle: 'top' }];
  } else if (kind === 'sink') {
    fronts = doorFronts(-W / 2, W / 2, y0, y1, true);
  } else if (kind === 'hob' || item.front === 'drawers') {
    fronts = drawerFronts(-W / 2, W / 2, y0, y1, DRAWER_RATIOS[Math.max(1, Math.min(4, item.drawers ?? 3))]);
  } else if (item.front === 'single') {
    fronts = [{ x0: -W / 2, x1: W / 2, y0, y1, handle: 'right' }];
  } else if (item.front === 'mixed') {
    const top = drawerFronts(-W / 2, W / 2, y1 - 0.15, y1, [1]);
    fronts = [...top, ...doorFronts(-W / 2, W / 2, y0, y1 - 0.15, false)];
  } else {
    fronts = doorFronts(-W / 2, W / 2, y0, y1, false);
  }
  const cols = islandColumnSpans(item, W);
  if (isIsland) {
    // Insel: Spalten (gleich breit oder individuell) mit Auszügen
    const ratios = DRAWER_RATIOS[Math.max(1, Math.min(4, item.drawers ?? 3))];
    fronts = [];
    cols.forEach(([a, b], i) => fronts.push(...drawerFronts(a, b, y0, y1, item.columnFronts?.[i] ?? ratios)));
  }
  addFronts(g, fronts, zFront, mat);

  // Arbeitsplatte
  const ct = mat('countertop');
  const ov = item.ctOverhang;
  const ctFront = zFront + (ov?.f ?? 2) / 100;
  const ctBack = (isIsland ? -D / 2 - (backDoors ? 0.02 : 0) : zBack) - (ov?.b ?? 0) / 100;
  const ctL = -W / 2 - (ov?.l ?? 0) / 100;
  const ctR = W / 2 + (ov?.r ?? 0) / 100;
  const ctY0 = carcassTop;
  const ctY1 = H;

  if (kind === 'sink') {
    const subline = item.sinkModel === 'subline500u';
    // SUBLINE 500-U: Ausschnitt = Beckenmaß 500 × 400 mm, Vorderkante ca. 85 mm hinter der Plattenkante
    const sw = subline ? 0.5 : Math.min(W - 0.1, 0.56);
    const sd = subline ? 0.4 : 0.42;
    const sz = subline ? ctFront - 0.085 - sd / 2 : (ctFront + ctBack) / 2 + 0.01;
    boxAt(g, -W / 2, -sw / 2, ctY0, ctY1, ctBack, ctFront, ct);
    boxAt(g, sw / 2, W / 2, ctY0, ctY1, ctBack, ctFront, ct);
    boxAt(g, -sw / 2, sw / 2, ctY0, ctY1, sz + sd / 2, ctFront, ct);
    boxAt(g, -sw / 2, sw / 2, ctY0, ctY1, ctBack, sz - sd / 2, ct);
    // Werkstoff aus dem Bereich „Spülbecken“ (ältere Planungen: sinkFinish)
    const sinkMat = item.materials?.sink || !item.sinkFinish ? mat('sink') : item.sinkFinish === 'anthracite' ? FIXED.graniteSink : FIXED.steel;
    if (subline) buildUndermountSink(g, sw, sd, sz, ctY0, sinkMat);
    else buildSink(g, sw, sd, sz, ctY1, sinkMat);
    // Hahnloch Ø 35 mm mittig hinter dem Becken
    const fz = sz - sd / 2 - (subline ? 0.055 : 0.05);
    if (item.faucet === 'kano-s') buildKanoS(g, 0, ctY1, fz);
    else buildFaucet(g, 0, ctY1, fz, mat('handle'));
  } else {
    boxAt(g, ctL, ctR, ctY0, ctY1, ctBack, ctFront, ct);
  }

  if (isIsland) {
    if (backDoors) {
      // zweite Schrankreihe, Fronten zur Rückseite (um 180° gedrehte Untergruppe)
      const back = new THREE.Group();
      back.rotation.y = Math.PI;
      g.add(back);
      const bz = D / 2;
      const backD = D - cabD;
      boxAt(back, -W / 2 + 0.001, W / 2 - 0.001, 0, P, bz - backD, bz - 0.06, mat('front'));
      boxAt(back, -W / 2, W / 2, P, carcassTop, bz - backD, bz - FRONT_T - 0.001, mat('carcass'));
      const doors: FrontRect[] = [];
      // Rückseite ist gespiegelt: Spalten in umgekehrter Reihenfolge
      const backCols = cols.map(([a, b]) => [-b, -a] as [number, number]).reverse();
      for (let i = 0; i < backCols.length; i++) {
        const a = backCols[i][0];
        const cw = backCols[i][1] - backCols[i][0];
        const perCol = item.doorsPerColumn ?? (cw > 0.62 ? 2 : 1);
        if (perCol === 2) {
          doors.push({ x0: a, x1: a + cw / 2, y0, y1, handle: 'right' }, { x0: a + cw / 2, x1: a + cw, y0, y1, handle: 'left' });
        } else {
          doors.push({ x0: a, x1: a + cw, y0, y1, handle: i % 2 ? 'left' : 'right' });
        }
      }
      addFronts(back, doors, bz, mat);
    } else {
      // Rückseite des Korpus verkleiden (Sitzseite)
      const inset = waterfall ? 0.04 : 0;
      boxAt(g, -W / 2 + inset, W / 2 - inset, P, ctY0, zBack - 0.019, zBack, mat('front'), 0.0015);
    }
    if (waterfall) {
      // Wangen im Arbeitsplattenmaterial bis zum Boden
      const legW = 0.04;
      boxAt(g, -W / 2, -W / 2 + legW, 0, ctY0, ctBack, ctFront, ct, 0.002);
      boxAt(g, W / 2 - legW, W / 2, 0, ctY0, ctBack, ctFront, ct, 0.002);
    }
    // Kochfeld auf der Insel
    // Kochfeld über der mittleren Spalte
    const mid = cols[Math.floor(cols.length / 2)];
    buildHob(g, Math.min(0.8, W - 0.4), cols.length % 2 ? (mid[0] + mid[1]) / 2 : 0, ctY1, zFront - 0.3 - (item.downdraft ? 0.05 : 0), item.downdraft);
  }

  if (kind === 'hob') buildHob(g, Math.min(W - 0.04, 0.78), 0, ctY1, (ctFront + ctBack) / 2, item.downdraft);

  // Nischenrückwand
  if (item.wallId && ctx.project.settings.backsplash && !isIsland) {
    const bh = (ctx.project.settings.backsplashHeight ?? 60) / 100;
    const top = Math.min(H + bh, ctx.backsplashLimit ?? Infinity) - item.elevation / 100;
    if (top > H + 0.02) boxAt(g, -W / 2, W / 2, H, top, zBack, zBack + 0.008, mat('backsplash'));
  }
}

function buildOvenFront(g: THREE.Group, x0: number, x1: number, y0: number, y1: number, z: number) {
  const w = x1 - x0 - GAP;
  const cx = (x0 + x1) / 2;
  // Bedienblende
  const panelH = 0.09;
  const panel = box(w, panelH, 0.02, FIXED.blackGlass, 0.002);
  panel.position.set(cx, y1 - panelH / 2, z - 0.01);
  g.add(panel);
  const display = box(0.12, 0.03, 0.004, FIXED.blackGlass);
  display.position.set(cx, y1 - panelH / 2, z + 0.001);
  g.add(display);
  for (const s of [-1, 1]) {
    const knob = cylinder(0.018, 0.004, FIXED.darkMetal, 24);
    knob.rotation.x = Math.PI / 2;
    knob.position.set(cx + s * (w / 2 - 0.07), y1 - panelH / 2, z + 0.01);
    g.add(knob);
  }
  // Glastür
  const doorH = y1 - y0 - panelH - GAP;
  const door = box(w, doorH, 0.02, FIXED.blackGlass, 0.002);
  door.position.set(cx, y0 + doorH / 2 + GAP / 2, z - 0.01);
  g.add(door);
  const win = box(w * 0.7, doorH * 0.5, 0.002, FIXED.ovenWindow);
  win.position.set(cx, y0 + doorH * 0.45, z + 0.0005);
  g.add(win);
  const bar = cylinder(0.009, w * 0.8, FIXED.steel);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(cx, y0 + doorH - 0.04, z + 0.035);
  g.add(bar);
  for (const s of [-1, 1]) {
    const leg = cylinder(0.006, 0.035, FIXED.steel, 12);
    leg.rotation.x = Math.PI / 2;
    leg.position.set(cx + s * w * 0.38, y0 + doorH - 0.04, z + 0.0175);
    g.add(leg);
  }
}

function buildSink(g: THREE.Group, sw: number, sd: number, sz: number, top: number, m: THREE.Material) {
  const depth = 0.19;
  const t = 0.004;
  boxAt(g, -sw / 2, sw / 2, top - depth - t, top - depth, sz - sd / 2, sz + sd / 2, m);
  boxAt(g, -sw / 2, -sw / 2 + t, top - depth, top - 0.001, sz - sd / 2, sz + sd / 2, m);
  boxAt(g, sw / 2 - t, sw / 2, top - depth, top - 0.001, sz - sd / 2, sz + sd / 2, m);
  boxAt(g, -sw / 2, sw / 2, top - depth, top - 0.001, sz - sd / 2, sz - sd / 2 + t, m);
  boxAt(g, -sw / 2, sw / 2, top - depth, top - 0.001, sz + sd / 2 - t, sz + sd / 2, m);
  const drain = cylinder(0.035, 0.003, FIXED.chrome);
  drain.position.set(0, top - depth + 0.001, sz);
  g.add(drain);
}

/** Rechteck mit gerundeten Ecken (Mittelpunkt 0/0) */
function roundedRect<T extends THREE.Path = THREE.Shape>(w: number, h: number, r: number, shape: T = new THREE.Shape() as unknown as T): T {
  const x = -w / 2, y = -h / 2;
  r = Math.min(r, w / 2, h / 2);
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r);
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  return shape;
}

/** waagerechte Form (x/z) senkrecht extrudieren: Unterkante y0, Höhe h */
function extrudeFlat(shape: THREE.Shape, y0: number, h: number, cx: number, cz: number, m: THREE.Material) {
  const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 10 });
  geo.rotateX(-Math.PI / 2);
  geo.computeVertexNormals();
  applyBoxUV(geo);
  const me = mesh(geo, m);
  me.position.set(cx, y0, cz);
  return me;
}

/**
 * Unterbaubecken (BLANCO SUBLINE 500-U): Becken 500 × 400 × 190 mm unter der Platte,
 * Innenradius 10 mm, Wandstärke ca. 15 mm, Montagerand, InFino-Ablauf hinten mittig.
 */
function buildUndermountSink(g: THREE.Group, sw: number, sd: number, sz: number, under: number, m: THREE.Material) {
  const depth = 0.19;
  const t = 0.015;
  const r = 0.01;
  const bottom = under - depth;
  // Wanne: Außenkontur mit Innenkontur als Loch → echte Innenwände mit runden Ecken
  const wall = roundedRect(sw + 2 * t, sd + 2 * t, r + t);
  wall.holes.push(roundedRect(sw, sd, r, new THREE.Path()));
  g.add(extrudeFlat(wall, bottom - t, depth + t - 0.0005, 0, sz, m));
  // Boden
  g.add(extrudeFlat(roundedRect(sw + 0.001, sd + 0.001, r), bottom - t, t, 0, sz, m));
  // Montagerand unter der Platte (Außenmaß ca. 530 × 430)
  const rim = roundedRect(sw + 0.03 + 2 * t, sd + 0.03 + 2 * t, 0.02);
  rim.holes.push(roundedRect(sw + 2 * t - 0.002, sd + 2 * t - 0.002, r + t, new THREE.Path()));
  g.add(extrudeFlat(rim, under - 0.008, 0.0075, 0, sz, m));
  // InFino-Ablauf: Abdeckung farbgleich mit feinem Edelstahlring
  const dz = sz - sd / 2 + 0.075;
  const cover = cylinder(0.035, 0.004, m, 40);
  cover.position.set(0, bottom + 0.002, dz);
  g.add(cover);
  const ring = mesh(new THREE.TorusGeometry(0.036, 0.002, 8, 40), FIXED.steel);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(0, bottom + 0.0015, dz);
  g.add(ring);
}

/**
 * BLANCO KANO-S Vario (anthrazit/chrom) nach Maßzeichnung:
 * Fuß Ø 55, Körperhöhe 191, Hebel bis 217, Ausladung 223,5, Brause-Oberkante 182, Auslauf 129,5 mm.
 * Körper als Drehkörper, Auslauf als durchgehendes Rohr entlang einer Kurve.
 */
function buildKanoS(g: THREE.Group, x: number, top: number, z: number) {
  const body = FIXED.anthraciteMetal;
  const chrome = FIXED.chrome;
  const f = new THREE.Group();
  f.position.set(x, top, z);
  g.add(f);

  // Rosette (chrom)
  const rose = mesh(new THREE.CylinderGeometry(0.029, 0.0295, 0.004, 48), chrome);
  rose.position.y = 0.002;
  f.add(rose);
  // Körper: leicht konisch, oben verrundet
  const prof: THREE.Vector2[] = [];
  prof.push(new THREE.Vector2(0, 0.004), new THREE.Vector2(0.0272, 0.004));
  for (let i = 0; i <= 10; i++) {
    const y = 0.004 + (0.172 * i) / 10;
    prof.push(new THREE.Vector2(0.0272 - 0.0035 * (i / 10), y));
  }
  for (let i = 1; i <= 8; i++) {
    const a = (i / 8) * (Math.PI / 2);
    prof.push(new THREE.Vector2(0.0237 - 0.008 * (1 - Math.cos(a)) , 0.176 + 0.012 * Math.sin(a)));
  }
  prof.push(new THREE.Vector2(0, 0.188));
  f.add(mesh(new THREE.LatheGeometry(prof, 48), body));
  // Zierring (chrom) unter dem Kopf
  const band = mesh(new THREE.CylinderGeometry(0.0242, 0.0242, 0.004, 48), chrome);
  band.position.y = 0.168;
  f.add(band);

  // Auslauf + ausziehbare Brause: ein glattes Rohr vom Körper nach vorn abfallend
  const path = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.172, -0.005),
    new THREE.Vector3(0, 0.174, 0.04),
    new THREE.Vector3(0, 0.169, 0.11),
    new THREE.Vector3(0, 0.157, 0.175),
    new THREE.Vector3(0, 0.144, 0.212),
  ]);
  f.add(mesh(new THREE.TubeGeometry(path, 48, 0.0125, 32, false), body));
  // Fuge zwischen festem Auslauf und Brause (chrom)
  const tJoint = path.getTangent(0.55);
  const joint = mesh(new THREE.TorusGeometry(0.0127, 0.0012, 8, 32), chrome);
  joint.position.copy(path.getPoint(0.55));
  joint.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tJoint);
  f.add(joint);
  // Brausekopf: abgerundetes Ende mit Strahlregler
  const end = path.getPoint(1);
  const tEnd = path.getTangent(1);
  const capGeo = new THREE.SphereGeometry(0.0125, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  const cap = mesh(capGeo, body);
  cap.position.copy(end);
  cap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tEnd);
  cap.scale.set(1, 0.35, 1);
  f.add(cap);
  const aerator = mesh(new THREE.CylinderGeometry(0.0085, 0.0085, 0.003, 32), chrome);
  aerator.position.copy(end).addScaledVector(tEnd, 0.0035);
  aerator.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tEnd);
  f.add(aerator);
  // Ende am Körper verdeckt durch den Kopf; Bedienhebel oben (chrom), leicht nach hinten geneigt
  const lever = new THREE.Group();
  lever.position.set(0, 0.186, -0.004);
  lever.rotation.x = -0.45;
  const stem = mesh(new THREE.CylinderGeometry(0.0055, 0.0065, 0.03, 20), chrome);
  stem.position.y = 0.015;
  lever.add(stem);
  const knob = mesh(new THREE.SphereGeometry(0.0062, 20, 12), chrome);
  knob.position.y = 0.03;
  lever.add(knob);
  f.add(lever);
}

function buildFaucet(g: THREE.Group, x: number, top: number, z: number, m: THREE.Material) {
  const base = cylinder(0.025, 0.04, m);
  base.position.set(x, top + 0.02, z);
  g.add(base);
  const riser = cylinder(0.012, 0.3, m);
  riser.position.set(x, top + 0.19, z);
  g.add(riser);
  const arc = mesh(new THREE.TorusGeometry(0.1, 0.012, 16, 32, Math.PI), m);
  arc.rotation.y = -Math.PI / 2;
  arc.position.set(x, top + 0.34, z + 0.1);
  g.add(arc);
  const spout = cylinder(0.014, 0.07, m);
  spout.position.set(x, top + 0.31, z + 0.2);
  g.add(spout);
  const lever = cylinder(0.006, 0.08, m, 12);
  lever.rotation.z = Math.PI / 2.6;
  lever.position.set(x + 0.04, top + 0.08, z);
  g.add(lever);
}

function buildHob(g: THREE.Group, w: number, x: number, top: number, z: number, downdraft = false) {
  const d = 0.52;
  const glass = box(w, 0.006, d, FIXED.blackGlass, 0.002);
  glass.position.set(x, top + 0.003, z);
  g.add(glass);
  if (downdraft) {
    // mittiger Abzugsschacht des Muldenlüfters
    const vent = box(0.11, 0.004, d - 0.08, FIXED.darkMetal);
    vent.position.set(x, top + 0.0065, z);
    g.add(vent);
    for (let i = -4; i <= 4; i++) {
      const slat = box(0.004, 0.002, d - 0.1, FIXED.rubber);
      slat.position.set(x + i * 0.011, top + 0.0088, z);
      g.add(slat);
    }
  }
  const ringMat = new THREE.MeshPhysicalMaterial({ color: '#5a5a5c', roughness: 0.5 });
  const zones = w > 0.7
    ? [[-0.24, -0.1, 0.1], [-0.24, 0.13, 0.08], [0, 0, 0.13], [0.24, -0.1, 0.09], [0.24, 0.13, 0.1]]
    : [[-0.14, -0.11, 0.1], [-0.14, 0.12, 0.08], [0.14, -0.11, 0.08], [0.14, 0.12, 0.1]];
  for (const [zx, zz, r] of zones) {
    const ring = mesh(new THREE.RingGeometry(r - 0.003, r, 48), ringMat, false);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x + zx, top + 0.0062, z + zz);
    g.add(ring);
  }
}

function buildWallCabinet(g: THREE.Group, item: Item, W: number, D: number, H: number, mat: Mats) {
  const zFront = D / 2;
  const zBack = -D / 2;
  const cm = mat('carcass');
  const t = 0.018;
  if (item.front === 'open') {
    const fm = mat('front');
    boxAt(g, -W / 2, W / 2, 0, t, zBack, zFront, fm, 0.001);
    boxAt(g, -W / 2, W / 2, H - t, H, zBack, zFront, fm, 0.001);
    boxAt(g, -W / 2, -W / 2 + t, t, H - t, zBack, zFront, fm, 0.001);
    boxAt(g, W / 2 - t, W / 2, t, H - t, zBack, zFront, fm, 0.001);
    boxAt(g, -W / 2 + t, W / 2 - t, t, H - t, zBack, zBack + 0.008, cm);
    boxAt(g, -W / 2 + t, W / 2 - t, H / 2 - t / 2, H / 2 + t / 2, zBack + 0.008, zFront - 0.01, fm, 0.001);
    return;
  }
  boxAt(g, -W / 2, W / 2, 0, H, zBack, zFront - FRONT_T - 0.001, cm);
  const fronts = (item.front === 'single' ? [{ x0: -W / 2, x1: W / 2, y0: 0, y1: H, handle: 'right' as const }] : doorFronts(-W / 2, W / 2, 0, H, false)).map((f) => ({
    ...f,
    handle: (f.handle === 'right' ? 'right' : 'left') as FrontRect['handle'],
  }));
  // Griffe unten an Oberschränken
  const fm = mat('front');
  const hm = mat('handle');
  for (const f of fronts) {
    const x0 = f.x0 + GAP / 2;
    const x1 = f.x1 - GAP / 2;
    if (handleless) {
      // grifflos: Front steht unten über den Korpus hinaus und wird von unten gegriffen
      boxAt(g, x0, x1, -0.022, H - GAP / 2, zFront - FRONT_T, zFront, fm, 0.0015);
      continue;
    }
    boxAt(g, x0, x1, GAP / 2, H - GAP / 2, zFront - FRONT_T, zFront, fm, 0.0015);
    const len = 0.14;
    const hx = f.handle === 'right' ? x1 - 0.045 : x0 + 0.045;
    const bar = cylinder(0.006, len, hm, 16);
    bar.position.set(hx, 0.045 + len / 2, zFront + 0.028);
    g.add(bar);
    for (const s of [-1, 1]) {
      const leg = cylinder(0.005, 0.028, hm, 12);
      leg.rotation.x = Math.PI / 2;
      leg.position.set(hx, 0.045 + len / 2 + s * (len / 2 - 0.012), zFront + 0.014);
      g.add(leg);
    }
  }
  // LED-Unterbauleuchte
  const led = new THREE.MeshPhysicalMaterial({ color: '#fff8ea', emissive: new THREE.Color('#ffe7c4'), emissiveIntensity: 4 * (lampScale ?? 1) });
  boxAt(g, -W / 2 + 0.03, W / 2 - 0.03, -0.004, 0, zFront - 0.08, zFront - 0.06, led);
}

function buildTall(g: THREE.Group, item: Item, kind: string, W: number, D: number, H: number, P: number, mat: Mats) {
  const zFront = D / 2;
  const zBack = -D / 2;
  if (item.passage) {
    // Durchgang: Tür in Schrankoptik über die volle Höhe, seitlich schmale Zargen, kein Korpus
    boxAt(g, -W / 2, -W / 2 + 0.016, 0, H, zFront - 0.04, zFront - FRONT_T, mat('carcass'));
    boxAt(g, W / 2 - 0.016, W / 2, 0, H, zFront - 0.04, zFront - FRONT_T, mat('carcass'));
    const fronts: FrontRect[] = [{ x0: -W / 2 + 0.016, x1: W / 2 - 0.016, y0: 0.005, y1: H, handle: 'right' }];
    for (const f of fronts) {
      if (handleless) channelFront(g, f.x0 + GAP / 2, f.x1 - GAP / 2, f.y0, f.y1 - GAP / 2, zFront, 'top', mat('front'), mat('channel'));
      else {
        boxAt(g, f.x0 + GAP / 2, f.x1 - GAP / 2, f.y0, f.y1 - GAP / 2, zFront - FRONT_T, zFront, mat('front'), 0.0015);
        addHandle(g, 'right', f.x0, f.x1, 0.9, 1.2, zFront, mat('handle'));
      }
    }
    return;
  }
  boxAt(g, -W / 2 + 0.001, W / 2 - 0.001, 0, P, zBack + 0.02, zFront - 0.06, mat('front'));
  boxAt(g, -W / 2, W / 2, P, H, zBack, zFront - FRONT_T - 0.001, mat('carcass'));
  const y0 = P;
  const y1 = H;
  let fronts: FrontRect[] = [];
  if (item.front === 'single' && kind !== 'tallOven') {
    fronts = [{ x0: -W / 2, x1: W / 2, y0, y1, handle: 'right' }];
  } else if (kind === 'tallFridge') {
    const split = y0 + 0.72;
    const top = Math.min(y1, split + 1.22);
    fronts = [
      { x0: -W / 2, x1: W / 2, y0, y1: split, handle: 'right' },
      { x0: -W / 2, x1: W / 2, y0: split, y1: top, handle: 'right' },
    ];
    if (y1 - top > 0.05) fronts.push({ x0: -W / 2, x1: W / 2, y0: top, y1, handle: 'right' });
  } else if (kind === 'tallOven' && item.front === 'doors') {
    // Tür unten, Backofen-Nische, Tür, Lifttür oben (Aufteilung wie Plana VGLA)
    const ovenY0 = y0 + 0.507;
    const ovenY1 = ovenY0 + 0.595;
    const mid = ovenY1 + 0.445;
    fronts = [
      { x0: -W / 2, x1: W / 2, y0, y1: ovenY0, handle: 'right' },
      { x0: -W / 2, x1: W / 2, y0: ovenY1, y1: Math.min(mid, y1), handle: 'right' },
    ];
    if (y1 - mid > 0.05) fronts.push({ x0: -W / 2, x1: W / 2, y0: mid, y1, handle: 'right' });
    buildOvenFront(g, -W / 2, W / 2, ovenY0, ovenY1, zFront);
  } else if (item.front === 'single') {
    fronts = [{ x0: -W / 2, x1: W / 2, y0, y1, handle: 'right' }];
  } else if (kind === 'tallOven') {
    const d1 = y0 + 0.3;
    const d2 = d1 + 0.3;
    const oven = d2 + 0.595;
    const micro = oven + 0.385;
    fronts = drawerFronts(-W / 2, W / 2, y0, d2, [1, 1]);
    buildOvenFront(g, -W / 2, W / 2, d2, oven, zFront);
    buildMicrowave(g, -W / 2, W / 2, oven, micro, zFront);
    if (y1 - micro > 0.05) fronts.push({ x0: -W / 2, x1: W / 2, y0: micro, y1, handle: 'right' });
  } else {
    const split = y0 + (y1 - y0) * 0.6;
    fronts = [
      { x0: -W / 2, x1: W / 2, y0, y1: split, handle: 'right' },
      { x0: -W / 2, x1: W / 2, y0: split, y1, handle: 'right' },
    ];
  }
  // Griffe bei Hochschränken nahe der Teilungsfuge
  const fm = mat('front');
  const hm = mat('handle');
  for (const f of fronts) {
    const x0 = f.x0 + GAP / 2;
    const x1 = f.x1 - GAP / 2;
    const fy0 = f.y0 + GAP / 2;
    const fy1 = f.y1 - GAP / 2;
    if (handleless && item.grip === 'vertical') {
      // Öffnung über die senkrechte Griffleiste daneben: glatte Front ohne Mulde
      boxAt(g, x0, x1, fy0, fy1, zFront - FRONT_T, zFront, fm, 0.0015);
      continue;
    }
    if (handleless) {
      // untere Fronten werden oben gegriffen, obere Fronten von unten
      const side = f.handle === 'top' || (fy0 + fy1) / 2 < 1.0 ? 'top' : 'bottom';
      channelFront(g, x0, x1, fy0, fy1, zFront, side, fm, mat('channel'));
      continue;
    }
    boxAt(g, x0, x1, fy0, fy1, zFront - FRONT_T, zFront, fm, 0.0015);
    if (f.handle === 'top') {
      addHandle(g, 'top', x0, x1, fy0, fy1, zFront, hm);
    } else {
      const len = Math.min(0.3, (fy1 - fy0) * 0.5);
      const hy = fy0 < 1.0 ? fy1 - len / 2 - 0.05 : fy0 + len / 2 + 0.05;
      const bar = cylinder(0.006, len, hm, 16);
      bar.position.set(x1 - 0.045, hy, zFront + 0.028);
      g.add(bar);
      for (const s of [-1, 1]) {
        const leg = cylinder(0.005, 0.028, hm, 12);
        leg.rotation.x = Math.PI / 2;
        leg.position.set(x1 - 0.045, hy + s * (len / 2 - 0.012), zFront + 0.014);
        g.add(leg);
      }
    }
  }
}

function buildMicrowave(g: THREE.Group, x0: number, x1: number, y0: number, y1: number, z: number) {
  const w = x1 - x0 - GAP;
  const h = y1 - y0 - GAP;
  const cx = (x0 + x1) / 2;
  const body = box(w, h, 0.02, FIXED.blackGlass, 0.002);
  body.position.set(cx, y0 + h / 2 + GAP / 2, z - 0.01);
  g.add(body);
  const strip = box(w, 0.05, 0.022, FIXED.steel, 0.002);
  strip.position.set(cx, y0 + h - 0.025, z - 0.01);
  g.add(strip);
}

function buildHood(g: THREE.Group, W: number, D: number, H: number, ctx: BuildContext, item: Item) {
  const canopyH = 0.07;
  const m = FIXED.steel;
  boxAt(g, -W / 2, W / 2, 0, canopyH, -D / 2, D / 2, m, 0.003);
  const filter = box(W - 0.06, 0.002, D - 0.06, FIXED.darkMetal);
  filter.position.set(0, -0.001, 0);
  g.add(filter);
  const chimneyTop = Math.max(H, ctx.ceilingHeight - item.elevation / 100);
  boxAt(g, -0.13, 0.13, canopyH, chimneyTop, -D / 2, -D / 2 + 0.24, m, 0.002);
  const lamp = new THREE.MeshPhysicalMaterial({ color: '#fff', emissive: new THREE.Color('#fff2dc'), emissiveIntensity: 5 * (lampScale ?? 1) });
  for (const s of [-1, 1]) {
    const l = cylinder(0.025, 0.003, lamp);
    l.position.set(s * W * 0.25, -0.002, 0.05);
    g.add(l);
  }
}

function buildFridge(g: THREE.Group, W: number, D: number, H: number) {
  const m = FIXED.steel;
  boxAt(g, -W / 2, W / 2, 0.02, H, -D / 2, D / 2 - 0.06, m, 0.01);
  boxAt(g, -W / 2 + 0.02, W / 2 - 0.02, 0, 0.02, -D / 2 + 0.05, D / 2 - 0.1, FIXED.rubber);
  const split = W * 0.42;
  boxAt(g, -W / 2, -W / 2 + split - 0.003, 0.03, H, D / 2 - 0.06, D / 2, m, 0.008);
  boxAt(g, -W / 2 + split + 0.003, W / 2, 0.03, H, D / 2 - 0.06, D / 2, m, 0.008);
  const disp = box(0.16, 0.24, 0.006, FIXED.blackGlass, 0.004);
  disp.position.set(-W / 2 + split / 2, 1.15, D / 2 + 0.001);
  g.add(disp);
  for (const x of [-W / 2 + split - 0.04, -W / 2 + split + 0.04]) {
    const bar = cylinder(0.01, 0.75, FIXED.chrome);
    bar.position.set(x, H * 0.55, D / 2 + 0.045);
    g.add(bar);
    for (const s of [-1, 1]) {
      const leg = cylinder(0.008, 0.045, FIXED.chrome, 12);
      leg.rotation.x = Math.PI / 2;
      leg.position.set(x, H * 0.55 + s * 0.34, D / 2 + 0.022);
      g.add(leg);
    }
  }
}

function buildTable(g: THREE.Group, W: number, D: number, H: number, mat: Mats) {
  boxAt(g, -W / 2, W / 2, H - 0.04, H, -D / 2, D / 2, mat('countertop'), 0.004);
  const inset = 0.08;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const x = sx * (W / 2 - inset);
      const z = sz * (D / 2 - inset);
      boxAt(g, x - 0.025, x + 0.025, 0, H - 0.04, z - 0.025, z + 0.025, FIXED.darkMetal, 0.003);
    }
  boxAt(g, -W / 2 + inset, W / 2 - inset, H - 0.1, H - 0.04, -D / 2 + inset - 0.01, -D / 2 + inset + 0.01, FIXED.darkMetal);
  boxAt(g, -W / 2 + inset, W / 2 - inset, H - 0.1, H - 0.04, D / 2 - inset - 0.01, D / 2 - inset + 0.01, FIXED.darkMetal);
}

function buildStool(g: THREE.Group, W: number, H: number, mat: Mats) {
  const seatR = W * 0.45;
  const seat = mesh(new THREE.CylinderGeometry(seatR, seatR * 0.95, 0.05, 40), mat('countertop'));
  applyBoxUV(seat.geometry);
  seat.position.y = H - 0.025;
  g.add(seat);
  const legSpread = seatR * 0.8;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const top = new THREE.Vector3(Math.cos(a) * legSpread * 0.7, H - 0.05, Math.sin(a) * legSpread * 0.7);
    const bot = new THREE.Vector3(Math.cos(a) * legSpread * 1.15, 0, Math.sin(a) * legSpread * 1.15);
    const len = top.distanceTo(bot);
    const leg = cylinder(0.011, len, FIXED.darkMetal, 12);
    leg.position.copy(top).add(bot).multiplyScalar(0.5);
    leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(bot).normalize());
    g.add(leg);
  }
  const ring = mesh(new THREE.TorusGeometry(legSpread * 1.0, 0.008, 10, 40), FIXED.darkMetal);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = H * 0.35;
  g.add(ring);
}

function buildPendant(g: THREE.Group, item: Item, ctx: BuildContext) {
  const r = item.width / 200;
  const h = item.height / 100;
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 16; i++) {
    const a = (i / 16) * Math.PI * 0.5;
    pts.push(new THREE.Vector2(Math.max(0.012, Math.sin(a) * r), Math.cos(a) * h));
  }
  const shade = mesh(new THREE.LatheGeometry(pts, 48), FIXED.lampShade, true);
  g.add(shade);
  const bulbMat = FIXED.bulb.clone();
  bulbMat.emissiveIntensity = 6 * lampScale;
  const bulb = mesh(new THREE.SphereGeometry(0.035, 24, 16), bulbMat, false);
  bulb.position.y = 0.05;
  g.add(bulb);
  const cordLen = Math.max(0.05, ctx.ceilingHeight - item.elevation / 100 - h);
  const cord = cylinder(0.003, cordLen, FIXED.rubber, 8);
  cord.position.y = h + cordLen / 2;
  g.add(cord);
  const rose = cylinder(0.05, 0.02, FIXED.lampShade, 24);
  rose.position.y = h + cordLen - 0.01;
  g.add(rose);
  // Leuchtmittel als Spot nach unten mit weicher Kante; „radius“ = leuchtende Öffnung
  // (erzeugt im fotorealistischen Modus weiche Schatten statt harter Punktlicht-Schatten)
  const st = ctx.project.settings;
  const soft = st.softness ?? 0.6;
  const light = new THREE.SpotLight('#ffd6a0', 14 * (st.lampIntensity ?? 1), 0, 1.25, 1, 2);
  (light as THREE.SpotLight & { radius: number }).radius = 0.03 + soft * (r * 0.9);
  light.position.y = 0.04;
  light.target.position.set(0, -1, 0);
  light.userData.pendant = true;
  g.add(light, light.target);
}
