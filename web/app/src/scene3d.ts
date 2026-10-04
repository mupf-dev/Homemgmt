import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { GradientEquirectTexture, WebGLPathTracer } from 'three-gpu-pathtracer';
import { store } from './state';
import type { Floor, Project, Vec2, Wall } from './model/types.ts';
import { box, buildItem, applyBoxUV } from './models';
import { FIXED, setMaxAnisotropy, slotMaterial } from './materials';
import { countertopRuns, floorPolygon, itemCorners, projectOnWall, wallDir, wallLength } from './model/geom.ts';
import { getEntry } from './model/catalog.ts';
import { floorView } from './model/house.ts';
import { compartments } from './model/storage.ts';
import { Walker } from './walker.ts';

const M = 0.01; // cm -> m

/** Was die 3D-Ansicht zeigt: nur die aktive Etage, alle Etagen bis zur aktiven (Blick von oben ins Haus) oder alles */
export type HouseMode = 'floor' | 'stack' | 'house';

/** Füllstand eines Fachs für die Lager-Ansicht */
export interface FachInfo {
  count: number;
  expired: boolean;
  soon: boolean;
}

const ROOF_MAT = new THREE.MeshPhysicalMaterial({ color: '#8e4535', roughness: 0.8, metalness: 0 });

const FACH_COLORS = { empty: '#5b8def', full: '#2f9e6b', soon: '#e8912d', expired: '#d64545', hit: '#ffd400' };
const fachMats = new Map<string, THREE.MeshBasicMaterial>();
const fachMat = (color: string, opacity: number) => {
  const k = `${color}/${opacity}`;
  if (!fachMats.has(k)) fachMats.set(k, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
  return fachMats.get(k)!;
};

export class Scene3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.05, 200);
  private controls: OrbitControls;
  private walk: PointerLockControls;
  private composer: EffectComposer;
  private gtao: GTAOPass;
  private content = new THREE.Group();
  private sun = new THREE.DirectionalLight('#fff4e5', 3.2);
  private hemi = new THREE.HemisphereLight('#f4f7ff', '#8a7f72', 0.0);
  /** Mond- und Himmelslicht in der Nacht (nur „draußen wie echt“) */
  private moon = new THREE.HemisphereLight('#9fb4e6', '#1f2b1c', 0.0);
  private selectionBox = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color('#ff7a1a'));
  private sky: GradientEquirectTexture;
  private pathTracer: WebGLPathTracer | null = null;
  private ptActive = false;
  private ptSceneDirty = false;
  private dirty = true;
  private keys = new Set<string>();
  private lastTime = performance.now();
  private resizeObserver: ResizeObserver;
  private firstBuild = true;
  private ground: THREE.Mesh;
  private groundPlain!: THREE.Material;
  private groundLawn: THREE.Material | null = null;
  /** Rasen statt grauer Fläche ums Haus (Wandterminal) */
  lawn = false;
  /** Draußen wie echt: Sonnenstand (Grad), Nordrichtung des Grundrisses, Bewölkung (%), Regen – sonst Tageszeit-Regler */
  outdoor: { azimuth: number; altitude: number; north: number; cloud: number; rain: boolean } | null = null;
  onSamples?: (n: number) => void;
  onWalkChange?: (active: boolean) => void;
  /** Begehen: aktuelle Etage und Raum (für die Anzeige) */
  onWalkWhere?: (floor: Floor, room: string | null) => void;
  /** Ansicht wurde von der Szene selbst umgeschaltet (Begehen) */
  onModeChange?: (mode: HouseMode) => void;
  private walker: Walker | null = null;
  private walkPrevMode: HouseMode = 'floor';
  private walkWhere = '';
  /** Ansicht: aktive Etage, bis zur aktiven Etage oder ganzes Haus */
  mode: HouseMode = 'floor';
  /** Lager-Ansicht: Fächer farbig nach Füllstand, anklickbar */
  storageMode = false;
  /** Füllstand je Fach (aus dem Lager) */
  fachInfo?: (itemId: string, row: number) => FachInfo | null;
  /** hervorgehobene Fächer (Suche), Schlüssel „<Möbel-ID>:<Fach>“ */
  highlight = new Set<string>();
  /** Heatmap statt Füllstand: Wert 0…1 je Fach (blau → rot) */
  heatInfo?: (itemId: string, row: number) => number | null;
  /** Klick auf ein Fach in der Lager-Ansicht */
  onFach?: (itemId: string, row: number, floorId: string) => void;

  constructor(private container: HTMLElement) {
    RectAreaLightUniformsLib.init();
    const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.AgXToneMapping;
    r.toneMappingExposure = 1.0;
    r.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(r.domElement);
    this.renderer = r;
    setMaxAnisotropy(r.capabilities.getMaxAnisotropy());

    // Himmel als Umgebung (wird auch vom Pathtracer genutzt)
    this.sky = new GradientEquirectTexture(256);
    this.sky.topColor.set('#bcd3ee');
    this.sky.bottomColor.set('#e9e4da');
    this.sky.exponent = 0.6;
    this.sky.update();
    this.scene.background = this.sky;
    this.scene.environment = this.sky;
    this.scene.environmentIntensity = 1.0;

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 4;
    this.scene.add(this.sun, this.sun.target, this.hemi, this.moon);
    this.scene.add(this.content);
    this.selectionBox.visible = false;
    this.scene.add(this.selectionBox);

    // Außengelände
    this.groundPlain = new THREE.MeshPhysicalMaterial({ color: '#a7a296', roughness: 1 });
    const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 64), this.groundPlain);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.ground = ground;

    this.camera.position.set(2.3, 3.2, 6.5);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(2.3, 1, 2);
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.addEventListener('change', () => this.cameraChanged());

    this.walk = new PointerLockControls(this.camera, r.domElement);
    this.walk.addEventListener('lock', () => this.onWalkChange?.(true));
    this.walk.addEventListener('unlock', () => {
      this.controls.enabled = true;
      this.keys.clear();
      this.walker = null;
      // vorherige Ansicht wiederherstellen; in der Etagenansicht liegt die aktive Etage auf Höhe 0
      if (this.mode !== this.walkPrevMode) {
        this.mode = this.walkPrevMode;
        if (this.mode === 'floor') this.camera.position.y -= store.floor.elevation * M;
        this.build();
        this.onModeChange?.(this.mode);
      }
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      this.controls.target.copy(this.camera.position).addScaledVector(dir, 1.5);
      this.onWalkChange?.(false);
    });
    this.walk.addEventListener('change', () => this.cameraChanged());

    // Nachbearbeitung: Ambient Occlusion für Kontaktschatten
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(r, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.gtao = new GTAOPass(this.scene, this.camera, 1, 1);
    this.gtao.blendIntensity = 0.9;
    this.gtao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.5, thickness: 1, scale: 1.2 });
    this.composer.addPass(this.gtao);
    this.composer.addPass(new OutputPass());

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.bindInput();
    this.build();
    store.subscribe(() => this.build());
    store.onFloor(() => this.build());
    // nachgeladene Bilder: neu aufbauen (Seitenverhältnis ist erst jetzt bekannt)
    let reloadTimer = 0;
    document.addEventListener('kp-texture-loaded', () => {
      clearTimeout(reloadTimer);
      reloadTimer = window.setTimeout(() => this.build(), 50);
    });
    r.setAnimationLoop(() => this.frame());
  }

  // -------------------------------------------------------------------------

  private bindInput() {
    const el = this.renderer.domElement;
    let down: { x: number; y: number } | null = null;
    el.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
    el.addEventListener('pointerup', (e) => {
      if (!down || this.walk.isLocked) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 4) return;
      this.pick(e);
    });
    el.addEventListener('dblclick', (e) => {
      // Doppelklick: Kameraziel auf getroffenen Punkt setzen
      const hit = this.raycast(e);
      if (hit) {
        this.controls.target.copy(hit.point);
        this.cameraChanged();
      }
    });
    window.addEventListener('keydown', (e) => {
      if (this.walk.isLocked) this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  private raycast(e: MouseEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, this.camera);
    return rc.intersectObject(this.content, true)[0];
  }

  /** Showroom: keine Auswahl, keine Auswahlrahmen */
  private showroomMode = false;
  setShowroom(on: boolean) {
    this.showroomMode = on;
    if (!on) this.setAutoRotate(false);
    this.updateSelection();
  }

  /** Automatischer Rundgang (Kamera kreist langsam um den Raum) */
  setAutoRotate(on: boolean) {
    this.controls.autoRotate = on;
    this.controls.autoRotateSpeed = 0.5;
    if (on && this.walk.isLocked) this.walk.unlock();
    this.dirty = true;
  }

  get autoRotate() {
    return this.controls.autoRotate;
  }

  private pick(e: MouseEvent) {
    if (this.showroomMode) return;
    const hit = this.raycast(e);
    let o: THREE.Object3D | null = hit?.object ?? null;
    let fach: { itemId: string; row: number } | null = null;
    while (o && !o.userData.itemId && !o.userData.wallId) {
      if (o.userData.fach) fach = o.userData.fach;
      o = o.parent;
    }
    // Etage des Treffers wird zur aktiven Etage
    let f: THREE.Object3D | null = o;
    while (f && !f.userData.floorId) f = f.parent;
    const floorId: string | undefined = f?.userData.floorId;
    if (fach && floorId) {
      this.onFach?.(fach.itemId, fach.row, floorId);
      return;
    }
    if (floorId && floorId !== store.floorId) store.setFloor(floorId);
    if (o?.userData.itemId) store.select({ kind: 'item', id: o.userData.itemId });
    else if (o?.userData.wallId) store.select({ kind: 'wall', id: o.userData.wallId });
    else store.select(null);
  }

  private resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer.setSize(w, h);
    this.gtao.setSize(w, h);
    this.cameraChanged();
  }

  private cameraChanged() {
    this.dirty = true;
    if (this.pathTracer && this.ptActive) this.pathTracer.updateCamera();
  }

  // -------------------------------------------------------------------------
  // Szene aus dem Projekt aufbauen

  /** Etagen, die gerade zu sehen sind */
  visibleFloors(): Floor[] {
    const all = store.house.floors;
    const active = store.floor;
    if (this.mode === 'floor') return [active];
    if (this.mode === 'stack') return all.filter((f) => f.elevation <= active.elevation);
    return all;
  }

  /** Höhenlage (m) einer Etage in der Szene – in der Etagenansicht liegt die aktive Etage auf 0 */
  floorY(f: Floor) {
    return this.mode === 'floor' ? 0 : f.elevation * M;
  }

  build() {
    this.content.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose();
    });
    this.content.clear();
    const house = store.house;
    const floors = this.visibleFloors();
    for (const f of floors) {
      const g = new THREE.Group();
      g.userData.floorId = f.id;
      g.position.y = this.floorY(f);
      this.buildFloorContent(floorView(house, f), f, g, f.id === store.floorId);
      if (this.mode !== 'floor') this.addSlab(f, g);
      this.content.add(g);
    }
    // Keller wären unter dem Gelände versteckt; mit Rasen liegt der Keller (wie echt) darunter – außer man schaut auf ihn
    // Rasen liegt auf Geländehöhe – der Keller liegt darunter. Schaut man auf den Keller, wird der Rasen ausgeblendet
    // (Etage „Keller“ allein: neutraler Boden statt Rasen).
    const top = Math.max(...floors.map((f) => f.elevation));
    const underground = top < -1;
    this.ground.material = this.lawn && !underground ? this.lawnMaterial() : this.groundPlain;
    this.ground.visible = this.mode === 'floor' || (this.lawn ? !underground : !floors.some((f) => f.elevation < -1));

    const p = store.project;
    this.updateSun(p);
    this.updateSelection();
    if (this.firstBuild && p.walls.length) {
      this.firstBuild = false;
      this.setView('perspective');
    }
    this.dirty = true;
    if (this.ptActive) this.ptSceneDirty = true;
  }

  /** Innen liegende Etage direkt über bzw. unter einer Etage (Außenbereich zählt nicht) */
  private floorAbove(f: Floor) {
    if (f.kind === 'outdoor') return undefined;
    return store.house.floors.filter((x) => x.elevation > f.elevation && x.kind !== 'outdoor').sort((a, b) => a.elevation - b.elevation)[0];
  }
  private floorBelow(f: Floor) {
    if (f.kind === 'outdoor') return undefined;
    return store.house.floors.filter((x) => x.elevation < f.elevation && x.kind !== 'outdoor').sort((a, b) => b.elevation - a.elevation)[0];
  }

  /** Treppenaussparungen in Decke und Boden einer Etage: Grundrisse der Treppen in der Etage darunter */
  private stairHoles(f: Floor): Vec2[][] {
    const below = this.floorBelow(f);
    if (!below) return [];
    return below.items.filter((it) => getEntry(it.type).kind === 'stairs').map((it) => itemCorners(it));
  }

  /** Geschossdecke unter einer Etage: zwischen Raumhöhe der Etage darunter und Fußboden, mit Treppenloch */
  private addSlab(f: Floor, g: THREE.Group) {
    const below = this.floorBelow(f);
    if (!below || f.kind === 'outdoor') return;
    const thick = Math.min(0.6, Math.max(0.12, (f.elevation - below.elevation - below.height) * M));
    const poly = floorPolygon(floorView(store.house, f));
    if (poly.length < 3) return;
    const shape = new THREE.Shape(poly.map((v) => new THREE.Vector2(v.x * M, -v.y * M)));
    for (const h of this.stairHoles(f)) shape.holes.push(new THREE.Path(h.map((v) => new THREE.Vector2(v.x * M, -v.y * M))));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false });
    const slab = new THREE.Mesh(geo, FIXED.frame);
    slab.rotation.x = -Math.PI / 2;
    slab.position.y = -thick - 0.002;
    slab.castShadow = true;
    slab.receiveShadow = true;
    g.add(slab);
  }

  private buildFloorContent(p: Project, floor: Floor, g: THREE.Group, active: boolean) {
    const ceilingH = Math.max(2.5, ...p.walls.map((w) => w.height * M));
    const above = this.floorAbove(floor);
    const storey = above ? above.elevation - floor.elevation : null;
    // In der Haus-/Bis-hier-Ansicht reichen die Wände bis zum Boden der Etage darüber (keine Lücke, Decke liegt dazwischen)
    const upToAbove = storey !== null && this.mode !== 'floor' && this.visibleFloors().includes(above!);
    const roof = floor.roof;
    const tan = roof ? Math.tan((roof.pitch * Math.PI) / 180) : 0;
    for (const w of p.walls) {
      let height = upToAbove ? storey! : w.height;
      if (roof) {
        // Dachgeschoss: Traufwände (parallel zum First) enden unter der Dachfläche, Giebelwände auf Kniestockhöhe (+ Giebeldreieck)
        const d = wallDir(w);
        const alongRidge = roof.ridge === 'x' ? Math.abs(d.x) > Math.abs(d.y) : Math.abs(d.y) > Math.abs(d.x);
        height = Math.min(w.height, alongRidge ? roof.knee - (w.thickness / 2) * tan - 1 : roof.knee);
      }
      g.add(this.buildWall(p, { ...w, height: Math.max(1, height) }));
    }
    if (roof) this.buildRoof(floor, p, g, this.mode === 'house');
    this.buildFloor(p, floor, g, ceilingH, active && this.mode === 'floor');
    const runs = countertopRuns(p);
    for (const raw of p.items) {
      // Treppe genau bis zur Etage darüber
      const it = getEntry(raw.type).kind === 'stairs' && storey && Math.abs(storey - raw.height) < 120 ? { ...raw, height: storey - raw.elevation } : raw;
      const limit = this.backsplashLimit(p, it.wallId, it);
      const ig = buildItem(it, { project: p, ceilingHeight: ceilingH, backsplashLimit: limit, run: runs.get(it.id) });
      ig.position.set(it.x * M, it.elevation * M, it.y * M);
      ig.rotation.y = -it.rotation;
      if (this.storageMode && !this.ptActive) this.addFachMarks(ig, it, p);
      g.add(ig);
    }
  }

  /** Fächer eines Möbels als farbige Flächen vor der Front (Schubladen, Türen) bzw. als Volumen (offene Böden) */
  private addFachMarks(g: THREE.Group, it: Project['items'][number], p: Project) {
    for (const c of compartments(it, p.settings)) {
      const info = this.fachInfo?.(it.id, c.row) ?? null;
      const hit = this.highlight.has(`${it.id}:${c.row}`);
      const heat = this.heatInfo ? this.heatInfo(it.id, c.row) : null;
      const color = hit ? FACH_COLORS.hit
        : this.heatInfo ? (heat === null ? '#9aa0a6' : `#${new THREE.Color().setHSL((1 - heat) * 0.62, 0.8, 0.5).getHexString()}`)
        : !info || !info.count ? FACH_COLORS.empty : info.expired ? FACH_COLORS.expired : info.soon ? FACH_COLORS.soon : FACH_COLORS.full;
      const w = Math.max(0.01, (c.x1 - c.x0) * M - 0.012);
      const h = Math.max(0.01, (c.y1 - c.y0) * M - 0.012);
      const open = c.kind === 'open' || c.kind === 'surface';
      const d = open ? Math.max(0.01, (c.z1 - c.z0) * M - 0.02) : 0.006;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), fachMat(color, hit ? 0.75 : this.heatInfo ? (heat === null ? 0.15 : 0.6) : info?.count ? 0.5 : 0.22));
      m.position.set(((c.x0 + c.x1) / 2) * M, ((c.y0 + c.y1) / 2) * M, open ? ((c.z0 + c.z1) / 2) * M : c.z1 * M + 0.006);
      m.userData.fach = { itemId: it.id, row: c.row };
      m.renderOrder = 2;
      g.add(m);
    }
  }

  private backsplashLimit(p: Project, wallId: string | undefined, it: { x: number; y: number; width: number }) {
    if (!wallId) return undefined;
    const w = p.walls.find((x) => x.id === wallId);
    if (!w) return undefined;
    const t = projectOnWall(w, it).t;
    let limit = Infinity;
    for (const o of p.openings) {
      if (o.wallId !== w.id || o.type !== 'window') continue;
      if (Math.abs(o.offset - t) < (o.width + it.width) / 2) limit = Math.min(limit, o.sill * M);
    }
    return limit === Infinity ? undefined : limit;
  }

  private buildWall(p: Project, w: Wall) {
    const g = new THREE.Group();
    g.userData.wallId = w.id;
    const L = wallLength(w) * M;
    const t = w.thickness * M;
    const H = w.height * M;
    const d = wallDir(w);
    const connected = (pt: { x: number; y: number }) =>
      p.walls.some((o) => o.id !== w.id && (Math.hypot(o.a.x - pt.x, o.a.y - pt.y) < 1 || Math.hypot(o.b.x - pt.x, o.b.y - pt.y) < 1));
    const extA = connected(w.a) ? t / 2 : 0;
    const extB = connected(w.b) ? t / 2 : 0;
    const mat = slotMaterial(p, 'wall', undefined, undefined, p.uv?.wall, { u0: -extA, u1: L + extB, v0: 0, v1: H });

    const ops = p.openings.filter((o) => o.wallId === w.id).sort((a, b) => a.offset - b.offset);
    const piece = (x0: number, x1: number, y0: number, y1: number) => {
      if (x1 - x0 < 0.001 || y1 - y0 < 0.001) return;
      const c = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, 0);
      const m = box(x1 - x0, y1 - y0, t, mat, 0, c);
      m.position.copy(c);
      g.add(m);
    };
    let x = -extA;
    for (const o of ops) {
      const o0 = Math.max(0, (o.offset - o.width / 2) * M);
      const o1 = Math.min(L, (o.offset + o.width / 2) * M);
      piece(x, o0, 0, H);
      piece(o0, o1, 0, o.sill * M);
      piece(o0, o1, (o.sill + o.height) * M, H);
      this.buildOpening(g, o.type, o0, o1, o.sill * M, (o.sill + o.height) * M, t);
      x = o1;
    }
    piece(x, L + extB, 0, H);

    g.position.set(w.a.x * M, 0, w.a.y * M);
    g.rotation.y = -Math.atan2(d.y, d.x);
    return g;
  }

  private buildOpening(g: THREE.Group, type: 'door' | 'window' | 'passage', x0: number, x1: number, y0: number, y1: number, t: number) {
    const fw = 0.06;
    const w = x1 - x0;
    const h = y1 - y0;
    const cx = (x0 + x1) / 2;
    const add = (m: THREE.Mesh, x: number, y: number, z: number) => {
      m.position.set(x, y, z);
      g.add(m);
    };
    if (type === 'window') {
      const fd = 0.07;
      const fm = FIXED.frameDark;
      add(box(w, fw, fd, fm), cx, y0 + fw / 2, 0);
      add(box(w, fw, fd, fm), cx, y1 - fw / 2, 0);
      add(box(fw, h, fd, fm), x0 + fw / 2, (y0 + y1) / 2, 0);
      add(box(fw, h, fd, fm), x1 - fw / 2, (y0 + y1) / 2, 0);
      if (w > 1.1) add(box(fw * 0.8, h - fw * 2, fd, fm), cx, (y0 + y1) / 2, 0);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(w - fw * 2, h - fw * 2, 0.008), FIXED.glass);
      applyBoxUV(glass.geometry);
      add(glass, cx, (y0 + y1) / 2, 0);
      // Fensterbänke innen und außen
      if (y0 > 0.05) {
        for (const s of [-1, 1]) {
          const sill = box(w + 0.04, 0.025, t / 2 + 0.03, FIXED.frame, 0.002);
          add(sill, cx, y0 - 0.0125, s * (t / 4 + 0.015));
        }
      }
    } else if (type === 'passage') {
      // Durchgang: nur die Laibung oben
      add(box(w, 0.02, t + 0.01, FIXED.frame), cx, y1 - 0.01, 0);
    } else {
      const zt = 0.02;
      const fm = FIXED.frame;
      add(box(zt, h, t + 0.02, fm), x0 + zt / 2, h / 2 + y0, 0);
      add(box(zt, h, t + 0.02, fm), x1 - zt / 2, h / 2 + y0, 0);
      add(box(w, zt, t + 0.02, fm), cx, y1 - zt / 2, 0);
      const leaf = box(w - zt * 2 - 0.004, h - zt - 0.01, 0.04, fm, 0.002);
      add(leaf, cx, y0 + (h - zt) / 2 + 0.005, 0);
      for (const s of [-1, 1]) {
        const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.13, 16), FIXED.chrome);
        handle.rotation.z = Math.PI / 2;
        handle.castShadow = true;
        add(handle, x1 - zt - 0.1, y0 + 1.05, s * 0.06);
      }
    }
  }

  /** Bodenfläche als Mesh (UVs = Formkoordinaten in Metern, Material je Raum möglich) */
  private floorMesh(p: Project, poly: Vec2[], override?: string, holes: Vec2[][] = []) {
    const shapeFloor = new THREE.Shape(poly.map((v) => new THREE.Vector2(v.x * M, -v.y * M)));
    for (const h of holes) shapeFloor.holes.push(new THREE.Path(h.map((v) => new THREE.Vector2(v.x * M, -v.y * M))));
    const xs = poly.map((v) => v.x * M);
    const ys = poly.map((v) => v.y * M);
    const bx0 = Math.min(...xs), bx1 = Math.max(...xs), by0 = Math.min(...ys), by1 = Math.max(...ys);
    // ShapeGeometry-UVs = Formkoordinaten (x, −y) in Metern
    const floor = new THREE.Mesh(new THREE.ShapeGeometry(shapeFloor), slotMaterial(p, 'floor', override, undefined, p.uv?.floor, { u0: bx0, u1: bx1, v0: -by1, v1: -by0 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    floor.userData.floor = true;
    return floor;
  }

  /** Carport: vier Pfosten und ein flaches Dach über der Fläche */
  private buildCarportRoof(poly: Vec2[], g: THREE.Group) {
    const xs = poly.map((v) => v.x * M);
    const zs = poly.map((v) => v.y * M);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    const h = 2.3;
    for (const x of [x0 + 0.06, x1 - 0.06]) for (const z of [z0 + 0.06, z1 - 0.06]) {
      const post = box(0.1, h, 0.1, FIXED.anthraciteMetal);
      post.position.set(x, h / 2, z);
      g.add(post);
    }
    const roof = box(x1 - x0 + 0.3, 0.1, z1 - z0 + 0.3, FIXED.anthraciteMetal, 0.005);
    roof.position.set((x0 + x1) / 2, h + 0.05, (z0 + z1) / 2);
    g.add(roof);
  }

  /** Satteldach über einer Etage: Traufe in Kniestockhöhe, First entlang x oder y, Giebeldreiecke an den Enden */
  private buildRoof(fl: Floor, p: Project, g: THREE.Group, withRoof: boolean) {
    const roof = fl.roof;
    if (!roof) return;
    const poly = floorPolygon(p);
    if (poly.length < 3) return;
    const xs = poly.map((v) => v.x * M);
    const zs = poly.map((v) => v.y * M);
    const t = Math.max(0.12, ...p.walls.map((w) => w.thickness * M)); // Wandstärke
    const ov = 0.35 + t / 2; // Dachüberstand ab Wandachse
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    const alongX = roof.ridge === 'x';
    const span = alongX ? z1 - z0 : x1 - x0; // quer zum First, Achsmaß
    const length = (alongX ? x1 - x0 : z1 - z0) + 2 * ov;
    const knee = roof.knee * M;
    const tan = Math.tan((roof.pitch * Math.PI) / 180);
    const rise = (span / 2) * tan;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const plate = 0.06;
    // Unterseite der Dachfläche verläuft durch die Wandachse auf Kniestockhöhe
    const lift = plate / 2 / Math.cos(Math.atan(tan)) + 0.01;
    if (withRoof) {
      const slope = (span / 2 + ov) / Math.cos(Math.atan(tan));
      for (const sd of [-1, 1]) {
        const plane = box(alongX ? length : slope, plate, alongX ? slope : length, ROOF_MAT);
        const ang = Math.atan(tan);
        const off = (span / 2 + ov) / 2; // Mitte der Fläche, vom First nach außen
        const y = knee + rise - off * tan + lift;
        if (alongX) {
          plane.position.set(cx, y, cz + sd * off);
          plane.rotation.x = sd * ang;
        } else {
          plane.position.set(cx + sd * off, y, cz);
          plane.rotation.z = -sd * ang;
        }
        plane.castShadow = true;
        g.add(plane);
      }
    }
    // Giebeldreiecke in Wandstärke über dem Kniestock (gehören zu den Giebelwänden – auch ohne Dach sichtbar)
    const half = span / 2 + t / 2;
    const tri = new THREE.Shape([new THREE.Vector2(-half, 0), new THREE.Vector2(half, 0), new THREE.Vector2(0, half * tan)]);
    const geo = new THREE.ExtrudeGeometry(tri, { depth: t, bevelEnabled: false });
    const wallMat = slotMaterial(p, 'wall');
    for (const end of [0, 1]) {
      const m = new THREE.Mesh(geo, wallMat);
      if (alongX) {
        m.rotation.y = Math.PI / 2;
        m.position.set((end ? x1 : x0) - t / 2, knee - (t / 2) * tan, cz);
      } else m.position.set(cx, knee - (t / 2) * tan, (end ? z1 : z0) - t / 2);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
  }

  private buildFloor(p: Project, fl: Floor, g: THREE.Group, ceilingH: number, withCeiling: boolean) {
    // Außenflächen (Carport, Stellplatz, Terrasse …) haben keine Wände
    for (const r of fl.rooms) {
      if (!r.polygon || r.polygon.length < 3 || !(r.kind || fl.kind === 'outdoor')) continue;
      const m = this.floorMesh(p, r.polygon, r.floorMaterial ?? (r.kind === 'terrace' ? 'floor-tile-dark' : 'stone-concrete'));
      m.position.y = 0.004;
      g.add(m);
      if (r.kind === 'carport') this.buildCarportRoof(r.polygon, g);
    }
    const poly = floorPolygon(p);
    if (poly.length < 3 || !p.walls.length) return;
    const holes = this.stairHoles(fl);
    g.add(this.floorMesh(p, poly, undefined, holes));
    // Räume mit eigenem Belag liegen 1 mm über der Grundfläche
    for (const r of fl.rooms) {
      if (!r.polygon || r.polygon.length < 3 || !r.floorMaterial) continue;
      const m = this.floorMesh(p, r.polygon, r.floorMaterial, holes);
      m.position.y = 0.001;
      g.add(m);
    }
    const xs = poly.map((v) => v.x * M);
    const ys = poly.map((v) => v.y * M);
    const bx0 = Math.min(...xs), bx1 = Math.max(...xs), by0 = Math.min(...ys), by1 = Math.max(...ys);

    if (p.settings.ceiling && withCeiling) {
      const shapeCeil = new THREE.Shape(poly.map((v) => new THREE.Vector2(v.x * M, v.y * M)));
      const ceil = new THREE.Mesh(new THREE.ShapeGeometry(shapeCeil), slotMaterial(p, 'ceiling', undefined, undefined, p.uv?.ceiling, { u0: bx0, u1: bx1, v0: by0, v1: by1 }));
      ceil.rotation.x = Math.PI / 2;
      ceil.position.y = ceilingH;
      ceil.castShadow = true;
      ceil.receiveShadow = true;
      g.add(ceil);

      // Deckenleuchten (Flächenlicht) im Raster
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const v of poly) {
        minX = Math.min(minX, v.x);
        minY = Math.min(minY, v.y);
        maxX = Math.max(maxX, v.x);
        maxY = Math.max(maxY, v.y);
      }
      const nx = Math.max(1, Math.round((maxX - minX) / 200));
      const ny = Math.max(1, Math.round((maxY - minY) / 200));
      const lamps = p.settings.lampIntensity ?? 1;
      const panelMat = new THREE.MeshPhysicalMaterial({ color: '#fff', emissive: new THREE.Color('#fff3e2'), emissiveIntensity: 3 * lamps });
      for (let i = 0; i < nx; i++)
        for (let j = 0; j < ny; j++) {
          const x = (minX + ((i + 0.5) / nx) * (maxX - minX)) * M;
          const z = (minY + ((j + 0.5) / ny) * (maxY - minY)) * M;
          const light = new THREE.RectAreaLight('#fff1dc', 6 * lamps, 0.5, 0.5);
          light.position.set(x, ceilingH - 0.02, z);
          light.lookAt(x, 0, z);
          g.add(light);
          const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), panelMat);
          panel.rotation.x = Math.PI / 2;
          panel.position.set(x, ceilingH - 0.005, z);
          g.add(panel);
        }
    }
    if (withCeiling || this.mode !== 'floor') this.hemi.intensity = p.settings.ceiling && withCeiling ? 0.35 : 0;
  }

  private updateSun(p: Project) {
    const poly = this.mode === 'floor' ? floorPolygon(p) : this.visibleFloors().flatMap((f) => f.walls.flatMap((w) => [w.a, w.b]));
    const c = new THREE.Vector3();
    let r = 4;
    if (poly.length) {
      const xs = poly.map((v) => v.x * M);
      const zs = poly.map((v) => v.y * M);
      c.set((Math.min(...xs) + Math.max(...xs)) / 2, 0, (Math.min(...zs) + Math.max(...zs)) / 2);
      r = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) * 0.75 + 1;
    }
    let dir: THREE.Vector3;
    let elev: number;
    let dim = 1;
    const o = this.outdoor;
    if (o) {
      // echter Sonnenstand: Azimut ab Norden, Norden zeigt im Grundriss um „north“ Grad gedreht von oben
      const th = ((o.azimuth + o.north) * Math.PI) / 180;
      const alt = (o.altitude * Math.PI) / 180;
      elev = Math.max(0.05, alt);
      dir = new THREE.Vector3(Math.sin(th) * Math.cos(elev), Math.sin(elev), -Math.cos(th) * Math.cos(elev)).normalize();
      dim = (alt <= 0 ? 0 : Math.min(1, alt / 0.1)) * (1 - 0.8 * Math.min(1, o.cloud / 100)) * (o.rain ? 0.4 : 1);
      // Dämmerung und Nacht: schwaches, bläuliches Licht, damit das Haus erkennbar bleibt
      this.moon.intensity = o.altitude >= 6 ? 0 : o.altitude >= -6 ? (0.6 * (6 - o.altitude)) / 12 : 0.6;
    } else {
      this.moon.intensity = 0;
      const time = p.settings.timeOfDay;
      const az = ((time - 12) / 12) * Math.PI;
      elev = Math.max(0.12, Math.sin((Math.PI * (time - 5)) / 15) * 1.05);
      dir = new THREE.Vector3(Math.sin(az) * Math.cos(elev), Math.sin(elev), -Math.cos(az) * Math.cos(elev) * 0.6 + 0.4).normalize();
    }
    this.sun.position.copy(c).addScaledVector(dir, 20);
    this.sun.target.position.copy(c);
    const warm = 1 - Math.min(1, elev / 0.6);
    this.sun.color.setRGB(1, 0.93 - warm * 0.2, 0.84 - warm * 0.35);
    this.sun.intensity = (1.2 + Math.min(1, elev / 0.6) * 2.4) * (p.settings.sunIntensity ?? 1) * dim;
    this.sun.visible = (p.settings.sunIntensity ?? 1) * dim > 0.001;
    // Himmel / Umgebungslicht
    this.scene.environmentIntensity = (p.settings.skyIntensity ?? 1) * (o ? this.updateSky(o) : this.updateSky(null));
    // weiche Schatten: größerer Filterradius, mehr Samples
    const soft = p.settings.softness ?? 0.6;
    this.sun.shadow.radius = 1 + soft * 14;
    this.sun.shadow.blurSamples = 8 + Math.round(soft * 24);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -r;
    cam.right = cam.top = r;
    cam.near = 1;
    cam.far = 45;
    cam.updateProjectionMatrix();
  }

  /** Himmelsfarben nach Sonnenhöhe und Bewölkung; liefert den Faktor fürs Umgebungslicht */
  private skyState = '';
  private updateSky(o: Scene3D['outdoor']): number {
    const mix = (a: string, b: string, t: number) => new THREE.Color(a).lerp(new THREE.Color(b), Math.max(0, Math.min(1, t)));
    let top: THREE.Color;
    let bottom: THREE.Color;
    let light = 1;
    if (!o) {
      top = new THREE.Color('#bcd3ee');
      bottom = new THREE.Color('#e9e4da');
    } else {
      const alt = o.altitude;
      const cloud = Math.min(1, o.cloud / 100);
      // Tag: blau → grau bei Bewölkung; Dämmerung: orange am Horizont; Nacht: dunkelblau
      const dayTop = mix('#5e9be0', '#9aa4b0', cloud);
      const dayBottom = mix('#d6e6f6', '#d0d3d8', cloud);
      const duskTop = mix('#34467a', '#4a4f5c', cloud);
      const duskBottom = mix('#f0a468', '#8a8580', cloud);
      const nightTop = new THREE.Color('#0a1022');
      const nightBottom = new THREE.Color('#1b2336');
      if (alt >= 8) {
        top = dayTop;
        bottom = dayBottom;
      } else if (alt >= -2) {
        const t = (alt + 2) / 10;
        top = duskTop.clone().lerp(dayTop, t);
        bottom = duskBottom.clone().lerp(dayBottom, t);
      } else {
        const t = Math.min(1, (-2 - alt) / 8);
        top = duskTop.clone().lerp(nightTop, t);
        bottom = duskBottom.clone().lerp(nightBottom, t);
      }
      light = alt >= 8 ? 1 - cloud * 0.25 : alt >= -2 ? 0.45 + 0.055 * (alt + 2) : 0.32;
      if (o.rain) light *= 0.75;
    }
    const key = top.getHexString() + bottom.getHexString();
    if (key !== this.skyState) {
      this.skyState = key;
      this.sky.topColor.copy(top);
      this.sky.bottomColor.copy(bottom);
      this.sky.update();
      if (this.pathTracer && this.ptActive) this.ptSceneDirty = true;
    }
    return light;
  }

  /** Draußen live setzen (Sonne, Himmel) ohne alles neu aufzubauen */
  setOutdoor(o: Scene3D['outdoor']) {
    this.outdoor = o;
    this.updateSun(store.project);
    this.dirty = true;
    if (this.pathTracer && this.ptActive) this.pathTracer.reset();
  }

  /** Rasen: feine Grünfläche aus einer kleinen, gekachelten Textur (funktioniert auch im Pathtracer) */
  private lawnMaterial() {
    if (this.groundLawn) return this.groundLawn;
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = '#4c7a2f';
    g.fillRect(0, 0, 256, 256);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 9000; i++) {
      const v = rnd();
      g.fillStyle = v < 0.45 ? '#5d8f39' : v < 0.8 ? '#426b27' : v < 0.95 ? '#6fa043' : '#7a8f3a';
      g.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 2, 2 + rnd() * 4);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(48, 48);
    tex.anisotropy = 8;
    this.groundLawn = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 1, color: '#ffffff' });
    return this.groundLawn;
  }

  updateSelection() {
    this.updateBox();
    this.applyFocus();
    // Wandterminal: das Möbel hebt sich durch die Transparenz ab – kein Auswahlrahmen
    if (this.hideSelectionBox && store.selection?.kind === 'item') this.selectionBox.visible = false;
  }
  /** Auswahlrahmen für Möbel weglassen (Wandterminal) */
  hideSelectionBox = false;

  /** Ansehen: das ausgewählte Möbel hervorheben, alles andere halbtransparent */
  focusMode = false;
  private faded = new Map<THREE.Material, THREE.Material>();
  private fade(mat: THREE.Material) {
    let f = this.faded.get(mat);
    if (!f) {
      f = mat.clone();
      f.transparent = true;
      f.opacity = 0.16 * mat.opacity;
      f.depthWrite = false;
      this.faded.set(mat, f);
    }
    return f;
  }
  private applyFocus() {
    const s = store.selection;
    const id = this.focusMode && !this.ptActive && !this.showroomMode && s?.kind === 'item' ? s.id : null;
    let target: THREE.Object3D | undefined;
    if (id) this.content.traverse((o) => {
      if (!target && o.userData.itemId === id) target = o;
    });
    const inside = (o: THREE.Object3D | null) => {
      for (; o; o = o.parent) if (o === target) return true;
      return false;
    };
    this.content.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (m.userData.origMat) {
        m.material = m.userData.origMat;
        delete m.userData.origMat;
      }
      if (target && !inside(m)) {
        m.userData.origMat = m.material;
        m.material = Array.isArray(m.material) ? m.material.map((x) => this.fade(x)) : this.fade(m.material);
      }
    });
    this.dirty = true;
  }

  private updateBox() {
    const s = store.selection;
    this.selectionBox.visible = false;
    if (!s || this.ptActive || this.showroomMode) return;
    const key = s.kind === 'item' ? 'itemId' : s.kind === 'wall' ? 'wallId' : null;
    if (!key) return;
    const fg = this.content.children.find((c) => c.userData.floorId === store.floorId);
    let obj: THREE.Object3D | undefined;
    fg?.traverse((o) => {
      if (!obj && o.userData[key] === s.id) obj = o;
    });
    if (!obj) return;
    this.selectionBox.box.setFromObject(obj);
    this.selectionBox.visible = true;
    this.dirty = true;
  }

  // -------------------------------------------------------------------------

  /** Kamera auf flacheren Blickwinkel absenken (Grad über der Horizontalen), Abstand bleibt – z. B. Ruhezustand */
  tiltCamera(deg: number) {
    const t = this.controls.target;
    const off = this.camera.position.clone().sub(t);
    const dist = off.length();
    const h = new THREE.Vector3(off.x, 0, off.z).normalize();
    const a = (deg * Math.PI) / 180;
    this.camera.position.copy(t).addScaledVector(h, dist * Math.cos(a)).add(new THREE.Vector3(0, dist * Math.sin(a), 0));
    this.cameraChanged();
  }

  setView(kind: 'perspective' | 'top' | 'front' | 'corner') {
    const poly = this.mode === 'floor' ? floorPolygon(store.project) : this.visibleFloors().flatMap((f) => f.walls.flatMap((w) => [w.a, w.b]));
    if (!poly.length) return;
    const xs = poly.map((v) => v.x * M);
    const zs = poly.map((v) => v.y * M);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const y0 = this.floorY(store.floor);
    // Haus-Ansicht: auf die Mitte des sichtbaren Hauses schauen, von etwas weiter weg
    const ys = this.visibleFloors().map((f) => this.floorY(f));
    const midY = this.mode === 'floor' ? 0.9 + y0 : (Math.min(...ys) + Math.max(...ys)) / 2 + 1.3;
    const c = new THREE.Vector3((minX + maxX) / 2, midY, (minZ + maxZ) / 2);
    const size = Math.max(maxX - minX, maxZ - minZ);
    if (this.walk.isLocked) this.walk.unlock();
    this.controls.target.copy(c);
    if (kind === 'top') this.camera.position.set(c.x, y0 + size * 1.6 + 2, c.z + 0.01);
    if (kind === 'front') this.camera.position.set(c.x, y0 + 1.6, maxZ - 0.3);
    if (kind === 'perspective' && this.mode !== 'floor') {
      // Abstand so wählen, dass das ganze sichtbare Haus ins Bild passt (auch im schmalen geteilten Modus)
      const stackH = Math.max(...ys) - Math.min(...ys) + 3;
      const r = 0.5 * Math.hypot(maxX - minX, maxZ - minZ, stackH);
      const vFov = THREE.MathUtils.degToRad(55);
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
      const dist = (r / Math.sin(Math.min(vFov, hFov) / 2)) * 1.05;
      const dir = new THREE.Vector3(0.45, 0.6, 0.66).normalize();
      this.camera.position.copy(c).addScaledVector(dir, dist);
    } else if (kind === 'perspective') this.camera.position.set(c.x + size * 0.25, y0 + 2.6 + size * 0.55, maxZ + size * 0.55);
    if (kind === 'corner') this.camera.position.set(maxX - 0.4, y0 + 1.7, maxZ - 0.4);
    this.camera.fov = kind === 'front' || kind === 'corner' ? 70 : 55;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.cameraChanged();
  }

  /** Kamera auf ein Möbel der aktiven Etage ausrichten (z. B. Suchtreffer) */
  focusItem(it: { x: number; y: number; elevation: number; height: number; rotation: number; width: number }) {
    if (this.walk.isLocked) this.walk.unlock();
    const y = this.floorY(store.floor) + (it.elevation + it.height / 2) * M;
    const t = new THREE.Vector3(it.x * M, y, it.y * M);
    // vor die Front stellen (Vorderseite lokal +y → Welt: Drehung im Uhrzeigersinn)
    const dir = new THREE.Vector3(-Math.sin(it.rotation), 0, Math.cos(it.rotation));
    this.controls.target.copy(t);
    // schräg von oben vor der Front: über die Wände hinweg, damit nichts die Sicht verdeckt
    const floorTop = this.floorY(store.floor) + Math.max(2.6, ...store.floor.walls.map((w) => w.height * M));
    this.camera.position.copy(t).addScaledVector(dir, Math.max(2.4, it.width * M * 0.8)).setY(floorTop + 1.6 + Math.max(0, it.width * M - 3) * 0.4);
    this.controls.update();
    this.cameraChanged();
  }

  /** Begehen wie im Spiel: ganzes Haus, Kollision mit Wänden und Möbeln, Treppen wechseln die Etage */
  startWalk() {
    this.controls.enabled = false;
    this.controls.autoRotate = false;
    this.walkPrevMode = this.mode;
    if (this.mode !== 'house') {
      this.mode = 'house';
      this.build();
      this.onModeChange?.(this.mode);
    }
    this.walker = new Walker(store.house);
    const t = this.controls.target;
    this.walker.place(store.floor, { x: t.x, y: t.z });
    const p = this.walker.step(0, 0, 0);
    this.camera.position.set(p.x, p.y, p.z);
    // waagerecht in Blickrichtung der bisherigen Kamera schauen
    const dir = new THREE.Vector3(t.x - this.camera.position.x, 0, t.z - this.camera.position.z);
    if (dir.lengthSq() > 1e-4) this.camera.lookAt(this.camera.position.clone().add(dir));
    this.walkWhere = '';
    this.reportWhere();
    this.walk.lock();
  }

  /** Etage/Raum melden und den Grundriss mitführen */
  private reportWhere() {
    if (!this.walker) return;
    const w = this.walker.where();
    if (w.floor.id !== store.floorId) store.setFloor(w.floor.id);
    const key = w.floor.id + '|' + w.room;
    if (key === this.walkWhere) return;
    this.walkWhere = key;
    this.onWalkWhere?.(w.floor, w.room);
  }

  setExposure(v: number) {
    this.renderer.toneMappingExposure = v;
    this.dirty = true;
    if (this.pathTracer && this.ptActive) this.pathTracer.reset();
  }

  async setPathTracing(on: boolean) {
    this.ptActive = on;
    this.updateSelection();
    if (!on) {
      this.dirty = true;
      return;
    }
    if (!this.pathTracer) {
      const pt = new WebGLPathTracer(this.renderer);
      pt.tiles.set(2, 2);
      pt.bounces = 7;
      pt.transmissiveBounces = 6;
      pt.filterGlossyFactor = 0.4;
      pt.minSamples = 1;
      pt.renderDelay = 0;
      pt.fadeDuration = 300;
      pt.dynamicLowRes = true;
      pt.lowResScale = 0.2;
      pt.textureSize.set(2048, 2048);
      this.pathTracer = pt;
    }
    this.pathTracer.renderScale = this.ptScale;
    this.ptSceneDirty = true;
  }
  /** Rechenauflösung des Pathtracers (1 = volle Auflösung; kleiner = schneller, Bild wird hochskaliert) */
  ptScale = 1;

  /** Name der vom Browser genutzten Grafikkarte (sofern der Browser ihn verrät) */
  gpuInfo(): { name: string; integrated: boolean } {
    const gl = this.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    const dedicated = /nvidia|geforce|rtx|quadro|radeon rx|radeon pro|amd radeon(?!\(tm\) graphics)|arc a\d/i.test(name);
    const integrated = !dedicated && /intel|uhd|iris|vega|radeon\(tm\) graphics|swiftshader|llvmpipe|microsoft basic/i.test(name);
    return { name, integrated };
  }

  get pathTracing() {
    return this.ptActive;
  }

  screenshot(): string {
    if (!this.ptActive) {
      this.selectionBox.visible = false;
      this.composer.render();
    }
    const url = this.renderer.domElement.toDataURL('image/png');
    this.updateSelection();
    return url;
  }

  private frame() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    if (this.walk.isLocked) {
      const k = (...c: string[]) => (c.some((x) => this.keys.has(x)) ? 1 : 0);
      const fwd = k('KeyW', 'ArrowUp') - k('KeyS', 'ArrowDown');
      const side = k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft');
      const speed = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 3 : 1.4) * dt;
      const look = new THREE.Vector3();
      this.camera.getWorldDirection(look);
      look.y = 0;
      look.normalize();
      const len = Math.hypot(fwd, side) || 1;
      // rechts = Blickrichtung × oben
      const dx = ((fwd * look.x - side * look.z) / len) * speed;
      const dz = ((fwd * look.z + side * look.x) / len) * speed;
      if (this.walker) {
        const before = this.camera.position.clone();
        const p = this.walker.step(dx, dz, dt);
        this.camera.position.set(p.x, p.y, p.z);
        if (before.distanceToSquared(this.camera.position) > 1e-10) {
          this.reportWhere();
          this.cameraChanged();
        }
      }
    } else if (this.controls.update(dt)) {
      this.dirty = true;
      if (this.controls.autoRotate) this.cameraChanged();
    }

    if (this.ptActive && this.pathTracer) {
      if (this.ptSceneDirty) {
        this.ptSceneDirty = false;
        this.selectionBox.visible = false;
        try {
          this.pathTracer.setScene(this.scene, this.camera);
        } catch (err) {
          console.error('Pathtracer-Szenenaufbau fehlgeschlagen', err);
        }
      }
      this.pathTracer.renderSample();
      this.onSamples?.(Math.floor(this.pathTracer.samples));
      return;
    }

    if (this.dirty) {
      this.dirty = false;
      this.composer.render();
    }
  }
}
