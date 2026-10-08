// The inside of one sphere: its primary, every body on its orbit at the current date, the orbit
// lines, and the boundary (a crystal shell with stars on it in 2e, a silver haze in 5e).
import * as THREE from "three";
import * as O from "./orbits.js";
import { starfield, OrbitLine, hashStr, radialTex, sprite, TAU } from "./gfx.js";
import { buildBody, ringMesh, fieldPoints } from "./bodies.js";

const V = () => new THREE.Vector3();

export class SphereView {
  constructor(app) {
    this.app = app;
    this.scene = new THREE.Scene();
    this.nodes = new Map();
    this.order = [];
    this.kind = "sphere";
  }

  dispose() {
    this.scene.traverse((o) => { o.geometry?.dispose?.(); if (o.material) [].concat(o.material).forEach((m) => m.dispose?.()); });
    this.scene = new THREE.Scene();
    this.nodes.clear();
    this.order = [];
  }

  async build(sphereId) {
    const { atlas, edition, scale, edit } = this.app.state;
    const renderer = this.app.renderer;
    this.dispose();
    this.sphereId = sphereId;
    this.sphere = atlas.spheres(edition, true).find((s) => s.id === sphereId);
    const bodies = atlas.bodies(sphereId, edition, edit);
    const byId = new Map(bodies.map((b) => [b.id, b]));
    const order = [], seen = new Set();
    const visit = (b, depth = 0) => {
      if (seen.has(b.id) || depth > 32) return;
      if (b.parent && byId.has(b.parent)) visit(byId.get(b.parent), depth + 1);
      seen.add(b.id);
      order.push(b);
    };
    bodies.forEach((b) => visit(b));

    // the boundary: the shell radius from the data, or twice the farthest orbit (the sphere law)
    let far = 0;
    for (const b of bodies) {
      if (b.parent && byId.get(b.parent)?.parent) continue;
      if (b.orbit) { const el = O.elements(b.orbit); far = Math.max(far, el.a * (1 + el.e)); }
      if (b.fixed) far = Math.max(far, b.fixed.r_mi || 0);
    }
    const shellMi = this.sphere.shell_radius_mi || (far ? far * 2 : 1e9);
    this.R = O.primaryRadius(shellMi, scale);
    this.boundary = this.sphere.boundary?.[edition] || (edition === "2e" ? "shell" : "haze");
    this.buildBoundary(edition);

    this.scene.add(new THREE.AmbientLight(0x9fb0d0, 0.16));

    for (const b of order) {
      const parent = b.parent ? this.nodes.get(b.parent) : null;
      const sat = !!(parent && parent.b.parent);
      const r = O.drawRadius(b, sat);
      const node = await buildBody(b, r, renderer);
      Object.assign(node, { b, parent, sat, el: b.orbit ? O.elements(b.orbit) : null, world: V(), angle: 0 });
      if (b.orbit && node.el.P && b.day_hours && Math.abs(b.day_hours / 24 - node.el.P) < 0.02 * node.el.P) node.locked = true;
      this.nodes.set(b.id, node);
      this.order.push(node);

      if (b.kind === "ring" && parent) {
        const m = await ringMesh(b, parent.r, renderer);
        parent.group.add(m);
        node.mesh = m;
        node.group = parent.group;
        node.ringOf = parent;
        continue;
      }
      if (b.kind === "portal") {
        node.group.add(sprite(radialTex([[0, "rgba(255,255,255,1)"], [0.2, "rgba(200,220,255,.7)"], [1, "rgba(0,0,0,0)"]]), 1.4));
        node.mesh = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
        node.group.add(node.mesh);
      }
      if (b.kind === "sargasso" && b.orbit && (b.field?.count || 1) > 1) {
        // one orbit, several globes spaced evenly along it
        node.copies = [];
        for (let i = 1; i < b.field.count; i++) {
          const c = node.group.clone();
          this.scene.add(c);
          node.copies.push({ group: c, offset: i / b.field.count });
        }
      }
      if (b.field?.follows) {
        const lead = byId.get(b.field.follows);
        const leadEl = lead?.orbit ? O.elements(lead.orbit) : null;
        if (leadEl && parent) {
          const arc = (b.field.arc_deg || 70) / 360;
          const mapped = (d) => this.mapRel(O.positionAt({ ...leadEl, M0: 0, P: 0 }, 0, V()).applyAxisAngle(this.orbitNormal(leadEl), -d * arc * TAU), parent, sat);
          node.fieldOf = { lead: b.field.follows, el: leadEl };
          node.points = fieldPoints(b, mapped, hashStr(b.id));
          node.group.add(node.points);
        }
      } else if (b.kind === "asteroid-field" && parent) {
        const el = b.orbit ? O.elements(b.orbit) : { a: 1, e: 0, i: 0, node: 0, argp: 0, P: 0, M0: 0 };
        node.points = fieldPoints(b, (d) => this.mapRel(O.positionAt({ ...el, M0: d * TAU * 7.31, P: 0 }, 0, V()), parent, sat), hashStr(b.id));
        node.group.add(node.points);
      }

      if (node.el && b.kind !== "asteroid-field") {
        const samples = O.samplePath(node.el, 360).map((s) => ({ p: this.mapRel(s.p, parent, sat), f: s.f }));
        const line = new OrbitLine(samples, b.look?.color || "#8fa0bc", sat ? 1.2 : 1.5, b.kind === "comet" ? { dashed: true, dash: 0.3, gap: 0.25, floor: 0.12 } : { floor: sat ? 0.1 : 0.17 });
        const holder = new THREE.Group();
        holder.add(line.line);
        this.scene.add(holder);
        node.orbit = { line, holder };
      }
      if (!node.ringOf) this.scene.add(node.group);
    }
    this.update(this.app.state.day, 0);
  }

