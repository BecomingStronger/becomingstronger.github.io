// Drawing helpers shared by the views: seeded noise, canvas textures, glow sprites, soft points,
// the starfield, orbit lines whose trail fades behind the body, and texture loading.
import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";

export const TAU = Math.PI * 2;
export const rng = (seed) => { let s = (seed >>> 0) % 2147483647 || 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
export const gauss = (r) => { let u = 0; while (!u) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * r()); };
export const hashStr = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
export const rgb = (hex) => { const c = new THREE.Color(hex || "#ffffff"); return [c.r, c.g, c.b]; };

export function srgb(t) { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.needsUpdate = true; return t; }

export function canvasTex(w, h, paint) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  paint(c.getContext("2d"), w, h);
  return srgb(new THREE.CanvasTexture(c));
}

export function radialTex(stops, size = 256) {
  return canvasTex(size, size, (g) => {
    const h = size / 2, gr = g.createRadialGradient(h, h, 0, h, h, h);
    for (const [o, c] of stops) gr.addColorStop(o, c);
    g.fillStyle = gr;
    g.fillRect(0, 0, size, size);
  });
}

export function sprite(tex, scale, opacity = 1, color) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, transparent: true, opacity }));
  if (color) s.material.color = new THREE.Color(color);
  s.scale.setScalar(scale);
  return s;
}

const imgCache = new Map();
export function loadImage(url) {
  if (!imgCache.has(url)) {
    imgCache.set(url, new Promise((res) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = () => res(null); i.src = url; }));
  }
  return imgCache.get(url);
}

// Grayscale an image, then tint it. keep = how much of the original saturation to keep.
export function recolor(im, tint, keep = 0) {
  const w = Math.min(im.width, 2048), h = Math.round(im.height * w / im.width);
  return canvasTex(w, h, (g) => {
    g.drawImage(im, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h), a = d.data;
    for (let i = 0; i < a.length; i += 4) {
      const l = a[i] * 0.299 + a[i + 1] * 0.587 + a[i + 2] * 0.114;
      for (let k = 0; k < 3; k++) a[i + k] = Math.min(255, (l + (a[i + k] - l) * keep) * tint[k]);
    }
    g.putImageData(d, 0, 0);
  });
}

