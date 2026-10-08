// Edit mode: forms to add and change spheres, currents and bodies, then save the atlas.
// With the local editor server (bin/orrery serve) a save writes site/data/atlas.json and Publish
// puts the page on the website. Without it (?edit on any copy) edits stay in this browser until
// you download the file.
import { KINDS, ELEMENTS, SHAPES, SIZE_CLASSES, SIZE_HELP, EDITIONS, BETWEEN_KINDS, uniqueId } from "./atlas.js";
import { esc, toast, confirmDialog } from "./ui.js";
import * as H from "./harptos.js";

const DRAFT = "wildspace-orrery-draft";
const TEXTURES = [
  ["", "Painted from the color"],
  ["assets/textures/2k_mars.jpg", "Rocky, red-brown (Mars)"],
  ["assets/textures/2k_mercury.jpg", "Cratered gray (Mercury)"],
  ["assets/textures/2k_moon.jpg", "Moon"],
  ["assets/textures/2k_venus_atmosphere.jpg", "Cloud deck (Venus)"],
  ["proc:karpri", "Ocean with ice caps"],
  ["proc:chandos", "Ocean with islands"],
];

// ---------- dotted-path helpers ----------
const get = (o, path) => path.split(".").reduce((v, k) => (v == null ? v : v[k]), o);
function set(o, path, value) {
  const keys = path.split(".");
  let cur = o;
  keys.slice(0, -1).forEach((k) => { if (typeof cur[k] !== "object" || cur[k] === null || Array.isArray(cur[k])) cur[k] = {}; cur = cur[k]; });
  const last = keys[keys.length - 1];
  const empty = value === "" || value === undefined || (Array.isArray(value) && value.length === 0);
  if (empty) delete cur[last]; else cur[last] = value;
}
function prune(o) {
  for (const [k, v] of Object.entries(o)) {
    if (v && typeof v === "object" && !Array.isArray(v)) { prune(v); if (!Object.keys(v).length) delete o[k]; }
  }
  return o;
}

// ---------- form specs ----------
const opt = (pairs) => pairs.map((p) => (Array.isArray(p) ? p : [p, p]));
const isOrbiter = (o) => !["star", "ring", "asteroid-field"].includes(o.kind) && o.parent;

