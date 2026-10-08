// The atlas: every sphere, body and current on the map, from one JSON file (data/atlas.json).
// This module loads it, answers questions about it for the views, applies per-edition
// overrides, validates it before a save, and writes it back with a stable key order.

export const EDITIONS = ["2e", "5e"];

export const KINDS = {
  star: { label: "Star", icon: "flare" },
  planet: { label: "Planet", icon: "public" },
  moon: { label: "Moon", icon: "dark_mode" },
  asteroid: { label: "Asteroid or rock", icon: "landslide" },
  "asteroid-field": { label: "Asteroid field", icon: "grain" },
  ring: { label: "Ring", icon: "radio_button_unchecked" },
  comet: { label: "Comet", icon: "auto_awesome" },
  nebula: { label: "Nebula", icon: "blur_on" },
  structure: { label: "Structure or city", icon: "castle" },
  ship: { label: "Ship", icon: "sailing" },
  sargasso: { label: "Dead-magic zone", icon: "block" },
  portal: { label: "Portal", icon: "join_inner" },
  island: { label: "Floating island", icon: "terrain" },
  "dead-god": { label: "Dead god", icon: "skull" },
  other: { label: "Other", icon: "category" },
};
export const ELEMENTS = ["earth", "air", "fire", "water", "live", "other"];
export const SHAPES = ["sphere", "disc", "cluster", "irregular", "cylinder", "skull", "castle", "ship", "cloud"];
export const SIZE_CLASSES = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
export const SIZE_HELP = {
  A: "under 10 mi", B: "10-100 mi", C: "100-1,000 mi", D: "1,000-4,000 mi", E: "4,000-10,000 mi",
  F: "10,000-40,000 mi", G: "40,000-100,000 mi", H: "100,000 mi-1 million mi", I: "1-10 million mi", J: "over 10 million mi",
};

// Kinds that live between the spheres (on the phlogiston / Astral Sea map).
export const BETWEEN_KINDS = ["island", "ship", "structure", "nebula", "dead-god", "asteroid", "other"];

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

// An object with its edition overrides applied. Nested objects (orbit, look, ...) merge one level deep.
export function resolve(obj, edition) {
  const over = obj?.by_edition?.[edition];
  if (!over) return obj;
  const out = { ...obj };
  for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj(obj[k]) ? { ...obj[k], ...v } : v;
  return out;
}

export const inEdition = (obj, edition) => !obj.editions || obj.editions.length === 0 || obj.editions.includes(edition);

export function slugify(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}

export function uniqueId(base, taken) {
  let id = slugify(base), n = 2;
  while (taken.has(id)) id = `${slugify(base)}-${n++}`;
  return id;
}

export class Atlas {
  constructor(json) {
    this.data = json;
    this.data.between ??= { bodies: [] };
    this.data.between.bodies ??= [];
    this.data.spheres ??= [];
    this.data.flows ??= [];
    for (const s of this.data.spheres) s.bodies ??= [];
  }

  static async load(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return new Atlas(await res.json());
  }

  get spheresAll() { return this.data.spheres; }
  spheres(edition, showSecret = false) {
    return this.data.spheres.filter((s) => inEdition(s, edition) && (showSecret || !s.secret)).map((s) => resolve(s, edition));
  }
  sphere(id) { return this.data.spheres.find((s) => s.id === id) || null; }
  bodies(sphereId, edition, showSecret = false) {
    const s = this.sphere(sphereId);
    if (!s) return [];
    return s.bodies.filter((b) => inEdition(b, edition) && (showSecret || !b.secret)).map((b) => resolve(b, edition));
  }
  body(sphereId, bodyId) {
    return (sphereId ? this.sphere(sphereId)?.bodies : this.data.between.bodies)?.find((b) => b.id === bodyId) || null;
  }
  betweenBodies(edition, showSecret = false) {
    return this.data.between.bodies.filter((b) => inEdition(b, edition) && (showSecret || !b.secret)).map((b) => resolve(b, edition));
  }
  flows(edition, showSecret = false) {
    return this.data.flows.filter((f) => inEdition(f, edition) && (showSecret || !f.secret));
  }
  flow(id) { return this.data.flows.find((f) => f.id === id) || null; }
  children(sphereId, bodyId) { return (this.sphere(sphereId)?.bodies || []).filter((b) => b.parent === bodyId); }
  primary(sphereId, edition) { return this.bodies(sphereId, edition).find((b) => !b.parent) || null; }

