// Toril globe. A port of the MapToGlobe scene (BaesTheorem/MapToGlobe, src/assets/MapToGlobe/Scene.ts
// and Planet.ts) with the campaign project's saved settings baked in, so this page looks like the app.
// Pinned to three r122, the version MapToGlobe uses, because later releases changed light units.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.122.0/build/three.module.js";
import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@0.122.0/examples/jsm/controls/OrbitControls.js";

// Values from the MapToGlobe project state (localStorage "maptoglobe_state", 2026-10-08).
const SETTINGS = {
  shininess: 0.4,
  sunIntensity: 0.38,     // slider value; the app sets the light to half of it
  ambientIntensity: 0.5,
  starDensity: 4,
  starBrightness: 2.95,
};

// Pixel position of Calimport on toril-2023-1.png (9864 x 5626). The source map has no city dots, so
// this comes from the WotC 3E Faerun map, which puts the city on the south coast below the eastern end
// of the Calim Desert. The desert and the Marching Mountains line the two maps up.
const PINS = [{ id: "calimport", label: "Calimport", u: 3052 / 9864, v: 2080 / 5626 }];

const STAR_LAYERS = [
  { count: 14000, size: 1.3, radius: 800, colors: ["#ffffff", "#fff8e7", "#ffe4b5"] },
  { count: 5000, size: 1.9, radius: 810, colors: ["#ffffff", "#fff8e7", "#ffcc99", "#ff9966"] },
  { count: 1200, size: 2.7, radius: 820, colors: ["#ffffff", "#ffeeaa", "#aaccff", "#ff6633"] },
  { count: 220, size: 4.0, radius: 830, colors: ["#ffffff", "#aaccff", "#ffdddd"] },
];

const RADIUS = 2;

// Same mapping as THREE.SphereBufferGeometry, so a texture pixel and its 3D point agree.
function uvToVec(u, v, r = RADIUS) {
  const phi = u * Math.PI * 2, theta = v * Math.PI;
  return new THREE.Vector3(-r * Math.cos(phi) * Math.sin(theta), r * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta));
}

function starSprite() {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.55, "rgba(255,255,255,1)");
  grad.addColorStop(0.8, "rgba(255,255,255,0.35)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

function starfield(density, brightness) {
  const group = new THREE.Group();
  const sprite = starSprite();
  const color = new THREE.Color();
  for (const layer of STAR_LAYERS) {
    const n = Math.round(layer.count * density);
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const t = Math.random() * Math.PI * 2, p = Math.acos(2 * Math.random() - 1);
      pos.set([layer.radius * Math.sin(p) * Math.cos(t), layer.radius * Math.cos(p), layer.radius * Math.sin(p) * Math.sin(t)], i * 3);
      color.set(layer.colors[Math.floor(Math.random() * layer.colors.length)]);
      const m = 0.7 + Math.random() * 0.3;
      col.set([color.r * m, color.g * m, color.b * m], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({ size: layer.size, map: sprite, vertexColors: true, sizeAttenuation: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    mat.color.setScalar(brightness);
    group.add(new THREE.Points(geo, mat));
  }
  return group;
}

export function mountGlobe(host, { onProgress, onReady, onError } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  } catch (e) {
    onError?.(e);
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000208);
  scene.add(starfield(SETTINGS.starDensity, SETTINGS.starBrightness));

  const camera = new THREE.PerspectiveCamera(25, 1, 0.1, 2000);
  camera.position.z = 12;
  scene.add(camera);

  // Two-light rig carried by the camera, as in the app: the sun plus a shadowless fill.
  const sun = new THREE.DirectionalLight(0xffffff, SETTINGS.sunIntensity / 2);
  sun.position.set(0, 0, 100);
  const fill = sun.clone();
  fill.intensity = 1 - 0.4;
  const rig = new THREE.Object3D();
  rig.add(sun, fill);
  camera.add(rig);
  scene.add(new THREE.AmbientLight(0x404040, SETTINGS.ambientIntensity));

  const material = new THREE.MeshPhongMaterial({ shininess: SETTINGS.shininess });
  const planet = new THREE.Mesh(new THREE.SphereBufferGeometry(RADIUS, 100, 100), material);
  scene.add(planet);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.minDistance = 2.6;
  controls.maxDistance = 30;
  controls.rotateSpeed = 0.5;
  controls.zoomSpeed = 0.8;

  // Pins are HTML labels placed over the canvas each frame, hidden on the far side of the globe.
  const pins = PINS.map((p) => {
    const el = document.createElement("button");
    el.className = "pin";
    el.type = "button";
    el.innerHTML = `<span class="pin-dot"></span><span class="pin-label">${p.label}</span>`;
    el.addEventListener("click", () => flyTo(p.id, 3.4));
    host.appendChild(el);
    return { ...p, el, pos: uvToVec(p.u, p.v) };
  });

  const big = renderer.capabilities.maxTextureSize >= 8192 && window.innerWidth > 700;
  const src = new URL(big ? "toril-8192.jpg" : "toril-4096.jpg", import.meta.url).href;
  const loader = new THREE.TextureLoader();
  // TextureLoader in r122 ignores progress, so fetch the bytes ourselves for a real progress bar.
  fetch(src).then(async (res) => {
    const total = +res.headers.get("content-length") || 0;
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      if (total) onProgress?.(got / total);
    }
    const url = URL.createObjectURL(new Blob(chunks, { type: "image/jpeg" }));
    loader.load(url, (tex) => {
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      material.map = tex;
      material.needsUpdate = true;
      onReady?.();
    }, undefined, onError);
  }).catch(onError);

  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(host);
  resize();

  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let flight = null;

  function flyTo(id, distance = 6.5) {
    const p = pins.find((x) => x.id === id);
    if (!p) return;
    const end = p.pos.clone().normalize().multiplyScalar(distance);
    if (reduceMotion.matches) {
      camera.position.copy(end);
      return;
    }
    flight = { from: camera.position.clone(), to: end, t0: performance.now(), ms: 1400 };
  }

  const v = new THREE.Vector3(), toCam = new THREE.Vector3();
  function placePins() {
    const w = host.clientWidth, h = host.clientHeight;
    for (const p of pins) {
      v.copy(p.pos).project(camera);
      toCam.copy(camera.position).sub(p.pos);
      const facing = toCam.dot(p.pos) > 0;
      p.el.style.transform = `translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * h}px)`;
      p.el.hidden = !facing;
    }
  }

  renderer.setAnimationLoop((now) => {
    if (flight) {
      const k = Math.min((now - flight.t0) / flight.ms, 1);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      // Slerp the direction and lerp the length, so the camera arcs around the globe, not through it.
      const dir = flight.from.clone().normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(dir, flight.to.clone().normalize());
      const qk = new THREE.Quaternion().slerp(q, e);
      camera.position.copy(dir.applyQuaternion(qk).multiplyScalar(THREE.MathUtils.lerp(flight.from.length(), flight.to.length(), e)));
      if (k === 1) flight = null;
    }
    controls.update();
    renderer.render(scene, camera);
    placePins();
  });

  // Open looking at the Faerun-Calimshan side of the world.
  camera.position.copy(pins[0].pos.clone().normalize().multiplyScalar(12));

  return {
    flyTo,
    reset() {
      flight = { from: camera.position.clone(), to: pins[0].pos.clone().normalize().multiplyScalar(12), t0: performance.now(), ms: reduceMotion.matches ? 1 : 1000 };
    },
    snapshot: () => renderer.domElement.toDataURL("image/jpeg", 0.9),
  };
}