function bodySpec(app, sphereId, obj) {
  const atlas = app.state.atlas;
  const others = sphereId ? atlas.sphere(sphereId).bodies.filter((b) => b.id !== obj.id && !atlas.descendants(sphereId, obj.id || "\u0000").some((d) => d.id === b.id)) : [];
  const sphereLike = (o) => ["planet", "moon", "star", "asteroid", "island", "other"].includes(o.kind);
  if (!sphereId) {
    return [
      { type: "section", label: "Basics" },
      { key: "name", label: "Name", type: "text", required: true },
      { key: "kind", label: "Kind", type: "select", options: BETWEEN_KINDS.map((k) => [k, KINDS[k].label]), rerender: true },
      { key: "map.pos", label: "Position on the map", type: "vec3", place: true },
      { key: "cloud.shape", label: "Cloud shape", type: "select", options: opt(["blob", "galleon", "fan"]), when: (o) => o.kind === "nebula" },
      { key: "cloud.colors", label: "Cloud colors (comma list of #hex)", type: "list", when: (o) => o.kind === "nebula" },
      { type: "section", label: "Look" },
      { key: "look.color", label: "Color", type: "color" },
      { key: "look.scale", label: "Draw size (1 is normal)", type: "number", step: 0.1 },
      ...infoFields(),
    ];
  }
  return [
    { type: "section", label: "Basics" },
    { key: "name", label: "Name", type: "text", required: true },
    { key: "kind", label: "Kind", type: "select", options: Object.entries(KINDS).map(([k, v]) => [k, v.label]), rerender: true },
    { key: "parent", label: "Orbits", type: "select", options: [["", "Nothing (it is the center)"], ...others.map((b) => [b.id, b.name])], rerender: true },
    { key: "element", label: "Element", type: "select", options: [["", "None"], ...opt(ELEMENTS)], when: sphereLike },
    { key: "shape", label: "Shape", type: "select", options: [["", "Default for the kind"], ...opt(SHAPES)], when: (o) => !["ring", "asteroid-field", "nebula", "comet", "sargasso"].includes(o.kind) },
    { key: "size_class", label: "Size class", type: "select", options: [["", "Default for the kind"], ...SIZE_CLASSES.map((c) => [c, `${c}: ${SIZE_HELP[c]}`])], when: (o) => !["ring", "nebula", "asteroid-field"].includes(o.kind) },
    { key: "diameter_mi", label: "Diameter (miles)", type: "number", when: (o) => !["ring", "nebula", "asteroid-field"].includes(o.kind) },
    { key: "day_hours", label: "Day length (hours)", type: "number", when: sphereLike },

    { type: "section", label: "Position", when: (o) => o.parent || o.kind === "star" },
    { key: "_place", label: "How it moves", type: "select", options: [["orbit", "On an orbit"], ["fixed", "Fixed in place"]], rerender: true, when: isOrbiter },
    { key: "orbit.radius_mi", label: "Orbit radius (miles)", type: "number", help: "For an oval orbit, leave this blank and give the closest and farthest points.", when: (o) => isOrbiter(o) && o._place !== "fixed" || o.kind === "asteroid-field" && !o.field?.follows },
    { key: "orbit.peri_mi", label: "Closest point (miles)", type: "number", when: (o) => isOrbiter(o) && o._place !== "fixed" },
    { key: "orbit.apo_mi", label: "Farthest point (miles)", type: "number", when: (o) => isOrbiter(o) && o._place !== "fixed" },
    { key: "orbit.period_days", label: "Orbital period (days)", type: "number", help: "Blank: it does not move.", when: (o) => isOrbiter(o) && o._place !== "fixed" },
    { key: "orbit.phase_deg", label: "Position on 1 Hammer 1492 DR (degrees)", type: "number", help: "0 to 360. Change it to move the body along its orbit.", when: (o) => isOrbiter(o) && o._place !== "fixed" },
    { key: "orbit.incl_deg", label: "Tilt of the orbit (degrees)", type: "number", when: (o) => isOrbiter(o) && o._place !== "fixed" },
    { key: "orbit.node_deg", label: "Turn of the tilt (degrees)", type: "number", when: (o) => isOrbiter(o) && o._place !== "fixed" },
    { key: "orbit.argp_deg", label: "Direction of the closest point (degrees)", type: "number", when: (o) => isOrbiter(o) && o._place !== "fixed" },
    { key: "orbit.approx", label: "The position is a guess", type: "switch", when: (o) => isOrbiter(o) && o._place !== "fixed" },
    { key: "fixed.r_mi", label: "Distance from the center (miles)", type: "number", when: (o) => isOrbiter(o) && o._place === "fixed" },
    { key: "fixed.lon_deg", label: "Direction around (degrees)", type: "number", when: (o) => isOrbiter(o) && o._place === "fixed" },
    { key: "fixed.lat_deg", label: "Height above the plane (degrees)", type: "number", when: (o) => isOrbiter(o) && o._place === "fixed" },
    { key: "fixed.approx", label: "The position is a guess", type: "switch", when: (o) => isOrbiter(o) && o._place === "fixed" },
    { key: "field.follows", label: "Trails behind", type: "select", options: [["", "Nothing (a full ring of rocks)"], ...others.map((b) => [b.id, b.name])], when: (o) => o.kind === "asteroid-field", rerender: true },
    { key: "field.arc_deg", label: "Length of the trail (degrees of orbit)", type: "number", when: (o) => o.kind === "asteroid-field" && o.field?.follows },
    { key: "field.count", label: "How many rocks or globes", type: "number", when: (o) => ["asteroid-field", "sargasso"].includes(o.kind) },
    { key: "field.spread", label: "Spread (0.01 to 0.2)", type: "number", step: 0.01, when: (o) => o.kind === "asteroid-field" },
    { key: "ring.inner", label: "Inner edge (times the planet's radius)", type: "number", step: 0.05, when: (o) => o.kind === "ring" },
    { key: "ring.outer", label: "Outer edge (times the planet's radius)", type: "number", step: 0.05, when: (o) => o.kind === "ring" },
    { key: "ring.tilt_deg", label: "Tilt (degrees)", type: "number", when: (o) => o.kind === "ring" },
    { key: "cloud.shape", label: "Cloud shape", type: "select", options: opt(["blob", "galleon", "fan"]), when: (o) => o.kind === "nebula" },
    { key: "cloud.colors", label: "Cloud colors (comma list of #hex)", type: "list", when: (o) => o.kind === "nebula" },

    { type: "section", label: "Look" },
    { key: "look.color", label: "Color (orbit line and marker)", type: "color" },
    { key: "look.texture", label: "Surface", type: "texture", when: (o) => ["planet", "moon", "other"].includes(o.kind) && (!o.shape || o.shape === "sphere") },
    { key: "look.atmosphere", label: "Atmosphere glow (#hex, blank for none)", type: "text", when: (o) => ["planet", "moon"].includes(o.kind) },
    { key: "look.scale", label: "Draw size (1 is normal)", type: "number", step: 0.1 },
    ...infoFields(),
  ];
}