  // ----- edits -----
  takenSphereIds() { return new Set(this.data.spheres.map((s) => s.id)); }
  takenBodyIds(sphereId) { return new Set((sphereId ? this.sphere(sphereId)?.bodies : this.data.between.bodies).map((b) => b.id)); }
  takenFlowIds() { return new Set(this.data.flows.map((f) => f.id)); }

  addSphere(sphere) { this.data.spheres.push(sphere); return sphere; }
  addBody(sphereId, body) { (sphereId ? this.sphere(sphereId).bodies : this.data.between.bodies).push(body); return body; }
  addFlow(flow) { this.data.flows.push(flow); return flow; }

  removeSphere(id) {
    this.data.spheres = this.data.spheres.filter((s) => s.id !== id);
    this.data.flows = this.data.flows.filter((f) => f.from !== id && f.to !== id);
  }
  removeFlow(id) { this.data.flows = this.data.flows.filter((f) => f.id !== id); }
  // Removing a body also removes everything that orbits it, so nothing is left without a parent.
  removeBody(sphereId, id) {
    const list = sphereId ? this.sphere(sphereId).bodies : this.data.between.bodies;
    const gone = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const b of list) if (b.parent && gone.has(b.parent) && !gone.has(b.id)) { gone.add(b.id); grew = true; }
    }
    const keep = list.filter((b) => !gone.has(b.id));
    if (sphereId) this.sphere(sphereId).bodies = keep; else this.data.between.bodies = keep;
    return [...gone];
  }
  descendants(sphereId, id) {
    const list = this.sphere(sphereId)?.bodies || [];
    const out = [];
    const walk = (pid) => { for (const b of list) if (b.parent === pid) { out.push(b); walk(b.id); } };
    walk(id);
    return out;
  }

  // ----- validation: the same rules run in bin/orrery before a save is written -----
  validate() {
    const errs = [];
    const d = this.data;
    if (d.format !== 1) errs.push({ where: "format", msg: "format must be 1" });
    const sIds = new Set();
    d.spheres.forEach((s, i) => {
      const where = `spheres[${i}] (${s.id || "no id"})`;
      if (!s.id) errs.push({ where, msg: "a sphere needs an id" });
      if (sIds.has(s.id)) errs.push({ where, msg: `the id "${s.id}" is used twice` });
      sIds.add(s.id);
      if (!s.name) errs.push({ where, msg: "a sphere needs a name" });
      if (!Array.isArray(s.map?.pos) || s.map.pos.length !== 3) errs.push({ where, msg: "map.pos must be [x, y, z]" });
      errs.push(...this.validateBodies(s.bodies, where, true));
    });
    errs.push(...this.validateBodies(d.between.bodies, "between", false));
    const fIds = new Set();
    d.flows.forEach((f, i) => {
      const where = `flows[${i}] (${f.id || "no id"})`;
      if (!f.id) errs.push({ where, msg: "a current needs an id" });
      if (fIds.has(f.id)) errs.push({ where, msg: `the id "${f.id}" is used twice` });
      fIds.add(f.id);
      if (!sIds.has(f.from)) errs.push({ where, msg: `"from" names no sphere: ${f.from}` });
      if (!sIds.has(f.to)) errs.push({ where, msg: `"to" names no sphere: ${f.to}` });
      if (f.from === f.to) errs.push({ where, msg: "a current must join two different spheres" });
      if (!["one-way", "two-way"].includes(f.direction)) errs.push({ where, msg: "direction must be one-way or two-way" });
    });
    return errs;
  }

  validateBodies(list, base, inSphere) {
    const errs = [], ids = new Set(list.map((b) => b.id));
    const seen = new Set();
    list.forEach((b, i) => {
      const where = `${base}.bodies[${i}] (${b.id || "no id"})`;
      if (!b.id) errs.push({ where, msg: "a body needs an id" });
      if (seen.has(b.id)) errs.push({ where, msg: `the id "${b.id}" is used twice` });
      seen.add(b.id);
      if (!b.name) errs.push({ where, msg: "a body needs a name" });
      if (!KINDS[b.kind]) errs.push({ where, msg: `unknown kind "${b.kind}"` });
      if (inSphere) {
        if (b.parent && !ids.has(b.parent)) errs.push({ where, msg: `parent names no body in this sphere: ${b.parent}` });
        if (b.parent && b.kind !== "ring" && !b.orbit && !b.fixed && !b.field?.follows) errs.push({ where, msg: "a body with a parent needs an orbit or a fixed position" });
        if (b.orbit) {
          const o = b.orbit;
          if (!(o.radius_mi > 0) && !(o.peri_mi > 0 && o.apo_mi >= o.peri_mi)) errs.push({ where, msg: "orbit needs radius_mi, or peri_mi and apo_mi" });
        }
      } else if (!Array.isArray(b.map?.pos)) errs.push({ where, msg: "a body between the spheres needs map.pos [x, y, z]" });
      if (b.editions && b.editions.some((e) => !EDITIONS.includes(e))) errs.push({ where, msg: "editions can only hold 2e and 5e" });
    });
    // parent loops
    const byId = new Map(list.map((b) => [b.id, b]));
    for (const b of list) {
      let p = b.parent, n = 0;
      while (p && n++ < 64) { if (p === b.id) { errs.push({ where: `${base} (${b.id})`, msg: "parent chain loops back to itself" }); break; } p = byId.get(p)?.parent; }
    }
    return errs;
  }

  // ----- output with a stable key order, so saves make small git diffs -----
  toJSON() { return orderKeys(this.data, ""); }
  text() { return JSON.stringify(this.toJSON(), null, 2) + "\n"; }
}