// Painted surfaces for worlds with no texture file.
const PROCS = {
  karpri: (g, w, h, r) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, "#eef4ff"); gr.addColorStop(0.09, "#d7e6ff"); gr.addColorStop(0.13, "#1d5fb0");
    gr.addColorStop(0.5, "#0d3d8a"); gr.addColorStop(0.87, "#1d5fb0"); gr.addColorStop(0.91, "#d7e6ff"); gr.addColorStop(1, "#eef4ff");
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) { g.fillStyle = r() < 0.5 ? `rgba(120,180,255,${0.04 + r() * 0.07})` : `rgba(8,30,80,${0.05 + r() * 0.08})`; g.beginPath(); g.ellipse(r() * w, h * (0.14 + r() * 0.72), 10 + r() * 70, 2 + r() * 6, 0, 0, TAU); g.fill(); }
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(80,150,95,${0.08 + r() * 0.1})`; g.beginPath(); g.ellipse(r() * w, h * (0.47 + (r() - 0.5) * 0.12), 8 + r() * 34, 1.5 + r() * 3, 0, 0, TAU); g.fill(); }
  },
  chandos: (g, w, h, r) => {
    g.fillStyle = "#145068"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1700; i++) { g.fillStyle = r() < 0.55 ? `rgba(118,104,66,${0.07 + r() * 0.12})` : `rgba(36,124,112,${0.06 + r() * 0.1})`; g.beginPath(); g.ellipse(r() * w, r() * h, 4 + r() * 42, 3 + r() * 20, r() * 3, 0, TAU); g.fill(); }
    g.fillStyle = "rgba(230,240,255,.85)"; g.fillRect(0, 0, w, h * 0.05); g.fillRect(0, h * 0.95, w, h * 0.05);
  },
  // A generic world from its color: bands and blotches, so new bodies never look flat.
  generic: (g, w, h, r, color) => {
    const c = new THREE.Color(color || "#8899aa"), hsl = {};
    c.getHSL(hsl);
    const col = (dl, ds = 0) => `hsl(${hsl.h * 360}, ${Math.max(0, Math.min(100, (hsl.s + ds) * 100))}%, ${Math.max(0, Math.min(100, (hsl.l + dl) * 100))}%)`;
    g.fillStyle = col(-0.08); g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) { g.globalAlpha = 0.05 + r() * 0.12; g.fillStyle = col((r() - 0.5) * 0.3, (r() - 0.5) * 0.2); g.beginPath(); g.ellipse(r() * w, r() * h, 6 + r() * 60, 2 + r() * 14, 0, 0, TAU); g.fill(); }
    g.globalAlpha = 1;
  },
};

const texCache = new Map();
// A body's surface texture: a file (optionally recolored), a painted one ("proc:name"), or a set of
// size tiers { "4096": url, ... } from which the largest the GPU and screen can use is taken.
export async function bodyTexture(look, renderer, opts = {}) {
  let t = look?.texture;
  if (!t) return look?.paint === false ? null : paint("generic", look?.color);
  if (typeof t === "object") {
    const max = renderer.capabilities.maxTextureSize, wide = innerWidth;
    const tiers = Object.keys(t).map(Number).filter((n) => n <= max).sort((a, b) => a - b);
    let pick = tiers[0];
    for (const n of tiers) if (n <= (opts.maxTier || 8192) && (n <= 4096 || (n <= 8192 && wide > 700) || (wide > 1200 && (navigator.deviceMemory ?? 8) >= 8))) pick = n;
    t = t[String(pick)];
  }
  if (t.startsWith("proc:")) return paint(t.slice(5), look?.color);
  const key = `${t}|${look.tint || ""}|${look.keep ?? ""}`;
  if (texCache.has(key)) return texCache.get(key);
  const im = await loadImage(t);
  if (!im) return paint("generic", look?.color);
  const tex = look.tint ? recolor(im, look.tint, look.keep || 0) : srgb(new THREE.Texture(im));
  texCache.set(key, tex);
  return tex;
}

function paint(name, color) {
  const key = `proc:${name}|${color}`;
  if (!texCache.has(key)) texCache.set(key, canvasTex(1024, 512, (g, w, h) => (PROCS[name] || PROCS.generic)(g, w, h, rng(hashStr(key)), color)));
  return texCache.get(key);
}

// Soft round points with per-point color and pixel size.
export function points(list) {
  const n = list.length, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n);
  list.forEach((q, i) => { pos.set(q.p, i * 3); col.set(q.c, i * 3); size[i] = q.s; });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("acol", new THREE.BufferAttribute(col, 3));
  g.setAttribute("asize", new THREE.BufferAttribute(size, 1));
  return new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms: { dpr: { value: Math.min(devicePixelRatio, 2) }, fade: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    vertexShader: `attribute vec3 acol; attribute float asize; uniform float dpr; varying vec3 vC;
      void main(){ vC = acol; gl_PointSize = asize * dpr; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float fade; varying vec3 vC;
      void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float a = clamp(1.0 - r, 0.0, 1.0); a *= a; gl_FragColor = vec4(vC * a * fade, 1.0); }`,
  }));
}

export function starfield(n, R, seed) {
  const r = rng(seed), list = [];
  const band = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.55, 0.3, 0.95));
  const pal = [[1, 1, 1], [0.82, 0.88, 1], [1, 0.93, 0.84], [0.72, 0.82, 1]];
  for (let i = 0; i < n; i++) {
    let v;
    if (r() < 0.32) {
      const lon = r() * TAU, lat = gauss(r) * 0.16;
      v = new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)).applyMatrix4(band);
    } else {
      const z = r() * 2 - 1, t = r() * TAU, s = Math.sqrt(1 - z * z);
      v = new THREE.Vector3(s * Math.cos(t), z, s * Math.sin(t));
    }
    const b = Math.pow(r(), 3.4), c = pal[Math.floor(r() * pal.length)], k = 0.16 + 0.84 * b;
    list.push({ p: v.multiplyScalar(R).toArray(), c: c.map((x) => x * k), s: 1.0 + 2.8 * b });
  }
  const group = new THREE.Group();
  group.add(points(list));
  const neb = radialTex([[0, "rgba(255,255,255,1)"], [0.35, "rgba(255,255,255,.35)"], [1, "rgba(255,255,255,0)"]]);
  for (let i = 0; i < 18; i++) {
    const lon = r() * TAU, lat = gauss(r) * 0.08;
    const v = new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)).applyMatrix4(band).multiplyScalar(R * 0.98);
    const s = sprite(neb, R * (0.18 + r() * 0.22), 0.05 + r() * 0.05, new THREE.Color().setHSL(0.6 + r() * 0.12, 0.6, 0.6));
    s.position.copy(v);
    group.add(s);
  }
  return group;
}

export function fatLine(pts, cols, width, opts = {}) {
  const g = new LineGeometry();
  g.setPositions(pts.flat());
  g.setColors(cols.flat());
  const m = new LineMaterial({ linewidth: width, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, worldUnits: false });
  if (opts.dashed) { m.dashed = true; m.dashSize = opts.dash; m.gapSize = opts.gap; }
  m.resolution.set(innerWidth, innerHeight);
  const l = new Line2(g, m);
  if (opts.dashed) l.computeLineDistances();
  return l;
}

// An orbit drawn as a closed line whose brightness falls off behind the body, after NASA Eyes.
// setHead(f) moves the bright end to the body's current fraction of its period.
export class OrbitLine {
  constructor(samples, color, width = 1.5, opts = {}) {
    this.f = samples.map((s) => s.f);
    this.base = rgb(color);
    this.floor = opts.floor ?? 0.17;
    this.boost = 1;
    const pts = samples.map((s) => s.p.toArray());
    this.line = fatLine(pts, pts.map(() => this.base), width, opts);
    this.head = -1;
  }
  setHead(head, force = false) {
    if (!force && Math.abs(head - this.head) < 0.002) return;
    this.head = head;
    const arr = this.line.geometry.attributes.instanceColorStart.data;
    const a = arr.array, n = this.f.length - 1, [r, g, b] = this.base, fl = this.floor, k = this.boost;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < 2; j++) {
        const behind = ((head - this.f[i + j]) % 1 + 1) % 1;
        const v = Math.min(1, (fl + (1 - fl) * Math.exp(-behind * TAU / 1.5)) * k);
        a.set([r * v, g * v, b * v], i * 6 + j * 3);
      }
    }
    arr.needsUpdate = true;
  }
  setResolution(w, h) { this.line.material.resolution.set(w, h); }
}
