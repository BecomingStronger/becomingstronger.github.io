// One builder per kind of body. Each returns a node: { group, mesh, r, update?(ctx) }.
// group is placed by the view every frame; update() handles spin and anything that has to face
// the primary (a comet's tail, the Spindle of a disc world).
import * as THREE from "three";
import { bodyTexture, radialTex, sprite, points, rng, gauss, hashStr, TAU, canvasTex } from "./gfx.js";

const ringTexCache = new Map();
const glow = (stops) => radialTex(stops, 256);

export async function buildBody(b, r, renderer) {
  const color = new THREE.Color(b.look?.color || "#9fb0c8");
  const group = new THREE.Group();
  const node = { group, r, spin: 0, update: null, mesh: null };
  const shape = b.shape || (b.kind === "asteroid" || b.kind === "island" ? "irregular" : "sphere");

  if (b.kind === "star") {
    const core = new THREE.Mesh(new THREE.SphereGeometry(r * 0.9, 48, 32), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
    group.add(core);
    const warm = new THREE.Color(color).lerp(new THREE.Color("#ffb070"), 0.5);
    const c = (k, a) => `rgba(${Math.round(warm.r * 255 * k)},${Math.round(warm.g * 255 * k)},${Math.round(warm.b * 255 * k)},${a})`;
    group.add(sprite(glow([[0, "rgba(255,252,246,1)"], [0.1, c(1, 0.9)], [0.3, c(1, 0.32)], [0.6, c(0.9, 0.08)], [1, c(0.8, 0)]]), r * 11));
    group.add(sprite(glow([[0, c(1, 0.22)], [0.35, c(1, 0.06)], [1, "rgba(0,0,0,0)"]]), r * 36));
    const light = new THREE.PointLight(0xfff3e4, 3.4, 0, 0);
    group.add(light);
    node.mesh = core;
    return node;
  }

  if (b.kind === "nebula") {
    const cl = b.cloud || {};
    const cols = (cl.colors?.length ? cl.colors : [b.look?.color || "#9db4ff"]).map((c) => new THREE.Color(c));
    const soft = glow([[0, "rgba(255,255,255,.9)"], [0.4, "rgba(255,255,255,.35)"], [1, "rgba(255,255,255,0)"]]);
    const R = rng(hashStr(b.id));
    const L = 1.6 * (b.look?.scale || 1);
    const blobs = cl.shape === "fan" ? 9 : cl.shape === "galleon" ? 10 : 7;
    for (let i = 0; i < blobs; i++) {
      const t = i / (blobs - 1);
      const s = sprite(soft, L * (cl.shape === "fan" ? 0.25 + t * 0.9 : 0.5 + R() * 0.5), 0.55, cols[i % cols.length]);
      if (cl.shape === "fan") s.position.set((t - 0.5) * L * 1.6, (R() - 0.5) * L * 0.25 * t, 0);
      else if (cl.shape === "galleon") {
        // hull low and long, three sails above it
        if (i < 4) s.position.set((t * 3 - 0.6) * L * 0.5, -L * 0.25, 0), s.scale.set(L * 0.7, L * 0.3, 1);
        else s.position.set(((i - 4) % 3 - 1) * L * 0.38, L * (0.05 + 0.18 * Math.floor((i - 4) / 3)), 0), s.scale.set(L * 0.36, L * 0.62, 1);
      } else s.position.set(gauss(R) * L * 0.3, gauss(R) * L * 0.2, gauss(R) * L * 0.2);
      group.add(s);
    }
    node.mesh = new THREE.Mesh(new THREE.SphereGeometry(L * 0.6, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    group.add(node.mesh);
    node.billboard = true;
    return node;
  }

  if (b.kind === "ring") return node; // the view attaches rings to the parent (see ringMesh)

  if (b.kind === "sargasso") {
    const mat = new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.35), transparent: true, opacity: 0.55, roughness: 1, emissive: color.clone().multiplyScalar(0.08) });
    node.mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 24), mat);
    group.add(node.mesh);
    group.add(sprite(glow([[0, "rgba(0,0,0,0)"], [0.6, "rgba(0,0,0,0)"], [0.7, "rgba(150,120,220,.25)"], [1, "rgba(0,0,0,0)"]]), r * 2.9));
    return node;
  }

  if (b.kind === "comet") {
    const head = new THREE.Mesh(new THREE.SphereGeometry(r * 0.8, 20, 14), new THREE.MeshBasicMaterial({ color: color.clone(), toneMapped: false }));
    group.add(head);
    group.add(sprite(glow([[0, "rgba(235,245,255,.9)"], [0.25, "rgba(170,200,255,.25)"], [1, "rgba(0,0,0,0)"]]), r * 9));
    const tailTex = canvasTex(256, 32, (g, w, h) => { const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, "rgba(220,235,255,.9)"); gr.addColorStop(1, "rgba(120,160,255,0)"); g.fillStyle = gr; g.beginPath(); g.moveTo(0, h / 2 - 3); g.lineTo(w, 0); g.lineTo(w, h); g.lineTo(0, h / 2 + 3); g.fill(); });
    const tail = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.22), new THREE.MeshBasicMaterial({ map: tailTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }));
    tail.geometry.translate(0.5, 0, 0);
    group.add(tail);
    node.mesh = head;
    node.update = ({ world, camera }) => {
      // the tail points away from the primary and grows near it
      const away = world.clone().normalize();
      const d = world.length();
      const len = Math.max(0.6, 5.5 / Math.max(d, 1.2));
      tail.scale.set(len, len, len);
      tail.position.set(0, 0, 0);
      tail.lookAt(world.clone().add(camera.position.clone().sub(world).normalize()));
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), away);
      tail.quaternion.copy(q);
    };
    return node;
  }

  // surfaces
  const map = ["sphere", "disc", "cylinder"].includes(shape) && b.kind !== "structure" && b.kind !== "ship" ? await bodyTexture(b.look, renderer) : null;
  const surface = new THREE.MeshStandardMaterial({ map, color: map ? 0xffffff : color, roughness: 0.92, metalness: 0 });

  if (shape === "disc") {
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(r, r, r * 0.12, 72), new THREE.MeshStandardMaterial({ color: color.clone().lerp(new THREE.Color("#5f8fe0"), 0.55), roughness: 0.35, metalness: 0.1 }));
    const spindle = new THREE.Mesh(new THREE.ConeGeometry(r * 0.12, r * 0.8, 20), new THREE.MeshStandardMaterial({ color: 0xe6ebf5, roughness: 0.9 }));
    spindle.position.y = r * 0.46;
    const pivot = new THREE.Group();
    pivot.add(disc, spindle);
    group.add(pivot);
    node.mesh = disc;
    node.update = ({ world }) => pivot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), world.clone().negate().normalize());
  } else if (shape === "cluster") {
    const R = rng(hashStr(b.id)), nodes = [];
    for (let i = 0; i < 6; i++) {
      const p = new THREE.Vector3((i - 2.5) * r * 0.8, Math.sin(i * 1.7) * r * 0.42, Math.cos(i * 1.3) * r * 0.38);
      nodes.push(p);
      const s = new THREE.Mesh(new THREE.SphereGeometry(r * (0.32 + R() * 0.26), 24, 16), new THREE.MeshStandardMaterial({ color: R() < 0.5 ? 0x6d8f45 : 0x7d6447, roughness: 1 }));
      s.position.copy(p);
      group.add(s);
    }
    group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(nodes), 64, r * 0.13, 8), new THREE.MeshStandardMaterial({ color: 0x86e070, emissive: 0x1d4d16, roughness: 0.8 })));
    node.mesh = new THREE.Mesh(new THREE.SphereGeometry(r * 2.2, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    group.add(node.mesh);
  } else if (shape === "irregular") {
    const g = new THREE.IcosahedronGeometry(r, 3), p = g.attributes.position, R = rng(hashStr(b.id)), v = new THREE.Vector3();
    const bumps = Array.from({ length: 7 }, () => [new THREE.Vector3(gauss(R), gauss(R), gauss(R)).normalize(), 0.12 + R() * 0.25]);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const n = v.clone().normalize();
      let k = 1;
      for (const [d, a] of bumps) k += a * Math.pow(Math.max(0, n.dot(d)), 3) * (R() < 0.5 ? 1 : -0.6);
      v.multiplyScalar(k * (0.82 + 0.1 * Math.sin(n.x * 9) * Math.cos(n.y * 7)));
      p.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    node.mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true }));
    group.add(node.mesh);
  } else if (shape === "cylinder") {
    node.mesh = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.28, r * 0.28, r * 2.2, 24), new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.8 }));
    group.add(node.mesh);
    node.tumble = true;
  } else if (shape === "skull") {
    const bone = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
    const cranium = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 24), bone);
    cranium.scale.set(0.9, 1, 1.05);
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(r * 1.1, r * 0.5, r * 0.9), bone);
    jaw.position.set(0, -r * 0.82, r * 0.12);
    const eyeM = new THREE.MeshBasicMaterial({ color: 0x050505 });
    for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(r * 0.22, 12, 10), eyeM); e.position.set(sx * r * 0.36, -r * 0.08, r * 0.86); group.add(e); }
    group.add(cranium, jaw);
    node.mesh = cranium;
  } else if (shape === "castle" || b.kind === "structure") {
    const land = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.1, r * 0.6, r * 0.35, 24), new THREE.MeshStandardMaterial({ color: 0x5d7a45, roughness: 1 }));
    const stone = new THREE.MeshStandardMaterial({ color: 0xd9d4c8, roughness: 0.9 });
    const keep = new THREE.Mesh(new THREE.BoxGeometry(r * 0.7, r * 0.6, r * 0.7), stone);
    keep.position.y = r * 0.45;
    group.add(land, keep);
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * TAU + 0.4, sp = new THREE.Mesh(new THREE.ConeGeometry(r * 0.12, r * 0.8, 10), stone);
      sp.position.set(Math.cos(a) * r * 0.42, r * 0.9, Math.sin(a) * r * 0.42);
      group.add(sp);
    }
    node.mesh = new THREE.Mesh(new THREE.SphereGeometry(r * 1.4, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    group.add(node.mesh);
  } else if (shape === "ship" || b.kind === "ship") {
    const hull = new THREE.Mesh(new THREE.ConeGeometry(r * 0.35, r * 1.8, 12), new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.3 }));
    hull.rotation.z = Math.PI / 2;
    group.add(hull);
    node.mesh = new THREE.Mesh(new THREE.SphereGeometry(r * 1.4, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    group.add(node.mesh);
  } else {
    node.mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 64, 48), surface);
    group.add(node.mesh);
    node.texturedSphere = !!map;
  }

  if (b.look?.atmosphere) {
    const atm = new THREE.Color(b.look.atmosphere);
    group.add(new THREE.Mesh(new THREE.SphereGeometry(r * 1.004, 64, 48), rimMaterial(atm)));
    const limb = 1 / 1.34;
    const halo = sprite(radialTex([[0, "rgba(0,0,0,0)"], [limb - 0.02, "rgba(0,0,0,0)"], [limb, `rgba(${atm.r * 255 | 0},${atm.g * 255 | 0},${atm.b * 255 | 0},.42)`], [limb + 0.04, `rgba(${atm.r * 230 | 0},${atm.g * 230 | 0},${atm.b * 255 | 0},.16)`], [limb + 0.12, "rgba(70,130,255,.05)"], [1, "rgba(0,0,0,0)"]], 512), 2 * 1.34 * r);
    group.add(halo);
  }
  if (b.day_hours > 0 && node.mesh) node.spin = TAU / (b.day_hours / 24);
  return node;
}