const ORDER = {
  "": ["format", "title", "campaign", "between", "spheres", "flows"],
  sphere: ["id", "name", "aka", "charted", "secret", "map", "shell_radius_mi", "boundary", "calendar", "summary", "facts", "sources", "links", "dm", "editions", "by_edition", "bodies"],
  body: ["id", "name", "kind", "parent", "secret", "element", "shape", "size_class", "diameter_mi", "orbit", "fixed", "map", "field", "ring", "cloud", "day_hours", "look", "pins", "summary", "facts", "sources", "links", "dm", "editions", "by_edition"],
  flow: ["id", "from", "to", "direction", "days", "secret", "summary", "sources", "dm", "editions", "by_edition"],
};

function orderKeys(v, kind) {
  if (Array.isArray(v)) return v.map((x) => orderKeys(x, kind));
  if (!isObj(v)) return v;
  const order = ORDER[kind] || [];
  const keys = [...order.filter((k) => k in v), ...Object.keys(v).filter((k) => !order.includes(k)).sort()];
  const out = {};
  for (const k of keys) {
    // drop unset fields and empty strings, so a cleared form field leaves no trace in the file
    if (v[k] === undefined || v[k] === null && k !== "parent" && k !== "days" || (v[k] === "" && k !== "name")) continue;
    const childKind = kind === "" && k === "spheres" ? "sphere" : kind === "sphere" && k === "bodies" ? "body"
      : kind === "" && k === "flows" ? "flow" : kind === "" && k === "between" ? "betweenRoot" : kind === "betweenRoot" && k === "bodies" ? "body" : "";
    out[k] = orderKeys(v[k], childKind);
  }
  return out;
}
