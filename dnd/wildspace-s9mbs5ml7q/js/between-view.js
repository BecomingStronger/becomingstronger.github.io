// The space between the spheres: the phlogiston (2e) or the Astral Sea (5e). Spheres are beads,
// currents are tubes with light that moves toward the destination, and free bodies float at
// their own map positions.
import * as THREE from "three";
import { sprite, radialTex, hashStr } from "./gfx.js";
import { buildBody } from "./bodies.js";
import { beadMaterial } from "./sphere-view.js";

const PHLO = `
uniform float aspect; uniform float t; uniform int astral; varying vec2 vUv;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 6; i++){ v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return v; }
void main(){
  vec2 p = (vUv - 0.5) * vec2(aspect, 1.0) * 2.4 + vec2(t * 0.012, 0.0);
  vec2 q = vec2(fbm(p), fbm(p + vec2(5.2, 1.3)));
  vec2 r = vec2(fbm(p * vec2(0.7, 1.8) + 3.2 * q + vec2(1.7, 9.2) + t * 0.01), fbm(p * vec2(0.7, 1.8) + 3.2 * q + vec2(8.3, 2.8)));
  float f = fbm(p * vec2(0.6, 1.9) + 3.0 * r);
  vec3 col;
  if (astral == 1) {
    // the Astral Sea: silver and slate, with a little violet
    col = mix(vec3(0.03, 0.035, 0.05), vec3(0.42, 0.45, 0.55), clamp(f * f * 2.0, 0.0, 1.0));
    col = mix(col, vec3(0.62, 0.58, 0.78), clamp(length(q) * 0.9 - 0.5, 0.0, 1.0) * 0.45);
    col += vec3(0.85, 0.88, 0.95) * pow(clamp(f - 0.62, 0.0, 1.0), 2.0) * 0.8;
    col *= 0.45 + 0.6 * f;
  } else {
    col = mix(vec3(0.015, 0.012, 0.045), vec3(0.30, 0.08, 0.48), clamp(f * f * 2.4, 0.0, 1.0));
    col = mix(col, vec3(0.86, 0.20, 0.55), clamp(length(q) * 0.95 - 0.42, 0.0, 1.0) * 0.6);
    col = mix(col, vec3(0.12, 0.62, 0.95), clamp(r.x * r.x * 1.6 - 0.22, 0.0, 1.0) * 0.9);
    col = mix(col, vec3(0.16, 0.80, 0.68), clamp(r.y - 0.58, 0.0, 1.0) * 1.3);
    col += vec3(1.0, 0.62, 0.78) * pow(clamp(f - 0.6, 0.0, 1.0), 2.0) * 0.7;
    col *= 0.42 + 0.7 * f;
  }
  float vg = smoothstep(1.35, 0.2, length((vUv - 0.5) * vec2(aspect * 0.85, 1.0)));
  col *= mix(0.3, 1.0, vg);
  gl_FragColor = vec4(col, 1.0);
}`;