function infoFields() {
  return [
    { type: "section", label: "Information" },
    { key: "summary", label: "Description", type: "textarea" },
    { key: "facts", label: "Facts", type: "rows", cols: ["Label", "Value"] },
    { key: "sources", label: "Sources", type: "rows", cols: ["Book", "Pages"], obj: ["title", "pages"] },
    { key: "links", label: "Links", type: "rows", cols: ["Label", "URL"], obj: ["label", "url"] },
    { type: "section", label: "Visibility" },
    { key: "dm", label: "DM notes (never published)", type: "textarea" },
    { key: "secret", label: "Secret: leave out of the published page", type: "switch" },
    { key: "editions", label: "Editions", type: "editions" },
  ];
}

function sphereSpec(isNew) {
  return [
    { type: "section", label: "Basics" },
    { key: "name", label: "Name", type: "text", required: true },
    { key: "aka", label: "Other names (comma list)", type: "list" },
    { key: "charted", label: "Charted (has bodies to show)", type: "switch" },
    { key: "map.pos", label: "Position on the map", type: "vec3", place: true },
    { key: "map.size", label: "Size on the map (1 is normal)", type: "number", step: 0.05 },
    { key: "shell_radius_mi", label: "Shell radius (miles)", type: "number", help: "Blank: twice the farthest orbit, the rule from the Concordance of Arcane Space." },
    { key: "boundary.2e", label: "Edge in 2e", type: "select", options: [["shell", "Crystal shell"], ["haze", "Haze"]] },
    { key: "boundary.5e", label: "Edge in 5e", type: "select", options: [["haze", "Silver haze"], ["shell", "Crystal shell"]] },
    ...(isNew ? [
      { type: "section", label: "Center" },
      { key: "_primary", label: "What sits at the center", type: "select", options: [["star", "A star"], ["planet", "A planet (the sun orbits it)"], ["none", "Nothing yet"]] },
      { key: "_primaryName", label: "Its name", type: "text", help: "For example: The Sun" },
    ] : []),
    ...infoFields(),
  ];
}

function flowSpec(app) {
  const spheres = app.state.atlas.data.spheres.map((s) => [s.id, s.name]);
  return [
    { type: "section", label: "Current" },
    { key: "from", label: "From", type: "select", options: spheres },
    { key: "to", label: "To", type: "select", options: spheres },
    { key: "direction", label: "Direction", type: "select", options: [["one-way", "One way"], ["two-way", "Both ways"]] },
    { key: "days", label: "Travel time (days)", type: "number" },
    { key: "bend", label: "Curve (-1 to 1)", type: "number", step: 0.1 },
    { type: "section", label: "Information" },
    { key: "summary", label: "Description", type: "textarea" },
    { key: "sources", label: "Sources", type: "rows", cols: ["Book", "Pages"], obj: ["title", "pages"] },
    { type: "section", label: "Visibility" },
    { key: "dm", label: "DM notes (never published)", type: "textarea" },
    { key: "secret", label: "Secret: leave out of the published page", type: "switch" },
    { key: "editions", label: "Editions", type: "editions", help: "Currents exist in 2e. Tick 5e to show it as a known route in the Astral Sea." },
  ];
}

// ---------- the editor ----------
export class Editor {
  constructor(app) {
    this.app = app;
    this.history = [];
    this.dirty = false;
    this.server = false;
    this.placing = null;
  }

  async detect() {
    try {
      // only the local editor server has the API; a website copy skips the probe
      if (!["127.0.0.1", "localhost"].includes(location.hostname)) throw new Error("no editor server");
      const r = await fetch("api/status", { cache: "no-store" });
      if (r.ok) { const j = await r.json(); this.server = !!j.edit; this.siteUrl = j.site_url; }
    } catch { /* a static copy: no editor server */ }
    this.allowed = this.server || new URLSearchParams(location.search).has("edit");
    return this.allowed;
  }

