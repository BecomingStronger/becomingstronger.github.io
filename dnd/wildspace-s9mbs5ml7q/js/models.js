// glTF models (see tools/assets/build_models.py): loaded once, then cloned or instanced.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const draco = new DRACOLoader().setDecoderPath("https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/libs/draco/gltf/");
const loader = new GLTFLoader().setDRACOLoader(draco);
const cache = new Map();

export const ROCKS = ["a", "b", "c", "d"].map((k) => `assets/models/rock_${k}.glb`);
export const ROCKS_LO = ["a", "b", "c", "d"].map((k) => `assets/models/rock_${k}_lo.glb`);

export function loadModel(url) {
  if (!cache.has(url)) cache.set(url, loader.loadAsync(url).then((g) => g.scene).catch((e) => { console.warn("model", url, e); return null; }));
  return cache.get(url);
}

export async function modelClone(url) {
  const s = await loadModel(url);
  return s ? s.clone(true) : null;
}

// The first mesh of a model, for an InstancedMesh.
export async function meshParts(url) {
  const s = await loadModel(url);
  let m = null;
  s?.traverse((o) => { if (!m && o.isMesh) m = o; });
  return m ? { geometry: m.geometry, material: m.material } : null;
}

// One small studio environment for the few shiny bodies (Lumbe's metal), not for the planets:
// a lit room around a planet would light its night side.
let env = null;
export function studioEnv(renderer) {
  if (!env) {
    const pm = new THREE.PMREMGenerator(renderer);
    env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
  }
  return env;
}