  // A position relative to the parent (true miles) -> view units, with the mapping for its level.
  mapRel(vMi, parent, sat) {
    if (!parent) return O.mapPrimary(vMi, this.app.state.scale, V());
    return sat ? O.mapSatellite(vMi, parent.r, V()) : O.mapPrimary(vMi, this.app.state.scale, V());
  }
  orbitNormal(el) { return new THREE.Vector3(0, 1, 0).applyAxisAngle(new THREE.Vector3(1, 0, 0), el.i).applyAxisAngle(new THREE.Vector3(0, 1, 0), el.node); }

  buildBoundary(edition) {
    const R = this.R;
    if (this.boundary === "shell") {
      // 2e: the stars are openings in the shell, so they sit on it
      this.scene.add(starfield(6500, R * 0.995, hashStr(this.sphereId)));
      this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(R, 96, 64), new THREE.ShaderMaterial({
        side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
        vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 5.0); gl_FragColor = vec4(vec3(0.55, 0.64, 1.0) * f * 0.35, 1.0); }`,
      })));
      this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(R * 1.002, 96, 64), crystalMaterial()));
    } else {
      // 5e: no shell; a silver haze where wildspace meets the Astral Sea
      this.scene.add(starfield(6500, 900, hashStr(this.sphereId)));
      this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(R, 96, 64), new THREE.ShaderMaterial({
        side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
        vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 2.2); gl_FragColor = vec4(vec3(0.78, 0.82, 0.92) * f * 0.42, 1.0); }`,
      })));
    }
  }

  update(day, dtReal) {
    const st = this.app.state, rate = st.playing ? st.rate : 0;
    const cam = this.app.camera;
    for (const n of this.order) {
      const b = n.b, p = n.parent;
      const pw = p ? p.world : V();
      if (n.ringOf) continue;
      if (n.fieldOf) {
        n.world.copy(pw);
        n.group.position.copy(pw);
        const lead = this.nodes.get(n.fieldOf.lead);
        if (lead?.el) {
          // turn the trail about the lead's orbit normal so it stays just behind the lead
          const axis = this.orbitNormal(lead.el);
          const a = O.positionAt({ ...lead.el, M0: 0, P: 0 }, 0, V()), now = O.positionAt(lead.el, day, V());
          const ang = Math.atan2(axis.dot(a.clone().cross(now)), a.dot(now));
          n.group.quaternion.setFromAxisAngle(axis, ang);
        }
        continue;
      }
      if (b.kind === "asteroid-field") {
        n.world.copy(pw);
        n.group.position.copy(pw);
        continue;
      }
      if (b.orbit && n.el) {
        const rel = this.mapRel(O.positionAt(n.el, day, V()), p, n.sat);
        n.world.copy(pw).add(rel);
        if (n.orbit) {
          n.orbit.holder.position.copy(pw);
          const sel = st.selected?.type === "body" ? st.selected.id : null;
          const boost = !sel || sel === b.id || sel === b.parent || this.nodes.get(sel)?.b.parent === b.id ? 1 : 0.3;
          const changed = boost !== n.orbit.line.boost;
          n.orbit.line.boost = boost;
          n.orbit.line.setHead((((O.meanAnomaly(n.el, day)) / TAU) % 1 + 1) % 1, changed);
        }
        if (n.copies) for (const c of n.copies) {
          const rc = this.mapRel(O.positionAt({ ...n.el, M0: n.el.M0 + c.offset * TAU }, day, V()), p, n.sat);
          c.group.position.copy(pw).add(rc);
        }
      } else if (b.fixed) {
        n.world.copy(pw).add(this.mapRel(O.fixedPosition(b.fixed), p, n.sat));
      } else n.world.copy(pw);
      n.group.position.copy(n.world);
      if (n.update) n.update({ world: n.world, camera: cam });
      if (n.billboard) n.group.quaternion.copy(cam.quaternion);
      if (n.mesh && n.locked && p) {
        n.mesh.lookAt(p.world);
      } else if (n.mesh && n.spin) {
        n.angle += Math.max(-0.15, Math.min(0.15, rate * n.spin)) * dtReal;
        n.mesh.rotation.y = n.angle;
      }
      if (n.tumble && n.mesh) { n.mesh.rotation.x += 0.4 * dtReal * Math.sign(rate || 0); n.mesh.rotation.z += 0.25 * dtReal * Math.sign(rate || 0); }
    }
  }

  // Everything the label layer should draw this frame.
  labelItems() {
    const cam = this.app.camera, items = [];
    const sel = this.app.state.selected;
    for (const n of this.order) {
      const b = n.b;
      if (b.kind === "ring") continue;
      let anchor = n.world, r = n.r;
      if (n.fieldOf) {
        const lead = this.nodes.get(n.fieldOf.lead);
        if (!lead) continue;
        const rel = lead.world.clone().sub(n.parent.world).applyAxisAngle(this.orbitNormal(lead.el), -1.05);
        anchor = n.parent.world.clone().add(rel);
        r = 0.05;
      }
      const near = n.parent ? cam.position.distanceTo(n.parent.world) < Math.max(n.parent.r * 26, 4) : true;
      const minor = n.sat || ["asteroid", "asteroid-field", "sargasso", "portal"].includes(b.kind);
      const isSel = sel?.type === "body" && sel.id === b.id;
      const show = isSel || (!minor ? true : near && this.app.state.layers.minor);
      if (!show) continue;
      items.push({ key: b.id, text: b.name, world: anchor, r, color: b.look?.color || "#9fb0c8", dim: minor && !n.sat ? true : b.kind === "nebula" || b.kind === "comet", ring: b.kind !== "asteroid-field", sel: isSel, kind: b.kind });
    }
    // surface pins (e.g. Calimport) when the camera is close to a textured world
    for (const n of this.order) {
      if (!n.b.pins?.length || !n.mesh) continue;
      if (cam.position.distanceTo(n.world) > n.r * 16) continue;
      for (const pin of n.b.pins) {
        const phi = pin.u * TAU, th = pin.v * Math.PI;
        const local = new THREE.Vector3(-Math.cos(phi) * Math.sin(th), Math.cos(th), Math.sin(phi) * Math.sin(th)).multiplyScalar(n.r * 1.004);
        const w = n.mesh.localToWorld(local.clone());
        const facing = w.clone().sub(n.world).normalize().dot(cam.position.clone().sub(w).normalize()) > 0.08;
        if (facing) items.push({ key: `${n.b.id}:pin:${pin.name}`, text: pin.name, world: w, r: 0, pin: true, link: pin.link });
      }
    }
    return items;
  }

  render(renderer, camera) {
    renderer.clear();
    renderer.render(this.scene, camera);
  }

  // Turn a world on its axis so its first map pin (Calimport on Toril) faces the given direction.
  facePin(id, dir) {
    const n = this.nodes.get(id);
    const pin = n?.b.pins?.[0];
    if (!pin || !n.mesh) return;
    const phi = pin.u * TAU, th = pin.v * Math.PI;
    const local = new THREE.Vector3(-Math.cos(phi) * Math.sin(th), Math.cos(th), Math.sin(phi) * Math.sin(th));
    n.angle = Math.atan2(dir.x, dir.z) - Math.atan2(local.x, local.z) - 0.25;
    n.mesh.rotation.y = n.angle;
  }

  bodyWorld(id) { return this.nodes.get(id)?.world || null; }
  bodyRadius(id) { return this.nodes.get(id)?.r || 0.5; }
  frameDistance() {
    let far = 3;
    for (const n of this.order) if (!n.sat && n.b.orbit && n.b.kind === "planet") far = Math.max(far, n.world.length());
    return far * 2.5;
  }

  // Load the largest texture tier the screen can use for a world that the camera has focused on.
  async sharpen(id) {
    const n = this.nodes.get(id);
    if (!n?.texturedSphere || typeof n.b.look?.texture !== "object" || n.sharp) return;
    n.sharp = true;
    const { bodyTexture } = await import("./gfx.js");
    const tex = await bodyTexture(n.b.look, this.app.renderer, { maxTier: 16384 });
    if (tex && n.mesh?.material) { n.mesh.material.map = tex; n.mesh.material.needsUpdate = true; }
  }
}