// Fresnel rim for an atmosphere, brighter on the day side.
export function rimMaterial(color) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    uniforms: { c: { value: color } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vW; varying vec3 vP;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        vW = normalize((modelMatrix * vec4(normal, 0.0)).xyz); vP = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 c; varying vec3 vN; varying vec3 vV; varying vec3 vW; varying vec3 vP;
      void main(){ float f = pow(1.0 - max(dot(vN, vV), 0.0), 2.4); vec3 sun = normalize(-vP); float day = smoothstep(-0.35, 0.5, dot(vW, sun));
        gl_FragColor = vec4(c * f * (0.2 + 0.75 * day), 1.0); }`,
  });
}

// A planetary ring around a parent of drawn radius pr.
export async function ringMesh(b, pr, renderer) {
  const ring = b.ring || {};
  const inner = pr * (ring.inner || 1.45), outer = pr * (ring.outer || 2.45);
  const g = new THREE.RingGeometry(inner, outer, 160, 1);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, (Math.hypot(p.getX(i), p.getY(i)) - inner) / (outer - inner), 0.5);
  let map = null;
  const t = b.look?.texture;
  if (typeof t === "string" && !t.startsWith("proc:")) {
    if (!ringTexCache.has(t)) ringTexCache.set(t, bodyTexture({ texture: t }, renderer));
    map = await ringTexCache.get(t);
  }
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map, color: new THREE.Color(b.look?.color || "#dfe5f0"), transparent: true, opacity: map ? 1 : 0.55, side: THREE.DoubleSide, depthWrite: false, roughness: 1 }));
  m.rotation.x = -Math.PI / 2 + ((ring.tilt_deg ?? 24) * Math.PI / 180);
  return m;
}

// Particles for an asteroid field. "follows": a trail behind another body on its orbit.
// Otherwise a ring of rocks at the field's own orbit radius around the parent.
export function fieldPoints(b, pathPoints, seed) {
  const f = b.field || {};
  const R = rng(seed), list = [];
  const n = Math.min(f.count || 600, 4000), spread = f.spread ?? 0.05;
  const c = new THREE.Color(b.look?.color || "#e9eefc");
  for (let i = 0; i < n; i++) {
    const d = Math.pow(R(), 1.6);
    const base = pathPoints(d);
    const radial = base.clone().normalize().multiplyScalar(gauss(R) * spread * base.length());
    const q = base.add(radial).add(new THREE.Vector3(0, gauss(R) * spread * 0.5 * base.length(), 0));
    const k = f.follows ? Math.pow(1 - d * 0.92, 1.2) : 0.5 + 0.5 * R();
    list.push({ p: q.toArray(), c: [c.r * k, c.g * k, c.b * k], s: 0.9 + 2.2 * R() * (0.35 + 0.65 * k) });
  }
  return points(list);
}