const tubeVert = `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
  void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;

export class BetweenView {
  constructor(app) {
    this.app = app;
    this.kind = "between";
    this.scene = new THREE.Scene();
    this.bg = new THREE.Scene();
    this.bgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.items = [];
  }

  dispose() {
    for (const sc of [this.scene, this.bg]) sc.traverse((o) => { o.geometry?.dispose?.(); if (o.material) [].concat(o.material).forEach((m) => m.dispose?.()); });
    this.scene = new THREE.Scene();
    this.bg = new THREE.Scene();
    this.items = [];
    this.flowMats = [];
  }

  async build() {
    const { atlas, edition, edit } = this.app.state;
    this.dispose();
    const astral = edition === "5e";
    this.bgMat = new THREE.ShaderMaterial({
      uniforms: { aspect: { value: innerWidth / innerHeight }, t: { value: 0 }, astral: { value: astral ? 1 : 0 } },
      depthWrite: false, depthTest: false, toneMapped: false,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: PHLO,
    });
    this.bg.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.bgMat));
    this.scene.add(new THREE.AmbientLight(0xc8d0ff, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(-3, 4, 6);
    this.scene.add(key);

    const halo = radialTex([[0, "rgba(0,0,0,0)"], [0.5, "rgba(0,0,0,0)"], [0.56, "rgba(205,218,255,.30)"], [0.66, "rgba(170,190,255,.08)"], [1, "rgba(0,0,0,0)"]], 512);
    const spheres = atlas.spheres(edition, edit);
    this.spheres = new Map();
    for (const s of spheres) {
      const r = s.map?.size || 1;
      const pos = new THREE.Vector3(...(s.map?.pos || [0, 0, 0]));
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 128, 96), astral ? hazeMaterial() : beadMaterial());
      mesh.position.copy(pos);
      this.scene.add(mesh);
      const h = sprite(halo, r * 2 / 0.56);
      h.position.copy(pos);
      this.scene.add(h);
      if (astral && s.charted) {
        const star = sprite(radialTex([[0, "rgba(255,250,235,1)"], [0.2, "rgba(255,230,190,.5)"], [1, "rgba(0,0,0,0)"]]), r * 0.9);
        star.position.copy(pos);
        this.scene.add(star);
      }
      this.spheres.set(s.id, { s, pos, r, mesh });
      this.items.push({ type: "sphere", id: s.id, world: pos, r, s });
    }

    // currents (only those valid in this edition)
    this.flowMats = [];
    this.flows = [];
    for (const f of atlas.flows(edition, edit)) {
      const A = this.spheres.get(f.from), B = this.spheres.get(f.to);
      if (!A || !B) continue;
      const curves = f.direction === "two-way" ? [this.curve(A, B, 0.09, f), this.curve(B, A, 0.09, f)] : [this.curve(A, B, 0, f)];
      for (const c of curves) {
        const mat = flowMaterial(f.direction === "two-way" ? 1 : 0.85);
        this.flowMats.push(mat);
        this.scene.add(new THREE.Mesh(new THREE.TubeGeometry(c, 200, f.direction === "two-way" ? 0.034 : 0.03, 16), mat));
        this.scene.add(new THREE.Mesh(new THREE.TubeGeometry(c, 200, 0.16, 16), glowMaterial()));
      }
      const dir = B.pos.clone().sub(A.pos).normalize(), side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 0, 1)).normalize();
      const mid = curves[0].getPoint(0.5), toMid = mid.clone().sub(A.pos.clone().add(B.pos).multiplyScalar(0.5));
      const out = toMid.lengthSq() > 1e-4 ? toMid.normalize() : side;
      this.flows.push({ f, curve: curves[0], samples: curves[0].getPoints(64), labelPos: mid.clone().addScaledVector(out, 0.32) });
    }

    // bodies between the spheres
    this.free = [];
    for (const b of atlas.betweenBodies(edition, edit)) {
      const r = 0.12 * (b.look?.scale || 1) * (b.kind === "dead-god" ? 2.5 : b.kind === "nebula" ? 1.5 : 1);
      const node = await buildBody({ ...b, size_class: undefined }, r, this.app.renderer);
      node.group.position.set(...(b.map?.pos || [0, 0, 0]));
      this.scene.add(node.group);
      this.free.push({ b, node });
      this.items.push({ type: "body", id: b.id, world: node.group.position, r, b });
    }
  }

  curve(A, B, off, f) {
    const dir = B.pos.clone().sub(A.pos).normalize();
    const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 0, 1)).normalize().multiplyScalar(off);
    const start = A.pos.clone().addScaledVector(dir, A.r * 1.04).add(side), end = B.pos.clone().addScaledVector(dir, -B.r * 1.04).add(side);
    // bend each current a little to one side (stable per current) so the triangle reads as currents, not rulers
    const bendSide = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 0, 1)).normalize();
    const bend = (f.bend ?? ((hashStr(f.id) % 100) / 100 - 0.5) * 0.9);
    const mid = start.clone().add(end).multiplyScalar(0.5).addScaledVector(bendSide, bend * start.distanceTo(end) * 0.25).add(side);
    return new THREE.CatmullRomCurve3([start, mid, end]);
  }

  update(day, dtReal, tSec) {
    this.bgMat.uniforms.t.value = this.app.reducedMotion ? 0 : tSec;
    this.bgMat.uniforms.aspect.value = innerWidth / innerHeight;
    for (const m of this.flowMats) m.uniforms.t.value = this.app.reducedMotion ? 0 : tSec;
    const cam = this.app.camera;
    for (const { node } of this.free) { if (node.billboard) node.group.quaternion.copy(cam.quaternion); }
  }

  render(renderer, camera) {
    renderer.clear();
    renderer.render(this.bg, this.bgCam);
    renderer.clearDepth();
    renderer.render(this.scene, camera);
  }

  labelItems() {
    const out = [], sel = this.app.state.selected;
    for (const it of this.items) {
      if (it.type === "sphere") {
        const isSel = sel?.type === "sphere" && sel.id === it.id;
        out.push({ key: it.id, text: it.s.name, world: it.world, r: it.r, below: true, sub: it.s.charted ? "" : "Uncharted", ring: true, dash: !it.s.charted, sel: isSel, color: it.s.charted ? "#9db4ff" : "rgba(220,228,255,.55)" });
      } else {
        const isSel = sel?.type === "body" && sel.id === it.id;
        out.push({ key: it.id, text: it.b.name, world: it.world, r: it.r, color: it.b.look?.color || "#c8d0e0", ring: true, sel: isSel });
      }
    }
    for (const f of this.flows) {
      const isSel = sel?.type === "flow" && sel.id === f.f.id;
      const txt = (f.f.direction === "two-way" ? "Two-way current" : "One-way current") + (f.f.days ? ` · about ${f.f.days} days` : "");
      out.push({ key: `flow:${f.f.id}`, text: txt, world: f.labelPos, r: 0, dim: !isSel, flowLabel: true, sel: isSel });
    }
    return out;
  }

  // A click: the nearest sphere or body under the pointer, else the nearest current.
  pickFlow(x, y, project) {
    let best = null, bd = 12;
    for (const f of this.flows) for (const p of f.samples) {
      const s = project(p);
      if (!s) continue;
      const d = Math.hypot(s[0] - x, s[1] - y);
      if (d < bd) { bd = d; best = f.f.id; }
    }
    return best;
  }

  frameDistance() {
    let far = 3;
    for (const it of this.items) far = Math.max(far, it.world.length() + (it.r || 0));
    return far * 2.6 + 4;
  }
}

function flowMaterial(strength) {
  return new THREE.ShaderMaterial({
    uniforms: { k: { value: strength }, t: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    vertexShader: tubeVert,
    fragmentShader: `uniform float k; uniform float t; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){
        float s = fract(vUv.x * 11.0 - t * 0.35), pulse = pow(s, 7.0);
        float edge = pow(abs(dot(vN, vV)), 1.3);
        float ends = smoothstep(0.0, 0.07, vUv.x) * smoothstep(1.0, 0.93, vUv.x);
        gl_FragColor = vec4(vec3(0.86, 0.94, 1.0) * (0.32 + 1.5 * pulse) * edge * ends * k, 1.0);
      }`,
  });
}

function glowMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    vertexShader: tubeVert,
    fragmentShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ float ends = smoothstep(0.0, 0.1, vUv.x) * smoothstep(1.0, 0.9, vUv.x); float e = pow(abs(dot(vN, vV)), 2.2); gl_FragColor = vec4(vec3(0.55, 0.7, 1.0) * e * ends * 0.16, 1.0); }`,
  });
}

// 5e: a wildspace system seen from the Astral Sea, a soft silver bubble rather than a shell.
function hazeMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    vertexShader: tubeVert,
    fragmentShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ float ndv = clamp(dot(vN, vV), 0.0, 1.0); float f = pow(1.0 - ndv, 2.0); gl_FragColor = vec4(vec3(0.8, 0.84, 0.95) * (0.06 + f * 0.75), 1.0); }`,
  });
}