  draft() { try { return localStorage.getItem(DRAFT); } catch { return null; } }

  renderBar() {
    const bar = document.getElementById("editbar");
    if (!bar) return;
    const between = this.app.state.view === "between";
    bar.innerHTML = `
      ${between ? `<button class="tonal" data-ed="add-sphere"><i>add_circle</i><span>Sphere</span></button><button class="tonal" data-ed="add-flow"><i>moving</i><span>Current</span></button>` : ""}
      <button class="tonal" data-ed="add-body"><i>add</i><span>Body</span></button>
      <span class="sep"></span>
      <button class="circle transparent" data-ed="settings" title="Settings"><i>settings</i></button>
      <button class="circle transparent" data-ed="undo" title="Undo" ${this.history.length ? "" : "disabled"}><i>undo</i></button>
      <button class="circle transparent" data-ed="download" title="Download atlas.json"><i>download</i></button>
      <span class="status">${this.dirty ? "Unsaved changes" : this.server ? "All changes saved" : "Draft in this browser"}</span>
      <button data-ed="save" ${this.dirty ? "" : "disabled"}><i>save</i><span>Save</span></button>
      ${this.server ? `<button class="border" data-ed="publish"><i>publish</i><span>Publish</span></button>` : ""}`;
    bar.onclick = (e) => {
      const b = e.target.closest("[data-ed]");
      if (!b || b.disabled) return;
      const act = b.dataset.ed;
      if (act === "add-sphere") this.openSphere(null);
      else if (act === "add-flow") this.openFlow(null);
      else if (act === "add-body") this.openBody(this.app.state.view === "sphere" ? this.app.state.sphereId : null, null);
      else if (act === "settings") this.openSettings();
      else if (act === "undo") this.undo();
      else if (act === "download") this.download();
      else if (act === "save") this.save();
      else if (act === "publish") this.publish();
    };
  }

  snapshot() {
    this.history.push(JSON.stringify(this.app.state.atlas.data));
    if (this.history.length > 40) this.history.shift();
  }

  async undo() {
    const prev = this.history.pop();
    if (!prev) return;
    this.app.replaceAtlas(JSON.parse(prev));
    this.markDirty();
    await this.app.rebuild();
    toast("Undone");
  }

  markDirty() {
    this.dirty = true;
    if (!this.server) try { localStorage.setItem(DRAFT, this.app.state.atlas.text()); } catch { /* storage full or blocked */ }
    this.renderBar();
  }

  // ----- open a form -----
  openSphere(id) {
    const atlas = this.app.state.atlas, isNew = !id;
    const obj = isNew
      ? { charted: true, map: { pos: [0, 0, 0], size: 1 }, boundary: { "2e": "shell", "5e": "haze" }, editions: ["2e", "5e"], _primary: "star", _primaryName: "The Sun" }
      : structuredClone(atlas.sphere(id));
    this.form({
      title: isNew ? "New sphere" : `Edit ${obj.name}`, spec: () => sphereSpec(isNew), obj,
      onApply: (o) => {
        if (isNew) {
          o.id = uniqueId(o.name, atlas.takenSphereIds());
          o.bodies = [];
          if (o._primary !== "none") o.bodies.push({ id: uniqueId(o._primaryName || (o._primary === "star" ? "The Sun" : o.name), new Set()), name: o._primaryName || (o._primary === "star" ? "The Sun" : o.name), kind: o._primary, parent: null, size_class: o._primary === "star" ? "H" : "E", look: { color: o._primary === "star" ? "#fff3e0" : "#6fb3ff" } });
          delete o._primary; delete o._primaryName;
          atlas.addSphere(o);
        } else Object.assign(atlas.sphere(id), o);
        return { type: "sphere", id: o.id };
      },
      onDelete: isNew ? null : async () => {
        const n = atlas.sphere(id).bodies.length, f = atlas.data.flows.filter((x) => x.from === id || x.to === id).length;
        if (!(await confirmDialog(`Delete ${obj.name}?`, `This removes the sphere, its ${n} bodies and ${f} currents. You can undo it until you leave the page.`))) return false;
        atlas.removeSphere(id);
        return true;
      },
    });
  }

