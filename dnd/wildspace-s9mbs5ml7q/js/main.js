// Wildspace Orrery: boot, state, camera, routing and the frame loop. The views draw the scene,
// ui.js draws the HTML, editor.js changes the atlas.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Atlas, KINDS } from "./atlas.js";
import { SphereView } from "./sphere-view.js";
import { BetweenView } from "./between-view.js";
import { Labels, infoHTML, bodiesHTML, layersHTML, renderTime, RATES, toast, esc, miles } from "./ui.js";
import { Editor } from "./editor.js";
import * as H from "./harptos.js";

const $ = (s) => document.querySelector(s);
const phone = () => innerWidth < 760;

class App {
  async init() {
    this.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: $("#c"), antialias: true, preserveDrawingBuffer: !!window.__capture });
    } catch (e) {
      return this.fail("This browser cannot draw the 3D map, because WebGL is off or not supported.", true);
    }
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.autoClear = false;
    this.camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.01, 6000);
    this.controls = new OrbitControls(this.camera, $("#c"));
    Object.assign(this.controls, { enableDamping: !this.reducedMotion, dampingFactor: 0.08, rotateSpeed: 0.55, zoomSpeed: 0.9, minDistance: 0.08 });
    this.controls.addEventListener("start", () => { if (this.fly) this.fly = null; });
    this.labels = new Labels($("#labels"));
    this.editor = new Editor(this);
    this.clock = new THREE.Clock();
    this.t = 0;

    let atlas;
    try { atlas = await Atlas.load("data/atlas.json"); }
    catch (e) { return this.fail(`The map data did not load (${esc(e.message)}).`); }
    this.state = {
      atlas, edition: "2e", view: "between", sphereId: null, selected: null, day: 0, rate: 1, playing: !this.reducedMotion,
      scale: "schematic", layers: { orbits: true, labels: true, minor: true, boundary: true, stars: true }, edit: false, panel: null,
    };
    this.state.day = this.campaignDay();
    await this.editor.detect();
    if (this.editor.allowed) {
      document.body.classList.add("can-edit");
      const draft = !this.editor.server && this.editor.draft();
      if (draft) { try { this.replaceAtlas(JSON.parse(draft)); toast("Loaded the draft saved in this browser."); } catch { /* bad draft: ignore */ } }
    }
    this.bind();
    addEventListener("resize", () => this.resize());
    addEventListener("hashchange", () => { if (!this.writingHash) this.route(); });
    await this.route(true);
    $("#loading").classList.remove("on");
    this.loop();
  }

  fail(msg, noGL = false) {
    $("#loading")?.classList.remove("on");
    const c = $("#errorcard");
    c.querySelector("p").innerHTML = msg;
    c.classList.add("on");
    if (noGL) document.body.classList.add("nogl");
  }

  campaignDay() {
    const d = this.state?.atlas?.data?.campaign?.date || { year: H.EPOCH_YEAR, doy: 1 };
    return H.dayFromYearDoy(d.year, d.doy);
  }

  replaceAtlas(data) { this.state.atlas = new Atlas(data); }

  // ---------- routing: #/  #/sphere  #/sphere/body  #/@flow/id  #/@body/id  (?e=5e&d=day) ----------
  parseHash() {
    const [path, q] = location.hash.replace(/^#\/?/, "").split("?");
    const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
    const params = new URLSearchParams(q || "");
    return { parts, params };
  }

  async route(first = false) {
    const { parts, params } = this.parseHash();
    const st = this.state;
    if (params.get("e") && ["2e", "5e"].includes(params.get("e")) && params.get("e") !== st.edition) { st.edition = params.get("e"); this.viewDirty = true; }
    if (params.get("d") && !isNaN(Number(params.get("d")))) st.day = Number(params.get("d"));
    if (!parts.length && first && st.atlas.data.campaign?.start === "home") parts.push(...st.atlas.data.campaign.home.split("/"));
    if (parts[0] === "@flow") { await this.showBetween(); this.select({ type: "flow", id: parts[1] }, { fly: !first, noHash: true }); }
    else if (parts[0] === "@body") { await this.showBetween(); this.select({ type: "body", id: parts[1] }, { fly: !first, noHash: true }); }
    else if (parts[0] && st.atlas.sphere(parts[0])) {
      await this.showSphere(parts[0]);
      if (parts[1]) this.select({ type: "body", id: parts[1], sphere: parts[0] }, { fly: true, instant: first, noHash: true });
      else { st.selected = null; this.renderPanel(); }
    } else await this.showBetween();
    this.renderChrome();
  }

  writeHash() {
    const st = this.state, sel = st.selected;
    let path = "#/";
    if (st.view === "sphere") path += encodeURIComponent(st.sphereId) + (sel?.type === "body" ? `/${encodeURIComponent(sel.id)}` : "");
    else if (sel?.type === "flow") path += `@flow/${encodeURIComponent(sel.id)}`;
    else if (sel?.type === "body") path += `@body/${encodeURIComponent(sel.id)}`;
    const q = new URLSearchParams();
    if (st.edition !== "2e") q.set("e", st.edition);
    const h = path + (q.toString() ? `?${q}` : "");
    if (location.hash !== h) { this.writingHash = true; history.replaceState(null, "", h + ""); this.writingHash = false; }
  }

  shareURL() {
    const q = new URLSearchParams(this.parseHash().params);
    q.set("d", String(Math.round(this.state.day)));
    if (this.state.edition !== "2e") q.set("e", this.state.edition);
    return location.href.split("#")[0] + location.hash.split("?")[0] + "?" + q.toString();
  }

  // ---------- views ----------
  async showSphere(id) {
    const st = this.state;
    if (st.view === "sphere" && st.sphereId === id && this.view && !this.viewDirty) return;
    $("#loading").classList.add("on");
    st.view = "sphere"; st.sphereId = id;
    if (!this.sphereView) this.sphereView = new SphereView(this);
    this.view = this.sphereView;
    await this.view.build(id);
    this.viewDirty = false;
    this.labels.clear();
    this.frame(true);
    $("#loading").classList.remove("on");
    this.renderChrome();
  }

  async showBetween() {
    const st = this.state;
    if (st.view === "between" && this.view && !this.viewDirty) return;
    $("#loading").classList.add("on");
    st.view = "between"; st.sphereId = null; st.selected = null;
    if (!this.betweenView) this.betweenView = new BetweenView(this);
    this.view = this.betweenView;
    await this.view.build();
    this.viewDirty = false;
    this.labels.clear();
    this.frame(true);
    $("#loading").classList.remove("on");
    this.renderChrome();
  }

  async rebuild() {
    const st = this.state;
    this.viewDirty = true;
    if (st.view === "sphere" && st.atlas.sphere(st.sphereId)) await this.showSphere(st.sphereId);
    else await this.showBetween();
    this.keepCamera = false;
    this.renderChrome();
    this.renderPanel();
  }

  frame(instant = false) {
    const st = this.state;
    this.track = null;
    if (st.view === "sphere") {
      const d = this.view.frameDistance();
      this.controls.maxDistance = this.view.R * 2.6;
      this.flyTo(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, d * Math.sin(0.36), d * Math.cos(0.36)), instant);
    } else {
      const c = new THREE.Vector3();
      const its = this.view.items.filter((i) => i.type === "sphere");
      its.forEach((i) => c.add(i.world));
      if (its.length) c.divideScalar(its.length);
      const d = this.view.frameDistance();
      this.controls.maxDistance = d * 4;
      this.flyTo(c, c.clone().add(new THREE.Vector3(0, d * 0.05, d)), instant);
    }
  }

  flyTo(target, pos, instant = false, trackId = null) {
    this.camera.updateMatrixWorld();
    if (instant || this.reducedMotion) {
      this.controls.target.copy(target);
      this.camera.position.copy(pos);
      this.controls.update();
      this.fly = null;
      this.track = trackId;
      return;
    }
    this.fly = { t0: performance.now(), dur: 1100, fromT: this.controls.target.clone(), fromP: this.camera.position.clone(), toT: target.clone(), toP: pos.clone(), trackId };
    this.track = null;
  }

  // Fly to a body inside the sphere and keep it centered while it moves.
  focusBody(id, instant = false) {
    const w = this.view.bodyWorld(id);
    if (!w) return;
    const b = this.view.nodes.get(id)?.b;
    const r = this.view.bodyRadius(id);
    const portrait = Math.max(1, (innerHeight / innerWidth) * 0.95);
    const dist = (b?.kind === "star" ? r * 16 : b?.kind === "nebula" ? 6 : b?.kind === "asteroid-field" ? 3 : Math.max(r * 6.5, 0.6)) * portrait;
    const cur = this.camera.position.clone().sub(this.controls.target).normalize();
    const sun = w.clone().negate().normalize();
    const dir = w.lengthSq() > 1e-6 && b?.kind !== "star" ? sun.multiplyScalar(0.8).add(cur.multiplyScalar(0.35)).normalize() : cur;
    dir.y = Math.max(dir.y, 0.22);
    dir.normalize();
    this.view.facePin?.(id, dir);
    this.flyTo(w, w.clone().addScaledVector(dir, dist), instant, id);
    if (b?.look?.texture && typeof b.look.texture === "object") this.view.sharpen(id);
  }

  // ---------- selection ----------
  select(sel, opts = {}) {
    const st = this.state;
    st.selected = sel;
    if (sel && st.view === "sphere" && sel.type === "body") { sel.sphere = st.sphereId; if (opts.fly !== false) this.focusBody(sel.id, opts.instant); }
    if (sel && st.view === "between" && opts.fly !== false) {
      const it = this.view.items.find((i) => i.type === sel.type && i.id === sel.id);
      if (it) {
        const dir = this.camera.position.clone().sub(this.controls.target).normalize();
        this.flyTo(it.world, it.world.clone().addScaledVector(dir, Math.max(it.r * 7, 4)), opts.instant);
      }
    }
    if (sel) this.openPanel("info");
    this.renderPanel();
    if (!opts.noHash) this.writeHash();
    this.renderChrome();
  }

  async enterSphere(id) { location.hash = `#/${encodeURIComponent(id)}`; }

  // ---------- panel ----------
  openPanel(tab) {
    this.state.panel = tab;
    document.body.classList.add("panel-open");
    this.layoutCamera();
    this.renderPanel();
    return $("#panelbody");
  }
  closePanel() {
    this.state.panel = null;
    document.body.classList.remove("panel-open");
    this.layoutCamera();
    this.renderChrome();
  }
  closeEdit() { this.state.panel = "info"; this.renderPanel(); }

  renderPanel() {
    const st = this.state, body = $("#panelbody");
    for (const t of document.querySelectorAll("#ptabs a[data-tab]")) t.classList.toggle("on", t.dataset.tab === st.panel);
    if (!st.panel) return;
    if (st.panel === "edit") return;
    body.innerHTML = st.panel === "bodies" ? bodiesHTML(this) : st.panel === "layers" ? layersHTML(this) : infoHTML(this, st.selected);
  }

  // ---------- chrome: crumbs, hero, tiles, readout, edit bar ----------
  renderChrome() {
    const st = this.state, a = st.atlas, ed = st.edition;
    const betweenName = a.data.between?.name?.[ed] || "Between the spheres";
    const crumbs = [`<a data-act="go-between">${esc(betweenName)}</a>`];
    if (st.view === "sphere") {
      const s = a.sphere(st.sphereId);
      crumbs.push(`<a data-act="frame" class="${st.selected ? "" : "cur"}">${esc(s?.name)}</a>`);
      if (st.selected?.type === "body") crumbs.push(`<span class="cur">${esc(a.body(st.sphereId, st.selected.id)?.name)}</span>`);
    } else if (st.selected) {
      const name = st.selected.type === "sphere" ? a.sphere(st.selected.id)?.name : st.selected.type === "flow" ? "Current" : a.body(null, st.selected.id)?.name;
      crumbs.push(`<span class="cur">${esc(name)}</span>`);
    } else crumbs[0] = `<span class="cur">${esc(betweenName)}</span>`;
    $("#crumbs").innerHTML = crumbs.map((c) => `<i>chevron_right</i>${c}`).join("");
    $("#brand").textContent = a.data.title || "Wildspace Orrery";
    document.title = `${a.data.title || "Wildspace Orrery"}`;

    for (const s of document.querySelectorAll("[data-edition]")) s.classList.toggle("on", s.dataset.edition === ed);
    for (const t of document.querySelectorAll("#tiles a")) {
      const v = t.dataset.v;
      t.classList.toggle("on", v === "world" ? st.view === "sphere" && st.selected?.type === "body" : v === "sphere" ? st.view === "sphere" && st.selected?.type !== "body" : st.view === "between");
    }
    $("#tiles a[data-v=between] span").textContent = ed === "5e" ? "Astral Sea" : "Phlogiston";

    const hero = $("#hero");
    if (st.view === "sphere") {
      const s = a.spheres(ed, st.edit).find((x) => x.id === st.sphereId);
      const n = a.bodies(st.sphereId, ed, st.edit).filter((b) => b.kind === "planet").length;
      hero.querySelector("h1").textContent = s?.name || "";
      hero.querySelector("p").textContent = [ed === "5e" ? "A wildspace system" : "A crystal sphere", n ? `${n} world${n === 1 ? "" : "s"}` : "", s?.shell_radius_mi && ed === "2e" ? `radius ${miles(s.shell_radius_mi)}` : ""].filter(Boolean).join(" · ");
    } else {
      const sp = a.spheres(ed, st.edit), charted = sp.filter((s) => s.charted).length;
      hero.querySelector("h1").textContent = betweenName;
      hero.querySelector("p").textContent = `${sp.length} sphere${sp.length === 1 ? "" : "s"} · ${charted} charted`;
    }
    const empty = st.view === "sphere" && !a.bodies(st.sphereId, ed, st.edit).length;
    const card = $("#emptycard");
    card.classList.toggle("on", empty);
    if (empty) card.querySelector("p").textContent = st.edit ? "Nothing is charted here yet. Use Body in the edit bar to add the first star or world." : "This sphere is not charted yet.";
    document.body.classList.toggle("view-sphere", st.view === "sphere");
    document.body.classList.toggle("view-between", st.view === "between");
    document.body.classList.toggle("editing", st.edit);
    if (st.edit) this.editor.renderBar();
    renderTime(this);
  }

  // ---------- events ----------
  bind() {
    const st = this.state;
    document.addEventListener("click", async (e) => {
      const el = e.target.closest("[data-act]");
      if (!el) return;
      const [act, arg] = el.dataset.act.split(/:(.*)/s);
      if (act === "go-between") { location.hash = "#/"; }
      else if (act === "frame") { st.selected = null; this.writeHash(); this.frame(); this.renderPanel(); this.renderChrome(); }
      else if (act === "select") this.select(st.view === "sphere" ? { type: "body", id: arg, sphere: st.sphereId } : { type: "body", id: arg });
      else if (act === "select-sphere") this.select({ type: "sphere", id: arg });
      else if (act === "select-flow") this.select({ type: "flow", id: arg });
      else if (act === "enter") this.enterSphere(st.selected?.id);
      else if (act === "fly" && st.selected) this.focusBody(st.selected.id);
      else if (act === "link") location.href = arg;
      else if (act === "edit") this.editSelected();
      else if (act === "scale") { st.scale = arg; this.viewDirty = true; await this.rebuild(); }
      else if (act === "edition") this.setEdition(arg);
    });
    document.addEventListener("change", (e) => {
      const k = e.target.dataset?.layer;
      if (k) { st.layers[k] = e.target.checked; this.applyLayers(); }
    });
    for (const s of document.querySelectorAll("[data-edition]")) s.onclick = () => this.setEdition(s.dataset.edition);
    $("#ptabs").onclick = (e) => {
      const t = e.target.closest("a");
      if (!t) return;
      if (t.dataset.tab) this.openPanel(t.dataset.tab);
      if (t.dataset.close !== undefined) this.closePanel();
    };
    $("#tiles").onclick = (e) => {
      const t = e.target.closest("a[data-v]");
      if (!t) return;
      const v = t.dataset.v;
      if (v === "between") location.hash = "#/";
      else if (v === "sphere") {
        const id = st.view === "sphere" ? st.sphereId : (st.selected?.type === "sphere" ? st.selected.id : (st.atlas.data.campaign?.home || "realmspace").split("/")[0]);
        if (st.view === "sphere" && st.sphereId === id) { st.selected = null; this.writeHash(); this.frame(); this.renderPanel(); this.renderChrome(); }
        else location.hash = `#/${encodeURIComponent(id)}`;
      } else {
        const home = (st.atlas.data.campaign?.home || "realmspace/toril").split("/");
        if (st.view === "sphere" && st.selected?.type === "body") this.focusBody(st.selected.id);
        else location.hash = `#/${home.map(encodeURIComponent).join("/")}`;
      }
    };
    $("#rail").onclick = (e) => {
      const b = e.target.closest("a[data-r]");
      if (!b) return;
      const r = b.dataset.r;
      if (r === "info") st.panel === "info" ? this.closePanel() : this.openPanel("info");
      else if (r === "layers") st.panel === "layers" ? this.closePanel() : this.openPanel("layers");
      else if (r === "in" || r === "out") this.zoom(r === "in" ? 0.7 : 1.45);
      else if (r === "scale") { st.scale = st.scale === "schematic" ? "true" : "schematic"; toast(st.scale === "true" ? "True distances" : "Schematic scale"); this.viewDirty = true; this.rebuild(); }
      else if (r === "full") document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
    };
    // time
    $("#timearc").onclick = (e) => {
      const b = e.target.closest("[data-t]");
      if (!b) return;
      const t = b.dataset.t;
      let i = RATES.indexOf(st.rate);
      if (t === "play") st.playing = !st.playing;
      else if (t === "slower") { st.playing = true; st.rate = RATES[Math.max(0, i - 1)]; }
      else if (t === "faster") { st.playing = true; st.rate = RATES[Math.min(RATES.length - 1, i + 1)]; }
      else if (t === "campaign") { st.day = this.campaignDay(); st.playing = false; }
      renderTime(this);
    };
    $("#pdate").onclick = () => { st.playing = !st.playing; renderTime(this); };
    // top bar
    $("#sharebtn").onclick = async () => {
      const url = this.shareURL();
      try { await navigator.clipboard.writeText(url); toast("Link copied, with this date and edition."); } catch { prompt("Copy this link", url); }
    };
    $("#editbtn").onclick = () => this.setEdit(!st.edit);
    this.bindSearch();
    // canvas clicks (not drags)
    const cv = $("#c");
    let down = null;
    cv.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    cv.addEventListener("pointerup", (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) { down = null; return; }
      down = null;
      this.click(e.clientX, e.clientY);
    });
    cv.addEventListener("dblclick", (e) => {
      const it = this.labels.hit(e.clientX, e.clientY);
      if (st.view === "between" && it?.key && st.atlas.sphere(it.key)) this.enterSphere(it.key);
    });
    addEventListener("keydown", (e) => {
      if (e.target.closest("input, textarea, select")) return;
      if (e.key === " ") { e.preventDefault(); st.playing = !st.playing; renderTime(this); }
      else if (e.key === "Escape") { if (st.panel) this.closePanel(); else if (st.selected) { st.selected = null; this.writeHash(); this.renderChrome(); } }
      else if (e.key === "/") { e.preventDefault(); $("#search input").focus(); }
    });
  }

  click(x, y) {
    const st = this.state;
    if (this.editor.placing) {
      const p = this.pointOnMap(x, y);
      const fn = this.editor.placing;
      this.editor.placing = null;
      fn(p);
      return;
    }
    const it = this.labels.hit(x, y);
    if (st.view === "sphere") {
      if (it && !it.pin) this.select({ type: "body", id: it.key, sphere: st.sphereId });
      return;
    }
    if (it) {
      if (st.atlas.sphere(it.key)) this.select({ type: "sphere", id: it.key });
      else this.select({ type: "body", id: it.key });
      return;
    }
    const project = (p) => { const v = p.clone().project(this.camera); return v.z > 1 ? null : [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; };
    const f = this.view.pickFlow(x, y, project);
    if (f) this.select({ type: "flow", id: f });
  }

  // A point on the map plane under the pointer (for Place on map): the plane through the
  // camera target, facing the camera.
  pointOnMap(x, y) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1), this.camera);
    const n = this.camera.position.clone().sub(this.controls.target).normalize();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, this.controls.target);
    const p = new THREE.Vector3();
    return ray.ray.intersectPlane(plane, p) ? p.toArray() : this.controls.target.toArray();
  }

  zoom(k) {
    const off = this.camera.position.clone().sub(this.controls.target).multiplyScalar(k);
    const d = THREE.MathUtils.clamp(off.length(), this.controls.minDistance, this.controls.maxDistance);
    this.flyTo(this.controls.target.clone(), this.controls.target.clone().add(off.setLength(d)), false, this.track);
  }

  async setEdition(e) {
    if (e === this.state.edition) return;
    this.state.edition = e;
    this.viewDirty = true;
    const sel = this.state.selected;
    await this.rebuild();
    if (sel) this.select(sel, { fly: false });
    this.writeHash();
    toast(e === "5e" ? "5e: wildspace systems in the Astral Sea" : "2e: crystal spheres in the phlogiston");
  }

  async setEdit(on) {
    const st = this.state;
    if (on && phone()) { toast("Edit on a computer: the forms need a wide screen."); return; }
    st.edit = on;
    document.body.classList.toggle("editing", on);
    this.viewDirty = true;
    await this.rebuild();
    if (on) { this.editor.renderBar(); toast(this.editor.server ? "Edit mode. Save writes data/atlas.json." : "Edit mode (browser draft). Download to keep your changes."); }
  }

  editSelected() {
    const sel = this.state.selected;
    if (!sel) return;
    if (sel.type === "sphere") this.editor.openSphere(sel.id);
    else if (sel.type === "flow") this.editor.openFlow(sel.id);
    else this.editor.openBody(this.state.view === "sphere" ? this.state.sphereId : null, sel.id);
  }

  bindSearch() {
    const box = $("#search"), input = box.querySelector("input"), list = box.querySelector(".results");
    const all = () => {
      const st = this.state, out = [];
      for (const s of st.atlas.spheres(st.edition, st.edit)) {
        out.push({ name: s.name, sub: st.edition === "5e" ? "Wildspace system" : "Crystal sphere", go: () => this.goSphere(s.id) });
        for (const b of st.atlas.bodies(s.id, st.edition, st.edit)) out.push({ name: b.name, sub: `${KINDS[b.kind]?.label || b.kind} · ${s.name}`, go: () => this.goBody(s.id, b.id) });
      }
      for (const b of st.atlas.betweenBodies(st.edition, st.edit)) out.push({ name: b.name, sub: "Between the spheres", go: async () => { location.hash = `#/@body/${encodeURIComponent(b.id)}`; } });
      return out;
    };
    const show = () => {
      const q = input.value.trim().toLowerCase();
      if (!q) { list.innerHTML = ""; box.classList.remove("open"); return; }
      this.searchHits = all().filter((x) => x.name.toLowerCase().includes(q)).slice(0, 8);
      list.innerHTML = this.searchHits.map((h, i) => `<a data-i="${i}"><b>${esc(h.name)}</b><small>${esc(h.sub)}</small></a>`).join("") || `<p>No match</p>`;
      box.classList.add("open");
    };
    input.oninput = show;
    input.onkeydown = (e) => { if (e.key === "Enter" && this.searchHits?.[0]) { this.searchHits[0].go(); input.value = ""; show(); input.blur(); } if (e.key === "Escape") { input.value = ""; show(); input.blur(); } };
    list.onclick = (e) => { const a = e.target.closest("a[data-i]"); if (a) { this.searchHits[Number(a.dataset.i)].go(); input.value = ""; show(); } };
    box.querySelector(".sicon").onclick = () => { box.classList.toggle("expanded"); input.focus(); };
  }
  goSphere(id) { location.hash = `#/${encodeURIComponent(id)}`; }
  goBody(sid, bid) { location.hash = `#/${encodeURIComponent(sid)}/${encodeURIComponent(bid)}`; }

  applyLayers() {
    const L = this.state.layers;
    document.body.classList.toggle("no-labels", !L.labels);
    if (this.state.view === "sphere") {
      for (const n of this.view.order) if (n.orbit) n.orbit.holder.visible = L.orbits;
      this.view.scene.traverse((o) => {
        if (o.isPoints && o.parent && !o.parent.parent && o.material?.uniforms?.fade && o.geometry.attributes.position.count > 3000) o.visible = L.stars;
        if (o.isMesh && o.material?.side === THREE.BackSide && o.geometry?.parameters?.radius > 5) o.visible = L.boundary;
        if (o.isMesh && o.material?.uniforms?.base && o.geometry?.parameters?.radius > 5) o.visible = L.boundary;
      });
    }
  }

  layoutCamera() {
    const W = innerWidth, H_ = innerHeight, open = !!this.state?.panel;
    if (open && phone()) this.camera.setViewOffset(W, H_, 0, H_ * 0.22, W, H_);
    else if (open) this.camera.setViewOffset(W, H_, -180, 0, W, H_);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.layoutCamera();
    this.view?.scene.traverse((o) => { if (o.material?.resolution) o.material.resolution.set(innerWidth, innerHeight); });
  }

  // ---------- frame loop ----------
  loop() {
    const tick = () => {
      requestAnimationFrame(tick);
      const dt = Math.min(this.clock.getDelta(), 0.1);
      this.t += dt;
      const st = this.state;
      if (st.playing) st.day += st.rate * dt;
      this.view?.update(st.day, dt, this.t);
      if (this.fly) {
        const f = this.fly, k = Math.min(1, (performance.now() - f.t0) / f.dur), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        let toT = f.toT, toP = f.toP;
        if (f.trackId && st.view === "sphere") { const w = this.view.bodyWorld(f.trackId); if (w) { toP = f.toP.clone().add(w.clone().sub(f.toT)); toT = w; } }
        this.controls.target.lerpVectors(f.fromT, toT, e);
        this.camera.position.lerpVectors(f.fromP, toP, e);
        if (k >= 1) { this.track = f.trackId; this.fly = null; }
      } else if (this.track && st.view === "sphere") {
        const w = this.view.bodyWorld(this.track);
        if (w) { const d = w.clone().sub(this.controls.target); this.camera.position.add(d); this.controls.target.add(d); }
      }
      this.controls.update();
      this.view?.render(this.renderer, this.camera);
      this.labels.update(st.layers.labels ? this.visibleLabels() : [], this.camera);
      if ((this.frameN = (this.frameN || 0) + 1) % 10 === 0) { renderTime(this); this.renderReadout(); }
    };
    tick();
  }

  // Labels, less the ones for far things that sit behind the disk of the focused world.
  visibleLabels() {
    const items = this.view?.labelItems() || [];
    const sel = this.state.selected;
    if (this.state.view !== "sphere" || sel?.type !== "body") return items;
    const w = this.view.bodyWorld(sel.id), r = this.view.bodyRadius(sel.id);
    if (!w) return items;
    const camD = this.camera.position.distanceTo(w);
    if (camD > r * 30) return items;
    const c = w.clone().project(this.camera);
    const edge = w.clone().add(new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).multiplyScalar(r)).project(this.camera);
    const R = Math.hypot((edge.x - c.x) * innerWidth / 2, (edge.y - c.y) * innerHeight / 2) * 1.08;
    return items.filter((it) => {
      if (it.key === sel.id || it.pin) return true;
      const p = it.world.clone().project(this.camera);
      const d = Math.hypot((p.x - c.x) * innerWidth / 2, (p.y - c.y) * innerHeight / 2);
      // dim labels (nebulae, comets, far rocks) start their text at the anchor, so give them more room
      return d > (it.dim ? R * 1.6 : R);
    });
  }

  renderReadout() {
    const el = $("#readout"), st = this.state;
    if (st.view !== "sphere" || !this.view?.R) { el.classList.remove("on"); return; }
    const r = this.camera.position.length();
    const mi = st.scale === "true" ? r * 80e6 : Math.pow(r / 0.345, 1 / 0.55) * 1e6;
    const primary = st.atlas.primary(st.sphereId, st.edition);
    const out = r > this.view.R ? `<span class="out">outside the ${st.edition === "5e" ? "edge of wildspace" : "crystal shell"}</span>` : "";
    el.innerHTML = `<span>You are</span><b>${miles(mi)}</b><span>from ${esc(primary?.name || "the center")}</span>${out}`;
    el.classList.add("on");
  }
}

const app = new App();
window.orrery = app;
app.init();
