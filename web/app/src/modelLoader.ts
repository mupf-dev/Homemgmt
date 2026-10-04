// 3D-Modelle (glTF/GLB) aus der Bibliothek laden, zwischenspeichern und passend zu den Maßen eines Elements einsetzen.
// Solange ein Modell lädt, steht ein durchscheinender Platzhalter da; danach wird die Szene neu aufgebaut.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const cache = new Map<string, { template?: THREE.Object3D; size?: THREE.Vector3; error?: string; promise: Promise<void> }>();

function load(url: string) {
  let e = cache.get(url);
  if (!e) {
    const entry: { template?: THREE.Object3D; size?: THREE.Vector3; error?: string; promise: Promise<void> } = { promise: Promise.resolve() };
    entry.promise = loader.loadAsync(url).then(
      (gltf) => {
        const root = gltf.scene;
        root.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = true;
            m.receiveShadow = true;
          }
        });
        const box = new THREE.Box3().setFromObject(root);
        entry.size = box.getSize(new THREE.Vector3());
        // Ursprung: Mitte unten
        const c = box.getCenter(new THREE.Vector3());
        root.position.sub(new THREE.Vector3(c.x, box.min.y, c.z));
        const wrap = new THREE.Group();
        wrap.add(root);
        entry.template = wrap;
        document.dispatchEvent(new CustomEvent('kp-texture-loaded'));
      },
      (err) => {
        entry.error = String(err?.message ?? err);
        console.warn('Modell konnte nicht geladen werden', url, err);
      },
    );
    cache.set(url, entry);
    e = entry;
  }
  return e;
}

/** Maße eines Modells in cm (Breite x, Tiefe z, Höhe y) – lädt es bei Bedarf */
export async function modelSize(url: string): Promise<{ w: number; d: number; h: number }> {
  const e = load(url);
  await e.promise;
  if (!e.size) throw new Error(e.error ?? 'Modell konnte nicht geladen werden');
  return { w: Math.round(e.size.x * 1000) / 10, d: Math.round(e.size.z * 1000) / 10, h: Math.round(e.size.y * 1000) / 10 };
}

const placeholder = new THREE.MeshBasicMaterial({ color: '#9aa7b5', transparent: true, opacity: 0.35, depthWrite: false });

/** Modell auf Breite/Tiefe/Höhe (m) skaliert, Ursprung Mitte unten; Platzhalter, solange es lädt */
export function modelInstance(url: string, W: number, D: number, H: number): THREE.Object3D {
  const e = load(url);
  if (!e.template || !e.size) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), placeholder);
    m.position.y = H / 2;
    return m;
  }
  const obj = e.template.clone(true);
  obj.scale.set(W / Math.max(1e-6, e.size.x), H / Math.max(1e-6, e.size.y), D / Math.max(1e-6, e.size.z));
  return obj;
}