  openFlow(id) {
    const atlas = this.app.state.atlas, isNew = !id;
    const ids = atlas.data.spheres.map((s) => s.id);
    const sel = this.app.state.selected;
    const obj = isNew ? { from: sel?.type === "sphere" ? sel.id : ids[0], to: ids.find((x) => x !== (sel?.type === "sphere" ? sel.id : ids[0])), direction: "one-way", editions: ["2e"] } : structuredClone(atlas.flow(id));
    this.form({
      title: isNew ? "New current" : "Edit current", spec: () => flowSpec(this.app), obj,
      onApply: (o) => {
        if (isNew) { o.id = uniqueId(`${o.from}-${o.to}`, atlas.takenFlowIds()); atlas.addFlow(o); }
        else Object.assign(atlas.flow(id), o);
        return { type: "flow", id: o.id };
      },
      onDelete: isNew ? null : async () => {
        if (!(await confirmDialog("Delete this current?", "You can undo it until you leave the page."))) return false;
        atlas.removeFlow(id);
        return true;
      },
    });
  }

  openBody(sphereId, id, preset = {}) {
    const atlas = this.app.state.atlas, isNew = !id;
    let obj;
    if (isNew) {
      const primary = sphereId ? atlas.sphere(sphereId).bodies.find((b) => !b.parent) : null;
      const sel = this.app.state.selected;
      const parent = sphereId ? (sel?.type === "body" && sel.sphere === sphereId ? sel.id : primary?.id) || "" : undefined;
      obj = sphereId
        ? { kind: "planet", parent, element: "earth", orbit: { radius_mi: 250000000, period_days: 400, phase_deg: 0 }, look: { color: "#8fc4ff" }, editions: ["2e", "5e"], ...preset }
        : { kind: "island", map: { pos: [0, 0, 0] }, look: { color: "#c8d0e0" }, editions: ["2e", "5e"], ...preset };
    } else obj = structuredClone(atlas.body(sphereId, id));
    obj._place = obj.fixed ? "fixed" : "orbit";
    this.form({
      title: isNew ? (sphereId ? `New body in ${atlas.sphere(sphereId).name}` : "New body between the spheres") : `Edit ${obj.name}`,
      spec: (o) => bodySpec(this.app, sphereId, o), obj,
      onApply: (o) => {
        if (o.parent === "") o.parent = null;
        if (sphereId && o.parent && !["ring", "asteroid-field"].includes(o.kind)) {
          if (o._place === "fixed") delete o.orbit; else delete o.fixed;
        }
        if (o.kind === "ring" || (o.kind === "asteroid-field" && o.field?.follows)) { delete o.orbit; delete o.fixed; }
        if (!o.parent && sphereId) { delete o.orbit; delete o.fixed; }
        delete o._place;
        if (isNew) { o.id = uniqueId(o.name, atlas.takenBodyIds(sphereId)); atlas.addBody(sphereId, o); }
        else {
          const list = sphereId ? atlas.sphere(sphereId).bodies : atlas.data.between.bodies;
          list[list.findIndex((b) => b.id === id)] = { ...o, id };
        }
        return { type: "body", id: o.id || id, sphere: sphereId };
      },
      onDelete: isNew ? null : async () => {
        const kids = sphereId ? atlas.descendants(sphereId, id) : [];
        if (!(await confirmDialog(`Delete ${obj.name}?`, kids.length ? `This also removes what orbits it: ${kids.map((k) => esc(k.name)).join(", ")}.` : "You can undo it until you leave the page."))) return false;
        atlas.removeBody(sphereId, id);
        return true;
      },
    });
  }