// The crystal shell seen from outside in the sphere view: clear glass with a rainbow rim, so the
// system inside stays visible. (The phlogiston map draws the shells as opaque beads.)
export function crystalMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec3 vN; varying vec3 vV;
      void main(){
        float ndv = clamp(dot(vN, vV), 0.0, 1.0), fr = pow(1.0 - ndv, 3.2);
        vec3 iri = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + vN.y * 0.55 + vN.x * 0.35));
        vec3 col = mix(vec3(0.7, 0.78, 1.0), iri, 0.55) * fr * 0.55 + vec3(0.02, 0.025, 0.04);
        vec3 Lh = normalize(normalize(vec3(-0.45, 0.65, 0.7)) + vV);
        col += pow(max(dot(vN, Lh), 0.0), 400.0) * 0.35;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

// The outside of a crystal shell: dark ceramic with a rainbow rim (the phlogiston's light).
export function beadMaterial(tint = [0.028, 0.032, 0.05]) {
  return new THREE.ShaderMaterial({
    uniforms: { base: { value: new THREE.Vector3(...tint) } },
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 base; varying vec3 vN; varying vec3 vV;
      void main(){
        float ndv = clamp(dot(vN, vV), 0.0, 1.0), fr = pow(1.0 - ndv, 3.0);
        vec3 iri = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + vN.y * 0.55 + vN.x * 0.35));
        vec3 col = base * (0.4 + 0.6 * ndv) + mix(vec3(0.78, 0.84, 1.0), iri, 0.6) * fr * 1.25;
        vec3 Lh = normalize(normalize(vec3(-0.45, 0.65, 0.7)) + vV);
        col += pow(max(dot(vN, Lh), 0.0), 600.0) * 0.45;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}