  openSettings() {
    const atlas = this.app.state.atlas;
    const c = atlas.data.campaign?.date || { year: 1492, doy: 1 };
    const row = H.yearTable(c.year)[c.doy - 1] || { month: 0, day: 1 };
    const obj = { title: atlas.data.title, _year: c.year, _month: row.festival ? `f:${row.festival}` : String(row.month), _day: row.day || 1, home: atlas.data.campaign?.home || "" };
    this.form({
      title: "Settings",
      spec: () => [
        { type: "section", label: "Page" },
        { key: "title", label: "Title", type: "text" },
        { type: "section", label: "Campaign date" },
        { key: "_year", label: "Year (DR)", type: "number" },
        { key: "_month", label: "Month or festival", type: "select", options: [...H.MONTHS.map((m, i) => [String(i), m]), ...H.festivals(1492).map((f) => [`f:${f}`, f])] },
        { key: "_day", label: "Day of the month", type: "number", help: "Not used for festival days." },
        { key: "home", label: "Home world (sphere/body)", type: "text", help: "The World button flies here when nothing is selected. Example: realmspace/toril" },
      ],
      obj,
      onApply: (o) => {
        const year = Number(o._year) || 1492;
        const doy = String(o._month).startsWith("f:") ? H.doyOf(year, String(o._month).slice(2)) : H.doyOf(year, Number(o._month), Math.min(30, Math.max(1, Number(o._day) || 1)));
        atlas.data.title = o.title || "Wildspace Orrery";
        atlas.data.campaign = { ...(atlas.data.campaign || {}), date: { year, doy }, home: o.home || undefined };
        this.app.state.day = this.app.campaignDay();
        return null;
      },
    });
  }

  // ----- generic form -----
  form({ title, spec, obj, onApply, onDelete }) {
    const app = this.app;
    const work = structuredClone(obj);
    const panel = app.openPanel("edit");
    const draw = () => {
      const fields = spec(work).filter((f) => !f.when || f.when(work));
      panel.innerHTML = `<div class="blk head"><div class="kind"><span class="dot" style="background:#9db4ff"></span>Edit mode</div><h2>${esc(title)}</h2></div>
        <form class="edform" autocomplete="off">${fields.map((f) => fieldHTML(f, work)).join("")}
        <div class="errs"></div>
        <div class="acts formacts"><button type="submit"><i>check</i><span>Apply</span></button><button type="button" class="border" data-cancel><span>Cancel</span></button>${onDelete ? `<button type="button" class="border danger" data-delete><i>delete</i><span>Delete</span></button>` : ""}</div></form>`;
      const form = panel.querySelector("form");
      form.oninput = form.onchange = (e) => {
        readInto(form, work, fields);
        const f = fields.find((x) => x.key === e.target.dataset.k);
        if (f?.rerender && e.type === "change") draw();
      };
      form.onclick = (e) => {
        const add = e.target.closest("[data-addrow]");
        if (add) { readInto(form, work, fields); const k = add.dataset.addrow; const f = fields.find((x) => x.key === k); const cur = rowsValue(get(work, k), f); cur.push(f.obj ? Object.fromEntries(f.obj.map((x) => [x, ""])) : ["", ""]); set(work, k, cur); draw(); return; }
        const rm = e.target.closest("[data-rmrow]");
        if (rm) { readInto(form, work, fields); const [k, i] = rm.dataset.rmrow.split("|"); const cur = rowsValue(get(work, k), fields.find((x) => x.key === k)); cur.splice(Number(i), 1); set(work, k, cur); draw(); return; }
        const place = e.target.closest("[data-place]");
        if (place) {
          readInto(form, work, fields);
          this.placing = (p) => { set(work, place.dataset.place, p.map((v) => Math.round(v * 100) / 100)); draw(); };
          toast("Click on the map to place it.");
        }
      };
      form.querySelector("[data-cancel]").onclick = () => { this.placing = null; app.closeEdit(); };
      const del = form.querySelector("[data-delete]");
      if (del) del.onclick = async () => {
        this.snapshot();
        const ok = await onDelete();
        if (!ok) { this.history.pop(); return; }
        this.markDirty();
        app.state.selected = null;
        await app.rebuild();
        app.closeEdit();
        toast("Deleted. Undo is in the edit bar.");
      };
      form.onsubmit = async (e) => {
        e.preventDefault();
        readInto(form, work, fields);
        const missing = fields.filter((f) => f.required && !get(work, f.key));
        if (missing.length) { form.querySelector(".errs").innerHTML = `<p>Fill in: ${missing.map((f) => esc(f.label)).join(", ")}</p>`; return; }
        const before = JSON.stringify(app.state.atlas.data);
        const out = prune(cleanRows(structuredClone(work), fields));
        const sel = onApply(out);
        const errs = app.state.atlas.validate();
        if (errs.length) {
          app.replaceAtlas(JSON.parse(before));
          form.querySelector(".errs").innerHTML = errs.slice(0, 6).map((x) => `<p>${esc(x.where)}: ${esc(x.msg)}</p>`).join("");
          return;
        }
        this.history.push(before);
        this.placing = null;
        this.markDirty();
        await app.rebuild();
        app.closeEdit();
        if (sel) app.select(sel, { fly: sel.type === "body" && !!sel.sphere });
        toast("Applied. Save to keep it.");
      };
    };
    draw();
  }

  // ----- save, publish, download -----
  async save() {
    const atlas = this.app.state.atlas;
    const errs = atlas.validate();
    if (errs.length) { toast(`Not saved: ${esc(errs[0].where)}: ${esc(errs[0].msg)}`, 6000); return; }
    if (!this.server) {
      try { localStorage.setItem(DRAFT, atlas.text()); } catch { /* ignore */ }
      this.dirty = false;
      this.renderBar();
      toast("Saved in this browser. Use Download to keep a copy.");
      return;
    }
    const r = await fetch("api/atlas", { method: "PUT", headers: { "Content-Type": "application/json" }, body: atlas.text() });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { toast(`Not saved: ${esc(j.error || r.status)}`, 7000); return; }
    this.dirty = false;
    this.renderBar();
    toast("Saved to site/data/atlas.json");
  }

  async publish() {
    if (this.dirty) await this.save();
    if (this.dirty) return;
    if (!(await confirmDialog("Publish to the website?", "This copies the orrery to becomingstronger.github.io and pushes it. DM notes and secret items stay out of the published copy.", "Publish"))) return;
    toast("Publishing…", 20000);
    const r = await fetch("api/publish", { method: "POST" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) { toast(`Publish failed: ${esc(j.error || r.status)}`, 9000); return; }
    toast(`Published. GitHub Pages updates in about a minute: <a href="${esc(j.url)}" target="_blank" rel="noopener">open the page</a>`, 9000);
  }

  download() {
    const blob = new Blob([this.app.state.atlas.text()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "atlas.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
}

// ---------- form fields ----------
function rowsValue(v, f) { return Array.isArray(v) ? v.map((r) => (f?.obj ? { ...r } : [...r])) : []; }

function fieldHTML(f, o) {
  if (f.type === "section") return `<div class="fsec">${esc(f.label)}</div>`;
  const v = get(o, f.key);
  const help = f.help ? `<span class="helper">${esc(f.help)}</span>` : "";
  const k = esc(f.key);
  switch (f.type) {
    case "text": case "list":
      return `<div class="field label border small"><input type="text" data-k="${k}" value="${esc(Array.isArray(v) ? v.join(", ") : v ?? "")}" placeholder=" "><label>${esc(f.label)}</label>${help}</div>`;
    case "number":
      return `<div class="field label border small"><input type="number" step="${f.step || "any"}" data-k="${k}" value="${v ?? ""}" placeholder=" "><label>${esc(f.label)}</label>${help}</div>`;
    case "textarea":
      return `<div class="field textarea label border"><textarea data-k="${k}" placeholder=" ">${esc(v ?? "")}</textarea><label>${esc(f.label)}</label>${help}</div>`;
    case "select": {
      const cur = v ?? "";
      return `<div class="field label suffix border small"><select data-k="${k}">${f.options.map(([val, lab]) => `<option value="${esc(val)}" ${String(val) === String(cur) ? "selected" : ""}>${esc(lab)}</option>`).join("")}</select><label>${esc(f.label)}</label><i>arrow_drop_down</i>${help}</div>`;
    }
    case "texture": {
      const cur = typeof v === "string" ? v : "";
      const tiers = v && typeof v === "object";
      const opts = tiers ? [["__tiers", "Map file in sizes (set in the data file)"], ...TEXTURES] : TEXTURES;
      const known = opts.some(([val]) => val === cur);
      return `<div class="field label suffix border small"><select data-k="${k}" data-texture="1">${opts.map(([val, lab]) => `<option value="${esc(val)}" ${(tiers ? val === "__tiers" : val === cur) ? "selected" : ""}>${esc(lab)}</option>`).join("")}${!known && cur ? `<option value="${esc(cur)}" selected>${esc(cur)}</option>` : ""}</select><label>${esc(f.label)}</label><i>arrow_drop_down</i></div>
        <div class="field label border small"><input type="text" data-k="${k}" data-texture-url="1" value="${esc(tiers ? "" : cur)}" placeholder=" "><label>Or a picture URL (equirectangular)</label></div>`;
    }
    case "color": {
      const cur = /^#[0-9a-f]{6}$/i.test(v || "") ? v : "#9fb0c8";
      return `<label class="colorrow"><input type="color" data-k="${k}" value="${cur}"><span>${esc(f.label)}</span></label>`;
    }
    case "switch":
      return `<label class="lrow"><span><b>${esc(f.label)}</b>${help}</span><span class="switch"><input type="checkbox" data-k="${k}" ${v ? "checked" : ""}><span></span></span></label>`;
    case "editions": {
      const cur = Array.isArray(v) && v.length ? v : EDITIONS;
      return `<div class="edrow"><span>${esc(f.label)}</span>${EDITIONS.map((e) => `<label class="checkbox"><input type="checkbox" data-k="${k}" data-ed-val="${e}" ${cur.includes(e) ? "checked" : ""}><span>${e}</span></label>`).join("")}${help}</div>`;
    }
    case "vec3": {
      const p = Array.isArray(v) ? v : [0, 0, 0];
      return `<div class="vec3"><span>${esc(f.label)}</span>${["x", "y", "z"].map((a, i) => `<div class="field label border small"><input type="number" step="0.05" data-k="${k}" data-i="${i}" value="${p[i] ?? 0}" placeholder=" "><label>${a}</label></div>`).join("")}${f.place ? `<button type="button" class="border small" data-place="${k}"><i>ads_click</i><span>Place on map</span></button>` : ""}</div>`;
    }
    case "rows": {
      const rows = rowsValue(v, f);
      return `<div class="rowsf"><div class="rowsh"><span>${esc(f.label)}</span><button type="button" class="circle transparent small" data-addrow="${k}" title="Add a row"><i>add</i></button></div>
        ${rows.map((r, i) => `<div class="rowf">${f.cols.map((c, j) => `<input type="text" data-k="${k}" data-row="${i}" data-col="${j}" placeholder="${esc(c)}" value="${esc(f.obj ? r[f.obj[j]] ?? "" : r[j] ?? "")}">`).join("")}<button type="button" class="circle transparent small" data-rmrow="${k}|${i}" title="Remove"><i>close</i></button></div>`).join("")}</div>`;
    }
  }
  return "";
}

// Read every input of the form back into the working object.
function readInto(form, o, fields) {
  for (const f of fields) {
    if (f.type === "section") continue;
    const els = [...form.querySelectorAll(`[data-k="${CSS.escape(f.key)}"]`)];
    if (!els.length) continue;
    if (f.type === "number") { const s = els[0].value.trim(); set(o, f.key, s === "" ? "" : Number(s)); }
    else if (f.type === "switch") set(o, f.key, els[0].checked ? true : "");
    else if (f.type === "list") set(o, f.key, els[0].value.split(",").map((x) => x.trim()).filter(Boolean));
    else if (f.type === "editions") set(o, f.key, els.filter((e) => e.checked).map((e) => e.dataset.edVal));
    else if (f.type === "vec3") set(o, f.key, [0, 1, 2].map((i) => Number(els.find((e) => e.dataset.i == i)?.value || 0)));
    else if (f.type === "texture") {
      const sel = els.find((e) => e.dataset.texture), url = els.find((e) => e.dataset.textureUrl);
      if (sel?.value === "__tiers") continue;
      set(o, f.key, url?.value.trim() || sel?.value || "");
    } else if (f.type === "rows") {
      const n = Math.max(-1, ...els.map((e) => Number(e.dataset.row))) + 1;
      const rows = Array.from({ length: n }, (_, i) => f.cols.map((_, j) => els.find((e) => e.dataset.row == i && e.dataset.col == j)?.value ?? ""));
      set(o, f.key, rows.map((r) => (f.obj ? Object.fromEntries(f.obj.map((key, j) => [key, r[j]])) : r)));
    } else set(o, f.key, els[0].value);
  }
}

// Drop empty rows and turn numeric-looking select values back into what the data expects.
function cleanRows(o, fields) {
  for (const f of fields) {
    if (f.type !== "rows") continue;
    const v = get(o, f.key);
    if (!Array.isArray(v)) continue;
    set(o, f.key, v.filter((r) => (f.obj ? Object.values(r).some((x) => String(x).trim()) : r.some((x) => String(x).trim()))));
  }
  return o;
}
