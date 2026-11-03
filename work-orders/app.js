/* Work orders editor.
 *
 * Everything that creates or keeps an order goes through the Worker with the
 * access key: numbers, saves (each save is also copied to Google Drive), the
 * orders list, sending for signature, the job timeline (messages, links,
 * files, paper signatures, invoices) and the client's portal link. The page holds no data and no
 * secret in the repo. The key and the contractor details live in this
 * browser's localStorage only.
 */
(function () {
  "use strict";
  const API = "https://work-orders.alex-hedtke.workers.dev";
  const { TERMS, TEMPLATES } = window.WOTemplates;
  const D = window.WODoc;
  const $ = s => document.querySelector(s);
  const LS = {
    get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* full */ } },
    del: k => { try { localStorage.removeItem(k); } catch (_) { /* none */ } },
  };
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const clone = o => JSON.parse(JSON.stringify(o));
  const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

  let key = LS.get("wo-key", "");
  let order = null;
  let dirty = false, saving = false, saveTimer = null, renderTimer = null;
  let health = {}, clients = [], timeline = [], panel = "doc", tlTimer = null;

  // ---------- API ----------
  async function api(method, path, body) {
    const r = await fetch(API + path, {
      method, headers: { Authorization: `Bearer ${key}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) { lock("The key was not accepted."); throw new Error("unauthorized"); }
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    return d;
  }

  async function apiRaw(method, path, blob, type) {
    const r = await fetch(API + path, { method, headers: { Authorization: `Bearer ${key}`, "Content-Type": type || "application/octet-stream" }, body: blob });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) { lock("The key was not accepted."); throw new Error("unauthorized"); }
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    return d;
  }
  // Downloads need the key, so fetch them and hand the browser a blob.
  async function openBlob(path, name) {
    const r = await fetch(API + path, { headers: { Authorization: `Bearer ${key}` } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const type = r.headers.get("Content-Type") || "";
    const url = URL.createObjectURL(await r.blob());
    if (/text\/html/.test(type)) { window.open(url, "_blank", "noopener"); return "html"; }
    const a = document.createElement("a"); a.href = url; a.download = name || "file"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return "file";
  }

  // ---------- lock ----------
  function lock(msg) {
    key = ""; LS.del("wo-key");
    document.body.classList.add("locked");
    $("#lock").style.display = "flex";
    $("#lockErr").textContent = msg || "";
    $("#keyIn").value = ""; $("#keyIn").focus();
  }
  async function unlock(k) {
    key = k;
    try {
      await api("GET", "/orders");
    } catch (e) {
      if (e.message !== "unauthorized") { key = ""; $("#lockErr").textContent = `Cannot reach the server: ${e.message}`; }
      return false;
    }
    LS.set("wo-key", key);
    document.body.classList.remove("locked");
    $("#lock").style.display = "none";
    start();
    return true;
  }
  $("#lockForm").addEventListener("submit", e => { e.preventDefault(); unlock($("#keyIn").value.trim()); });

  // ---------- settings ----------
  const SETTINGS_FIELDS = [
    ["name", "Your name"], ["business", "Business name (optional)"], ["email", "Email"], ["phone", "Phone"],
    ["address", "Mailing address"], ["rate", "Default hourly rate"], ["taxRate", "Sales tax % on parts"], ["methods", "Payment methods"],
  ];
  const settings = () => LS.get("wo-settings", { methods: "cash, check, Zelle, or Venmo" });
  function renderSettings() {
    const s = settings();
    $("#settingsBody").innerHTML = `<p class="hint">Saved on this device only. New orders copy these values.</p>` +
      SETTINGS_FIELDS.map(([k, l]) => `<label class="f"><span>${l}</span><input type="text" data-set="${k}" value="${esc(s[k] || "")}"></label>`).join("");
    $("#settingsBody").querySelectorAll("[data-set]").forEach(i => i.addEventListener("input", () => {
      const cur = settings(); cur[i.dataset.set] = i.value; LS.set("wo-settings", cur);
    }));
  }

  // ---------- new order ----------
  function renderTemplates() {
    $("#tplGrid").innerHTML = Object.entries(TEMPLATES).map(([id, t]) =>
      `<button class="tpl" data-tpl="${id}"><b>${esc(t.label)}</b><span>${esc(t.blurb)}</span></button>`).join("");
    $("#tplGrid").querySelectorAll("[data-tpl]").forEach(b => b.addEventListener("click", () => newOrder(b.dataset.tpl)));
  }
  async function newOrder(tplId) {
    $("#dNew").close();
    if (dirty) await save();
    const s = settings();
    const t = clone(TEMPLATES[tplId].order);
    let number;
    try { number = (await api("POST", "/next")).number; } catch (e) { toast(`No number: ${e.message}`); return; }
    order = {
      ...t, number, type: tplId, stage: "authorization", status: "draft", date: today(), ticket: "",
      contractor: { name: s.name || "", business: s.business || "", email: s.email || "", phone: s.phone || "", address: s.address || "" },
      client: { name: "", org: "", email: "", phone: "", address: "" },
      site: { address: "", access: "", contact: "" },
      schedule: { start: "", end: "" },
      termIds: t.terms, customTerms: "",
      work: { time: [], performed: "", resolution: "", followUp: "", outcome: "", outcomeNote: "", completed: "" },
      signing: {},
    };
    order.billing = { ...order.billing, rate: s.rate || "", taxRate: s.taxRate || "", methods: s.methods || "" };
    order.lines = order.lines.map(l => ({ ...l, rate: l.unit === "hour" && !l.rate ? (s.rate || "") : l.rate }));
    delete order.terms;
    order._baseStatus = "draft";
    LS.set("wo-current", number);
    buildEditor(); markDirty();
  }

  // ---------- orders list ----------
  async function openOrders() {
    $("#ordersBody").innerHTML = `<tr><td colspan="6">Loading…</td></tr>`;
    $("#dOrders").showModal();
    try {
      const { orders } = await api("GET", "/orders");
      $("#ordersBody").innerHTML = orders.length ? orders.map(o => `<tr class="click" data-n="${esc(o.number)}">
        <td class="mono">${esc(o.number)}</td><td>${esc(o.client)}</td><td>${esc(o.title)}</td><td>${esc(o.status)}</td>
        <td class="mono">${o.total != null ? D.money(o.total) : ""}</td>
        <td>${o.drive ? `<a href="${esc(o.drive)}" target="_blank" rel="noopener">Folder</a>` : "Not yet"}</td></tr>`).join("")
        : `<tr><td colspan="6">No orders yet.</td></tr>`;
      $("#ordersBody").querySelectorAll("tr.click").forEach(tr => tr.addEventListener("click", e => {
        if (e.target.closest("a")) return;
        loadOrder(tr.dataset.n); $("#dOrders").close();
      }));
    } catch (e) { $("#ordersBody").innerHTML = `<tr><td colspan="6">${esc(e.message)}</td></tr>`; }
  }
  async function loadOrder(n) {
    if (dirty) await save();
    const local = LS.get(`wo-draft:${n}`, null);
    try {
      const rec = await api("GET", `/orders/${n}`);
      order = rec.order;
      if (local && local.savedAt > (rec.updated || "")) { order = local.order; dirty = true; }
      order.status = rec.status || order.status;
      order._baseStatus = rec.status || order.status;
      order._drive = rec.drive && rec.drive.folder ? `https://drive.google.com/drive/folders/${rec.drive.folder}` : "";
      order._backedUp = rec.backedUp || "";
    } catch (e) {
      if (!local) { toast(e.message); return; }
      order = local.order; dirty = true;
    }
    LS.set("wo-current", n);
    timeline = [];
    buildEditor();
    if (dirty) scheduleSave();
    loadTimeline();
  }

  // ---------- save + backup ----------
  function markDirty() {
    dirty = true;
    if (order) LS.set(`wo-draft:${order.number}`, { order, savedAt: new Date().toISOString() });
    setSync("Unsaved changes");
    scheduleRender(); scheduleSave();
  }
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 2500); }
  function scheduleRender() { clearTimeout(renderTimer); renderTimer = setTimeout(renderPreview, 150); }
  function compiled() {
    const o = clone(order);
    Object.keys(o).filter(k => k[0] === "_").forEach(k => delete o[k]);
    o.terms = (o.termIds || []).filter(id => TERMS[id]).map(id => TERMS[id].text)
      .concat(String(o.customTerms || "").split("\n").map(x => x.trim()).filter(Boolean));
    o.totals = D.totals(o);
    return o;
  }
  async function save() {
    clearTimeout(saveTimer);
    if (!order || !dirty || saving) return;
    saving = true; setSync("Saving…");
    const o = compiled();
    try {
      const r = await api("PUT", `/orders/${order.number}`, { order: o, html: D.renderDoc(o), baseStatus: order._baseStatus });
      dirty = false; LS.del(`wo-draft:${order.number}`);
      if (r.clientId) { if (!clients.some(c => c.id === r.clientId)) refreshClients(); order.clientId = r.clientId; }
      if (r.status && r.status !== order.status) { order.status = r.status; const sel = document.querySelector('[data-p="status"]'); if (sel) sel.value = r.status; renderPreview(); }
      if (r.status) order._baseStatus = r.status;
      if (panel === "tl") loadTimeline();
      if (r.backup && r.backup.ok) {
        order._drive = r.backup.folder; order._backedUp = r.backup.at;
        setSync(`Saved and backed up to Drive ${new Date(r.backup.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`, r.backup.folder);
      } else {
        setSync(`Saved. Drive backup failed: ${(r.backup && r.backup.error) || "unknown"}`, "", true);
      }
    } catch (e) {
      if (e.message !== "unauthorized") setSync(`Not saved (kept on this device): ${e.message}`, "", true);
    } finally { saving = false; if (dirty) scheduleSave(); }
  }
  function setSync(text, link, warn) {
    $("#syncState").innerHTML = esc(text) + (link ? ` · <a href="${esc(link)}" target="_blank" rel="noopener">Drive folder</a>` : "");
    $("#syncState").style.color = warn ? "var(--terra)" : "";
  }
  window.addEventListener("beforeunload", e => { if (dirty) { save(); e.preventDefault(); } });

  // ---------- preview + PDF ----------
  function renderPreview() {
    if (!order) return;
    const o = compiled();
    $("#preview").srcdoc = D.renderDoc(o);
    $("#woId").textContent = order.number;
    $("#statusChip").textContent = order.status;
    $("#statusChip").className = "chip" + (["signed", "authorized", "accepted", "paid"].includes(order.status) ? " ok" : order.status === "sent" ? " warn" : "");
    $("#pTotal").textContent = `${D.STAGE_LABEL[order.stage]} · ${D.money(o.totals.total)}`;
  }
  async function printPdf() {
    if (!order) return;
    const f = $("#preview");
    try {
      if (dirty) { await save(); }
      setSync("Making the PDF…");
      const kind = await openBlob(`/orders/${order.number}/workorder.pdf`, `${order.number} work order.pdf`);
      setSync(kind === "file" ? "PDF downloaded." : "The PDF service is busy, so the printable page opened.");
    } catch (e) {
      const w = f.contentWindow;
      if (w) { w.focus(); w.print(); }
    }
  }

  // ---------- editor ----------
  const get = (path) => path.split(".").reduce((a, k) => (a == null ? a : a[k]), order);
  const set = (path, v) => {
    const ks = path.split("."); let o = order;
    ks.slice(0, -1).forEach(k => { if (o[k] == null) o[k] = {}; o = o[k]; });
    o[ks[ks.length - 1]] = v;
  };
  const field = (path, label, type = "text", attrs = "") => {
    const v = get(path) ?? "";
    if (type === "textarea") return `<label class="f"><span>${label}</span><textarea data-p="${path}" ${attrs}>${esc(v)}</textarea></label>`;
    return `<label class="f"><span>${label}</span><input type="${type}" data-p="${path}" value="${esc(v)}" ${attrs}></label>`;
  };
  const listField = (path, label, hint) => `<label class="f"><span>${label}</span><textarea data-list="${path}" rows="4">${esc((get(path) || []).join("\n"))}</textarea></label>${hint ? `<p class="hint">${hint}</p>` : ""}`;
  const select = (path, label, opts) => `<label class="f"><span>${label}</span><select data-p="${path}">${
    opts.map(([v, l]) => `<option value="${v}"${get(path) === v ? " selected" : ""}>${l}</option>`).join("")}</select></label>`;
  const sec = (title, body, open) => `<details class="sec"${open ? " open" : ""}><summary>${title}</summary><div class="sec-body">${body}</div></details>`;

  function buildEditor() {
    if (!order) {
      $("#editor").innerHTML = `<div style="padding:40px 0"><h2>No order open</h2><p class="hint" style="margin-top:8px">Start a new work order or open one from the list.</p>
        <button class="btn" id="bNew2">New work order</button> <button class="btn ghost" id="bOrders2">Orders</button></div>`;
      $("#bNew2").onclick = () => $("#dNew").showModal();
      $("#bOrders2").onclick = openOrders;
      $("#preview").srcdoc = ""; $("#woId").textContent = "No order"; return;
    }
    const done = order.stage === "completion";
    const html = [
      `<div class="seg" id="stageSeg"><button data-stage="authorization" class="${done ? "" : "on"}">1 · Authorize</button><button data-stage="completion" class="${done ? "on" : ""}">2 · Complete</button></div>
       <p class="hint">${done ? "Record the work done. The client signs to accept it." : "The client signs to authorize the work before it starts."}</p>`,
      sec("Basics", `${field("title", "Title")}
        <div class="row">${select("type", "Work type", Object.entries(D.TYPE_LABEL))}${select("status", "Status", ["draft", "sent", "authorized", "in progress", "completed", "accepted", "paid", "declined", "void"].map(x => [x, x[0].toUpperCase() + x.slice(1)]))}</div>
        <div class="row3">${field("date", "Order date", "date")}${select("priority", "Priority", [["low", "Low"], ["normal", "Normal"], ["high", "High"], ["urgent", "Urgent"]])}${field("ticket", "Ref / PO no.")}</div>`, true),
      sec("Client", `<label class="f"><span>Client record</span><select id="clientPick"><option value="">New client (made when you save)</option>${
          clients.map(c => `<option value="${esc(c.id)}"${order.clientId === c.id ? " selected" : ""}>${esc(c.name || c.email || c.id)}${c.email ? " · " + esc(c.email) : ""}</option>`).join("")}</select></label>
        <p class="hint">One client record holds the portal link for all of that client's orders.</p>
        <div class="row">${field("client.name", "Contact name")}${field("client.org", "Company (optional)")}</div>
        <div class="row">${field("client.email", "Email", "email")}${field("client.phone", "Phone", "tel")}</div>
        ${field("client.address", "Mailing address")}`, true),
      sec("Location and schedule", `${field("site.address", "Service location", "text", 'placeholder="Same as client address"')}
        <div class="row">${field("site.contact", "On-site contact")}${field("site.access", "Access notes", "text", 'placeholder="Gate code, parking, hours"')}</div>
        <div class="row">${field("schedule.start", "Start", "datetime-local")}${field("schedule.end", "Due by", "datetime-local")}</div>`),
      sec(order.type === "breakfix" ? "Problem reported" : "Purpose", field("request", order.type === "breakfix" ? "What the client reports, in their words" : "What this work is for", "textarea"), true),
      sec("Equipment", `<div class="rows" id="assets"></div><button class="btn ghost small" id="addAsset">Add item</button>`),
      sec("Scope", `${listField("scope", "Scope of work", "One item per line.")}${listField("deliverables", "Deliverables")}${listField("exclusions", "Not included")}${listField("clientDuties", "Client responsibilities")}
        ${order.type === "install" || order.plan ? `${field("plan.implementation", "Plan: steps", "textarea")}${field("plan.test", "Plan: how the result is tested", "textarea")}${field("plan.rollback", "Plan: if it fails", "textarea")}` : ""}
        ${order.type === "recurring" || order.termLength ? field("termLength", "Term", "textarea") : ""}`),
      sec(done ? "Charges" : "Estimate and price", `<div class="row3">${select("billing.mode", "Pricing", [["hourly", "Hourly"], ["flat", "Fixed price"]])}${field("billing.rate", "Hourly rate", "number", 'step="0.01" min="0"')}${field("billing.taxRate", "Tax % (taxable lines)", "number", 'step="0.001" min="0"')}</div>
        <div class="rows" id="lines"></div><button class="btn ghost small" id="addLine">Add line</button>
        <div class="tot" id="totBox"></div>
        <div class="row" style="margin-top:12px">${field("billing.deposit", "Deposit", "number", 'step="0.01" min="0"')}${order.billing.mode === "hourly" ? field("billing.cap", "Not-to-exceed (optional)", "number", 'step="0.01" min="0"') : field("billing.paid", "Other payments received", "number", 'step="0.01" min="0"')}</div>
        <div class="row">${field("billing.terms", "Payment due")}${field("billing.methods", "Payment methods")}</div>`),
      done ? sec("Work done", `<div class="rows" id="times"></div><button class="btn ghost small" id="addTime">Add time entry</button>
        <div style="height:12px"></div>
        <div class="row">${select("work.outcome", "Outcome", [["", "Choose"], ["complete", "Complete"], ["incomplete", "Not complete"]])}${field("work.completed", "Completed on", "date")}</div>
        ${field("work.outcomeNote", "If not complete, why")}
        ${field("work.performed", "Work performed", "textarea")}${field("work.resolution", "Result", "textarea")}${field("work.followUp", "Recommendations and follow-up", "textarea")}`, true) : "",
      sec("Terms", `<div class="terms">${Object.entries(TERMS).map(([id, t]) => `<label><input type="checkbox" data-term="${id}"${(order.termIds || []).includes(id) ? " checked" : ""}><span><b>${esc(t.label)}</b><small>${esc(t.text)}</small></span></label>`).join("")}</div>
        <label class="f"><span>Other terms</span><textarea data-p="customTerms" rows="3">${esc(order.customTerms || "")}</textarea></label><p class="hint">One term per line. These are plain-language starting points, not legal advice.</p>`),
      sec("Notes", field("notes", "Notes shown on the document", "textarea")),
      sec("You (contractor)", `<div class="row">${field("contractor.name", "Name")}${field("contractor.business", "Business name")}</div>
        <div class="row">${field("contractor.email", "Email", "email")}${field("contractor.phone", "Phone", "tel")}</div>${field("contractor.address", "Address")}`),
    ];
    const wasOpen = new Set([...document.querySelectorAll("#editor details.sec[open] > summary")].map(x => x.textContent));
    const scroll = $("#editor").scrollTop;
    $("#editor").innerHTML = html.join("");
    if (wasOpen.size) document.querySelectorAll("#editor details.sec").forEach(d => { if (wasOpen.has(d.querySelector("summary").textContent)) d.open = true; });
    $("#editor").scrollTop = scroll;
    bindEditor();
    renderRows(); renderPreview();
    if (order._drive) setSync(`Backed up to Drive ${order._backedUp ? new Date(order._backedUp).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""}`, order._drive);
  }

  function bindEditor() {
    const ed = $("#editor");
    ed.querySelectorAll("[data-p]").forEach(el => el.addEventListener("input", () => {
      set(el.dataset.p, el.value);
      if (["billing.mode", "type"].includes(el.dataset.p)) { buildEditor(); }
      markDirty(); if (el.dataset.p.startsWith("billing")) renderTotals();
    }));
    const pick = $("#clientPick");
    if (pick) pick.addEventListener("change", async () => {
      if (!pick.value) { delete order.clientId; markDirty(); return; }
      try {
        const c = await api("GET", `/clients/${pick.value}`);
        order.clientId = c.id;
        order.client = { name: c.name || "", org: c.org || "", email: c.email || "", phone: c.phone || "", address: c.address || "" };
        buildEditor(); markDirty();
      } catch (e) { toast(e.message); }
    });
    ed.querySelectorAll("[data-list]").forEach(el => el.addEventListener("input", () => {
      set(el.dataset.list, el.value.split("\n")); markDirty();
    }));
    ed.querySelectorAll("[data-term]").forEach(el => el.addEventListener("change", () => {
      const ids = new Set(order.termIds || []);
      el.checked ? ids.add(el.dataset.term) : ids.delete(el.dataset.term);
      order.termIds = Object.keys(TERMS).filter(k => ids.has(k)); markDirty();
    }));
    ed.querySelectorAll("#stageSeg button").forEach(b => b.addEventListener("click", () => {
      order.stage = b.dataset.stage;
      if (order.stage === "completion" && !order.work.completed) order.work.completed = today();
      buildEditor(); markDirty();
    }));
    const add = (id, arr, item) => { const b = $(id); if (b) b.onclick = () => { order[arr] = order[arr] || []; order[arr].push(item()); renderRows(); markDirty(); }; };
    add("#addAsset", "assets", () => ({ desc: "", make: "", model: "", serial: "", tag: "", notes: "" }));
    add("#addLine", "lines", () => ({ desc: "", qty: 1, unit: order.billing.mode === "hourly" ? "hour" : "each", rate: order.billing.mode === "hourly" ? order.billing.rate : "", taxable: false }));
    const at = $("#addTime");
    if (at) at.onclick = () => { order.work.time.push({ date: today(), start: "", end: "", hours: "", note: "" }); renderRows(); markDirty(); };
  }

  function rowsOf(containerId, arr, cls, cells) {
    const box = $(containerId); if (!box) return;
    box.innerHTML = arr.map((it, i) => `<div class="rowitem ${cls}" data-i="${i}">${cells(it, i)}<button class="icon-btn" data-del="${i}" aria-label="Remove">×</button></div>`).join("");
    box.querySelectorAll("[data-k]").forEach(el => {
      const ev = el.type === "checkbox" ? "change" : "input";
      el.addEventListener(ev, () => {
        const i = +el.closest("[data-i]").dataset.i;
        arr[i][el.dataset.k] = el.type === "checkbox" ? el.checked : el.value;
        markDirty(); renderTotals();
        if (cls === "time" && (el.dataset.k === "start" || el.dataset.k === "end")) {
          const h = el.closest("[data-i]").querySelector('[data-k="hours"]');
          if (h && !arr[i].hours) h.placeholder = D.hoursOf({ ...arr[i], hours: "" }).toFixed(2);
        }
      });
    });
    box.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => { arr.splice(+b.dataset.del, 1); renderRows(); markDirty(); }));
  }
  const inp = (k, v, ph, type = "text", extra = "") => `<input type="${type}" data-k="${k}" value="${esc(v)}" placeholder="${esc(ph)}" ${extra}>`;

  function renderRows() {
    order.assets = order.assets || [];
    rowsOf("#assets", order.assets, "asset", a => `<div style="display:grid;gap:6px;grid-column:1/3">
      <div class="row">${inp("desc", a.desc, "Item (laptop, printer, router)")}${inp("tag", a.tag, "Asset tag")}</div>
      <div class="row3">${inp("make", a.make, "Make")}${inp("model", a.model, "Model")}${inp("serial", a.serial, "Serial no.")}</div>
      ${inp("notes", a.notes, "Condition, accessories, password given")}</div>`);
    rowsOf("#lines", order.lines, "line", l => `${inp("desc", l.desc, "Description")}${inp("qty", l.qty, "Qty", "number", 'step="0.25" min="0"')}${inp("unit", l.unit, "Unit")}${inp("rate", l.rate, "Rate", "number", 'step="0.01" min="0"')}
      <div class="sub"><label><input type="checkbox" data-k="taxable"${l.taxable ? " checked" : ""}> Taxable</label><span class="mono">${D.money(D.lineAmount(l))}</span></div>`);
    if (order.work) rowsOf("#times", order.work.time, "time", t => `${inp("date", t.date, "", "date")}${inp("start", t.start, "", "time")}${inp("end", t.end, "", "time")}${inp("hours", t.hours, D.hoursOf({ ...t, hours: "" }).toFixed(2), "number", 'step="0.25" min="0"')}
      <div class="note">${inp("note", t.note, "Work done in this session")}</div>`);
    renderTotals();
  }
  function renderTotals() {
    const box = $("#totBox"); if (!box || !order) return;
    const t = D.totals(compiled());
    box.innerHTML = `<span>Subtotal</span><b>${D.money(t.subtotal)}</b>${t.tax ? `<span>Tax</span><b>${D.money(t.tax)}</b>` : ""}<span>Total</span><b>${D.money(t.total)}</b>${t.deposit || t.paid ? `<span>Balance</span><b>${D.money(t.balance)}</b>` : ""}`;
    document.querySelectorAll("#lines .rowitem").forEach(r => {
      const l = order.lines[+r.dataset.i]; const m = r.querySelector(".sub .mono"); if (l && m) m.textContent = D.money(D.lineAmount(l));
    });
  }

  // ---------- send for signature ----------
  function openSend() {
    if (!order) return;
    const c = order.client || {};
    const stage = order.stage === "completion" ? "acceptance of the completed work" : "authorization to start the work";
    $("#sendBody").innerHTML = `<p>This emails <b>${esc(order.number)}</b> to the client for ${stage}. The client signs first, then you get a copy to countersign. The signed PDF and its audit trail are copied to the order's Drive folder.</p>
      <div class="row"><label class="f"><span>Client name</span><input id="sName" type="text" value="${esc(c.name)}"></label><label class="f"><span>Client email</span><input id="sEmail" type="email" value="${esc(c.email)}"></label></div>
      <label class="f"><span>Your email (countersign)</span><input id="sMe" type="email" value="${esc(order.contractor.email)}"></label>
      <label class="f"><span>Message</span><textarea id="sMsg" rows="4">Hi ${esc((c.name || "").split(" ")[0] || "there")},\n\nHere is work order ${esc(order.number)}${order.title ? ` (${esc(order.title)})` : ""} for your ${order.stage === "completion" ? "sign-off on the completed work" : "approval"}. Please review and sign at the link below.\n\nThanks,\n${esc(order.contractor.name || "")}</textarea></label>
      <label class="f" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="sTest"> <span style="margin:0">Test send (free, watermarked, not legally binding)</span></label>
      <p class="hint" id="sErr"></p>`;
    $("#dSend").showModal();
  }
  async function doSend() {
    const name = $("#sName").value.trim(), email = $("#sEmail").value.trim(), me = $("#sMe").value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { $("#sErr").textContent = "Enter the client's email."; return; }
    order.client.name = order.client.name || name; order.client.email = email;
    if (me) order.contractor.email = me;
    dirty = true; await save();
    $("#bSendGo").disabled = true; $("#sErr").textContent = "Sending…";
    try {
      const o = compiled();
      const r = await api("POST", `/orders/${order.number}/send`, {
        stage: order.stage, html: D.renderDoc(o, { signing: true }),
        client: { name: name || order.client.name, email }, contractor: { name: order.contractor.name, email: me },
        message: $("#sMsg").value, test: $("#sTest").checked,
      });
      if (r.status) { order.status = r.status; order._baseStatus = r.status; }
      renderPreview(); loadTimeline();
      $("#dSend").close(); toast(`${r.test ? "Test sent" : "Sent"} to ${email}.`);
    } catch (e) { $("#sErr").textContent = e.message; }
    finally { $("#bSendGo").disabled = false; }
  }

  // ---------- timeline (right panel) ----------
  const KIND = { status: "Status", message: "Message", note: "Internal note", file: "File", link: "Link", invoice: "Invoice",
    payment: "Payment", signed: "Signed", sent: "Signature request", workorder: "Work order" };
  const fmtWhen = ts => new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const isoDay = ms => new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

  function showPanel(p) {
    panel = p;
    document.querySelectorAll("#panelSeg button").forEach(b => b.classList.toggle("on", b.dataset.panel === p));
    $("#preview").hidden = p !== "doc";
    $("#tl").hidden = p !== "tl";
    if (p === "tl") { loadTimeline(); markSeen(); }
  }
  const seenKey = () => `wo-seen:${order.number}`;
  function markSeen() { if (order) LS.set(seenKey(), Date.now()); renderBadge(); }
  function renderBadge() {
    if (!order) { $("#tlBadge").textContent = ""; return; }
    const seen = LS.get(seenKey(), 0);
    const n = timeline.filter(i => i.actor === "client" && !i.deleted && i.ts > seen).length;
    $("#tlBadge").textContent = n && panel !== "tl" ? String(n) : "";
  }

  async function loadTimeline() {
    if (!order) return;
    const n = order.number;
    try {
      const r = await api("GET", `/orders/${n}/timeline`);
      if (!order || order.number !== n) return;
      timeline = r.items || [];
    } catch (_) { /* keep the last copy */ }
    renderBadge();
    if (panel === "tl") { await renderTimeline(); markSeen(); }
  }

  async function portalBox() {
    if (!order.clientId) return `<div class="tlbox"><h3>Client portal</h3><p class="hint" style="margin:0">Save the order once, then make the client's private link here.</p></div>`;
    let c = null;
    try { c = await api("GET", `/clients/${order.clientId}`); } catch (_) { /* shown as no link */ }
    const url = c && c.portalUrl;
    const notes = [];
    if (order.status === "draft") notes.push("The client sees this order when its status is past Draft.");
    if (url && !(c && c.email)) notes.push("There is no client email on file, so text the link.");
    if (url && c && c.email && !health.gmail) notes.push("Email updates to the client start when Gmail is connected.");
    return `<div class="tlbox"><h3>Client portal${c && (c.org || c.name) ? " · " + esc(c.org || c.name) : ""}</h3>
      ${url ? `<div class="tlrow"><span class="portal-url">${esc(url)}</span><button class="btn ghost small" id="pCopy" data-url="${esc(url)}">Copy</button><a class="btn ghost small" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open</a></div>
        <div class="tlrow" style="margin-top:8px"><button class="btn ghost small" id="pNew">Make a new link</button><span class="hint" style="margin:0">A new link stops the old one.</span></div>`
        : `<div class="tlrow"><button class="btn small" id="pNew">Make the portal link</button></div>`}
      ${notes.map(t => `<p class="hint" style="margin:8px 0 0">${esc(t)}</p>`).join("")}</div>`;
  }

  function invoiceRows() {
    const invs = timeline.filter(i => i.kind === "invoice" && !i.deleted);
    if (!invs.length) return `<p class="hint" style="margin:10px 0 0">No invoices yet.</p>`;
    return `<table class="inv" style="margin-top:10px"><thead><tr><th>No.</th><th>Status</th><th class="n">Total</th><th class="n">Balance</th><th></th></tr></thead><tbody>${invs.map(i => {
      const d = i.data || {}, t = d.totals || {};
      const acts = [`<button class="vis" data-inv-open="${esc(d.number)}">Open</button>`];
      if (!["paid", "void"].includes(d.status)) acts.push(`<button class="vis" data-inv-edit="${esc(d.number)}">Edit</button>`);
      if (d.status === "draft") acts.push(`<button class="vis client" data-inv-send="${esc(d.number)}">Send</button>`);
      if (d.status === "sent") acts.push(`<button class="vis client" data-inv-pay="${esc(d.number)}">Payment</button>`);
      if (!["paid", "void"].includes(d.status)) acts.push(`<button class="vis" data-inv-void="${esc(d.number)}">Cancel</button>`);
      return `<tr><td class="mono">${esc(d.number)}</td><td>${esc(d.status)}${d.due && d.status === "sent" ? ` · due ${esc(d.due)}` : ""}</td><td class="n">${D.money(t.total)}</td><td class="n">${D.money(t.balance)}</td><td style="text-align:right">${acts.join(" ")}</td></tr>`;
    }).join("")}</tbody></table>`;
  }

  async function renderTimeline() {
    if (!order) { $("#tl").innerHTML = ""; return; }
    const n = order.number;
    const portal = await portalBox();
    if (!order || order.number !== n) return;
    const items = timeline.map(i => {
      const d = i.data || {};
      const fixed = ["status", "workorder", "invoice", "sent"].includes(i.kind);
      return `<li class="${i.deleted ? "del" : ""} ${i.actor === "client" ? "client" : ""}">
        <div class="iwhen">${fmtWhen(i.ts)}</div>
        <div><div class="ikind">${esc(KIND[i.kind] || i.kind)}${i.actor === "client" ? " · from client" : ""}</div>
          ${i.kind === "message" ? "" : `<div class="ititle">${esc(i.title)}</div>`}${i.body ? `<div class="ibody">${esc(i.body)}</div>` : ""}
          ${d.url ? `<a href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">${esc(d.type || "Open link")}</a>` : ""}
          ${d.driveId ? `<button class="vis" data-dl="${esc(i.id)}" data-name="${esc(d.name || i.title)}">Download</button>` : ""}</div>
        <div class="iacts">${fixed ? `<span class="vis ${i.visibility}">${i.visibility === "client" ? "Client sees" : "Internal"}</span>`
          : `<button class="vis ${i.visibility}" data-vis="${esc(i.id)}" title="Change who sees this">${i.visibility === "client" ? "Client sees" : "Internal"}</button>`}
          ${["message", "note", "link", "file", "signed", "payment"].includes(i.kind) ? `<button class="vis" data-del="${esc(i.id)}">${i.deleted ? "Restore" : "Remove"}</button>` : ""}</div></li>`;
    }).join("");
    $("#tl").innerHTML = `${portal}
      <div class="tlbox"><h3>Post to the timeline</h3>
        <textarea id="tMsg" rows="3" placeholder="A message to the client, or an internal note"></textarea>
        <div class="tlrow" style="margin-top:8px">
          <label class="check"><input type="radio" name="tKind" value="message" checked> To the client</label>
          <label class="check"><input type="radio" name="tKind" value="note"> Internal note</label>
          <label class="check"><input type="checkbox" id="tNotify" checked> Email the client</label>
          <span class="spacer"></span><button class="btn small" id="tPost">Post</button></div></div>
      <div class="tlbox"><h3>Add a link or a file</h3>
        <div class="tlrow"><input type="text" id="lTitle" placeholder="Title, for example: Hours and progress"><input type="url" id="lUrl" placeholder="https://"></div>
        <div class="tlrow" style="margin-top:8px"><label class="check"><input type="checkbox" id="lVis" checked> Client can see</label><span class="spacer"></span><button class="btn ghost small" id="lAdd">Add link</button></div>
        <div class="tlrow" style="margin-top:10px"><input type="file" id="fIn"><label class="check"><input type="checkbox" id="fVis" checked> Client can see</label><button class="btn ghost small" id="fUp">Upload</button></div>
        <p class="hint" style="margin:8px 0 0">A Google file opens for the client only if it is shared with them in Google.</p></div>
      <div class="tlbox"><h3>Signatures and invoices</h3>
        <div class="tlrow"><button class="btn ghost small" id="bPaper">Signed on paper</button><button class="btn ghost small" id="bInvNew">New invoice</button></div>
        ${invoiceRows()}</div>
      <p class="hint" id="tErr" role="alert"></p>
      <h3 style="margin:16px 0 4px">Timeline</h3>
      ${items ? `<ol class="items">${items}</ol>` : `<p class="hint">Nothing here yet.</p>`}`;
    bindTimeline();
  }

  function tErr(t) { const e = $("#tErr"); if (e) e.textContent = t || ""; }
  async function ensureSaved() { if (dirty) await save(); if (dirty) throw new Error("Save the order first."); }

  function bindTimeline() {
    const n = order.number;
    const on = (sel, fn) => { const el = $(sel); if (el) el.onclick = fn; };
    on("#pCopy", async e => { try { await navigator.clipboard.writeText(e.target.dataset.url); tErr("Link copied."); } catch (_) { tErr("Copy did not work. Select the link and copy it."); } });
    on("#pNew", async e => {
      if (e.target.textContent.includes("new") && !confirm("The old link stops working. Make a new one?")) return;
      try { await ensureSaved(); await api("POST", `/clients/${order.clientId}/portal`); await renderTimeline(); } catch (x) { tErr(x.message); }
    });
    on("#tPost", async () => {
      const body = $("#tMsg").value.trim(); if (!body) return;
      const kind = document.querySelector('input[name="tKind"]:checked').value;
      try { await ensureSaved(); await api("POST", `/orders/${n}/items`, { kind, body, notify: $("#tNotify").checked }); await loadTimeline(); tErr(kind === "note" ? "Note saved." : "Posted. The client sees it in the portal."); }
      catch (x) { tErr(x.message); }
    });
    on("#lAdd", async () => {
      const url = $("#lUrl").value.trim(); if (!url) { tErr("Paste the link first."); return; }
      try { await ensureSaved(); await api("POST", `/orders/${n}/items`, { kind: "link", url, title: $("#lTitle").value.trim(), visibility: $("#lVis").checked ? "client" : "internal" }); await loadTimeline(); tErr("Link added."); }
      catch (x) { tErr(x.message); }
    });
    on("#fUp", async () => {
      const f = $("#fIn").files[0]; if (!f) { tErr("Choose a file first."); return; }
      if (f.size > 25 * 1048576) { tErr("Files can be at most 25 MB."); return; }
      tErr(`Uploading ${f.name}…`);
      try { await ensureSaved(); await apiRaw("POST", `/orders/${n}/files?name=${encodeURIComponent(f.name)}&visibility=${$("#fVis").checked ? "client" : "internal"}`, f, f.type); await loadTimeline(); tErr("File uploaded to the order's Drive folder."); }
      catch (x) { tErr(x.message); }
    });
    on("#bPaper", openPaper);
    on("#bInvNew", () => openInvoice(null));
    const tl = $("#tl");
    tl.querySelectorAll("[data-vis]").forEach(b => b.onclick = async () => {
      const it = timeline.find(i => i.id === b.dataset.vis);
      try { await api("PATCH", `/orders/${n}/items/${it.id}`, { visibility: it.visibility === "client" ? "internal" : "client" }); await loadTimeline(); } catch (x) { tErr(x.message); }
    });
    tl.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
      const it = timeline.find(i => i.id === b.dataset.del);
      try { await api("PATCH", `/orders/${n}/items/${it.id}`, { deleted: !it.deleted }); await loadTimeline(); } catch (x) { tErr(x.message); }
    });
    tl.querySelectorAll("[data-dl]").forEach(b => b.onclick = () => openBlob(`/orders/${n}/items/${b.dataset.dl}/download`, b.dataset.name).catch(x => tErr(x.message)));
    const inv = no => timeline.find(i => i.kind === "invoice" && i.data && i.data.number === no);
    tl.querySelectorAll("[data-inv-open]").forEach(b => b.onclick = () => openBlob(`/orders/${n}/items/${b.dataset.invOpen}/download`, `${b.dataset.invOpen}.pdf`).catch(x => tErr(x.message)));
    tl.querySelectorAll("[data-inv-edit]").forEach(b => b.onclick = () => openInvoice(inv(b.dataset.invEdit)));
    tl.querySelectorAll("[data-inv-pay]").forEach(b => b.onclick = () => openPay(inv(b.dataset.invPay)));
    tl.querySelectorAll("[data-inv-send]").forEach(b => b.onclick = async () => {
      try { await api("POST", `/orders/${n}/invoices/${b.dataset.invSend}/send`, {}); await loadTimeline(); tErr(`Invoice ${b.dataset.invSend} is in the client's portal.`); } catch (x) { tErr(x.message); }
    });
    tl.querySelectorAll("[data-inv-void]").forEach(b => b.onclick = async () => {
      if (!confirm(`Cancel invoice ${b.dataset.invVoid}? It stays on record, marked cancelled.`)) return;
      const d = clone(inv(b.dataset.invVoid).data); d.void = true;
      try { await api("POST", `/orders/${n}/invoices/${d.number}/void`, { html: D.renderInvoice(compiled(), d) }); await loadTimeline(); } catch (x) { tErr(x.message); }
    });
  }

  // ---------- signed on paper ----------
  async function shrinkImage(file) {
    // Re-encoding also removes the photo's location data (EXIF).
    if (!/^image\//.test(file.type) || file.type === "image/gif") return { blob: file, type: file.type || "application/octet-stream" };
    try {
      const url = URL.createObjectURL(file);
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const k = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      const blob = await new Promise(res => c.toBlob(res, "image/jpeg", 0.85));
      return blob ? { blob, type: "image/jpeg" } : { blob: file, type: file.type };
    } catch (_) { return { blob: file, type: file.type || "application/octet-stream" }; }
  }
  function openPaper() {
    $("#paperBody").innerHTML = `<p>Use this when the client signed a printed copy. The photo or scan goes to the order's Drive folder and the timeline, and the order skips the e-signature step. A pending e-signature request for the same stage is cancelled.</p>
      <div class="row"><label class="f"><span>Which signature</span><select id="ppStage"><option value="authorization"${order.stage !== "completion" ? " selected" : ""}>Authorization (before the work)</option><option value="completion"${order.stage === "completion" ? " selected" : ""}>Completion (work accepted)</option></select></label>
        <label class="f"><span>Signed by</span><input id="ppSigner" type="text" value="${esc(order.client && order.client.name || "")}"></label></div>
      <div class="row"><label class="f"><span>Date signed</span><input id="ppDate" type="date" value="${today()}"></label>
        <label class="f"><span>Photo or scan</span><input id="ppFile" type="file" accept="image/*,application/pdf"></label></div>
      <p class="hint">Photos are resized and their location data is removed before upload.</p>
      <img id="ppThumb" class="thumb" alt="Preview of the signed copy" hidden><p class="hint" id="ppErr" role="alert"></p>`;
    $("#ppFile").onchange = () => {
      const f = $("#ppFile").files[0], t = $("#ppThumb");
      if (f && /^image\//.test(f.type)) { t.src = URL.createObjectURL(f); t.hidden = false; } else t.hidden = true;
    };
    $("#dPaper").showModal();
  }
  async function doPaper() {
    const f = $("#ppFile").files[0];
    if (!f) { $("#ppErr").textContent = "Choose the photo or scan of the signed copy."; return; }
    $("#bPaperGo").disabled = true; $("#ppErr").textContent = "Uploading…";
    try {
      await ensureSaved();
      const { blob, type } = await shrinkImage(f);
      const stage = $("#ppStage").value;
      const q = new URLSearchParams({ stage, signer: $("#ppSigner").value.trim(), date: $("#ppDate").value });
      const r = await apiRaw("POST", `/orders/${order.number}/paper-sign?${q}`, blob, type);
      if (r.status) { order.status = r.status; order._baseStatus = r.status; const sel = document.querySelector('[data-p="status"]'); if (sel) sel.value = r.status; }
      $("#dPaper").close(); renderPreview(); await loadTimeline();
      toast(`Marked signed on paper${r.cancelledEsign ? ". The e-signature request was cancelled" : ""}.`);
    } catch (e) { $("#ppErr").textContent = e.message; }
    finally { $("#bPaperGo").disabled = false; }
  }

  // ---------- invoices ----------
  let inv = null, payItem = null;
  function openInvoice(existing) {
    const b = order.billing || {};
    inv = existing ? clone(existing.data) : {
      number: "", date: today(), due: isoDay(Date.now() + 14 * 864e5), periodFrom: "", periodTo: "", taxRate: b.taxRate || "",
      lines: (order.lines || []).filter(l => l.desc || Number(l.qty)).map(l => ({ desc: l.desc, qty: l.qty, unit: l.unit, rate: l.rate, taxable: !!l.taxable })),
      notes: "", payTo: b.methods ? `Accepted methods: ${b.methods}.` : "",
    };
    delete inv.html;
    $("#invTitle").textContent = inv.number ? `Invoice ${inv.number}` : "New invoice";
    $("#invErr").textContent = "";
    $("#bInvSend").hidden = !!(existing && existing.data.sent);
    renderInvoiceForm();
    $("#dInvoice").showModal();
  }
  function renderInvoiceForm() {
    const f = (k, l, t = "text", a = "") => `<label class="f"><span>${l}</span><input type="${t}" data-inv="${k}" value="${esc(inv[k] || "")}" ${a}></label>`;
    $("#invBody").innerHTML = `<div class="row3">${f("date", "Invoice date", "date")}${f("due", "Due date", "date")}${f("taxRate", "Tax % (taxable lines)", "number", 'step="0.001" min="0"')}</div>
      <div class="row">${f("periodFrom", "Work from (optional)", "date")}${f("periodTo", "Work to (optional)", "date")}</div>
      <div class="tlrow" style="margin:0 0 10px"><button class="btn ghost small" id="invHours">Add hours from the time log</button><span class="hint" style="margin:0">Adds the time entries inside the dates above.</span></div>
      <div class="rows ilines" id="invLines"></div><button class="btn ghost small" id="invAddLine">Add line</button>
      <div class="tot" id="invTot"></div>
      <label class="f" style="margin-top:12px"><span>How to pay</span><textarea data-inv="payTo" rows="2">${esc(inv.payTo || "")}</textarea></label>
      <label class="f"><span>Notes</span><textarea data-inv="notes" rows="2">${esc(inv.notes || "")}</textarea></label>`;
    $("#invBody").querySelectorAll("[data-inv]").forEach(el => el.addEventListener("input", () => { inv[el.dataset.inv] = el.value; invTotals(); }));
    $("#invAddLine").onclick = () => { inv.lines.push({ desc: "", qty: 1, unit: "hour", rate: (order.billing && order.billing.rate) || "", taxable: false }); invLines(); };
    $("#invHours").onclick = () => {
      const from = inv.periodFrom || "0000-00-00", to = inv.periodTo || "9999-12-31";
      const te = ((order.work && order.work.time) || []).filter(t => t.date && t.date >= from && t.date <= to);
      const hrs = te.reduce((a, t) => a + D.hoursOf(t), 0);
      if (!hrs) { $("#invErr").textContent = "No time entries in those dates. Add a line by hand."; return; }
      const short = d => d ? new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
      const label = inv.periodFrom || inv.periodTo ? `Labor, ${short(inv.periodFrom) || "start"} to ${short(inv.periodTo) || "now"}` : "Labor";
      inv.lines.push({ desc: `${label} (${te.length} ${te.length === 1 ? "session" : "sessions"})`, qty: Math.round(hrs * 100) / 100, unit: "hour", rate: (order.billing && order.billing.rate) || "", taxable: false });
      invLines(); $("#invErr").textContent = "";
    };
    invLines();
  }
  function invLines() {
    const box = $("#invLines");
    box.innerHTML = inv.lines.map((l, i) => `<div class="rowitem" data-i="${i}">${inp("desc", l.desc, "Description")}${inp("qty", l.qty, "Qty", "number", 'step="0.25" min="0"')}${inp("unit", l.unit, "Unit")}${inp("rate", l.rate, "Rate", "number", 'step="0.01" min="0"')}
      <button class="icon-btn" data-del="${i}" aria-label="Remove">×</button>
      <div class="sub"><label><input type="checkbox" data-k="taxable"${l.taxable ? " checked" : ""}> Taxable</label><span class="mono">${D.money(D.lineAmount(l))}</span></div></div>`).join("");
    box.querySelectorAll("[data-k]").forEach(el => el.addEventListener(el.type === "checkbox" ? "change" : "input", () => {
      const l = inv.lines[+el.closest("[data-i]").dataset.i];
      l[el.dataset.k] = el.type === "checkbox" ? el.checked : el.value;
      const m = el.closest("[data-i]").querySelector(".sub .mono"); if (m) m.textContent = D.money(D.lineAmount(l));
      invTotals();
    }));
    box.querySelectorAll("[data-del]").forEach(b => b.onclick = () => { inv.lines.splice(+b.dataset.del, 1); invLines(); });
    invTotals();
  }
  function invTotals() {
    const t = D.invoiceTotals(inv);
    $("#invTot").innerHTML = `<span>Subtotal</span><b>${D.money(t.subtotal)}</b>${t.tax ? `<span>Tax</span><b>${D.money(t.tax)}</b>` : ""}<span>Total</span><b>${D.money(t.total)}</b>${t.paid ? `<span>Paid</span><b>${D.money(t.paid)}</b><span>Balance</span><b>${D.money(t.balance)}</b>` : ""}`;
  }
  async function saveInvoice(send) {
    if (!inv.lines.some(l => Number(l.qty) && Number(l.rate))) { $("#invErr").textContent = "Add at least one line with a quantity and a rate."; return; }
    $("#invErr").textContent = "Saving…"; $("#bInvSave").disabled = $("#bInvSend").disabled = true;
    try {
      await ensureSaved();
      const o = compiled();
      let r = await api("POST", `/orders/${order.number}/invoices`, { invoice: inv, html: D.renderInvoice(o, inv) });
      if (!inv.number) {
        inv.number = r.invoice.data.number; inv.payments = r.invoice.data.payments || [];
        r = await api("POST", `/orders/${order.number}/invoices`, { invoice: inv, html: D.renderInvoice(o, inv) });
      }
      if (send) await api("POST", `/orders/${order.number}/invoices/${inv.number}/send`, {});
      $("#dInvoice").close(); await loadTimeline();
      toast(send ? `Invoice ${inv.number} is in the client's portal.` : `Invoice ${inv.number} saved as a draft.`);
    } catch (e) { $("#invErr").textContent = e.message; }
    finally { $("#bInvSave").disabled = $("#bInvSend").disabled = false; }
  }
  function openPay(item) {
    payItem = item;
    const d = item.data, bal = d.totals ? d.totals.balance : 0;
    const methods = String((order.billing && order.billing.methods) || "").split(/,|\bor\b/).map(x => x.trim()).filter(Boolean);
    $("#payTitle").textContent = `Payment for ${d.number}`;
    $("#payBody").innerHTML = `<div class="row"><label class="f"><span>Amount</span><input id="payAmt" type="number" step="0.01" min="0" value="${bal > 0 ? bal.toFixed(2) : ""}"></label>
        <label class="f"><span>Date received</span><input id="payDate" type="date" value="${today()}"></label></div>
      <label class="f"><span>Method</span><input id="payMethod" type="text" list="payMethods" value="${esc(methods[0] || "")}"><datalist id="payMethods">${methods.map(m => `<option value="${esc(m)}">`).join("")}</datalist></label>
      <label class="f"><span>Note (optional)</span><input id="payNote" type="text"></label><p class="hint" id="payErr" role="alert"></p>`;
    $("#dPay").showModal();
  }
  async function doPay() {
    const amount = Number($("#payAmt").value);
    if (!(amount > 0)) { $("#payErr").textContent = "Enter the amount received."; return; }
    const d = clone(payItem.data);
    const p = { amount, date: $("#payDate").value, method: $("#payMethod").value.trim(), note: $("#payNote").value.trim() };
    d.payments = [...(d.payments || []), p];
    $("#bPayGo").disabled = true;
    try {
      const r = await api("POST", `/orders/${order.number}/invoices/${d.number}/payments`, { ...p, html: D.renderInvoice(compiled(), d) });
      if (r.status && r.status !== order.status) { order.status = r.status; order._baseStatus = r.status; const sel = document.querySelector('[data-p="status"]'); if (sel) sel.value = r.status; renderPreview(); }
      $("#dPay").close(); await loadTimeline();
      toast(`Recorded ${D.money(amount)} for ${d.number}.`);
    } catch (e) { $("#payErr").textContent = e.message; }
    finally { $("#bPayGo").disabled = false; }
  }

  // ---------- misc ----------
  function toast(msg) { setSync(msg); }
  document.querySelectorAll("dialog [data-close]").forEach(b => b.addEventListener("click", () => b.closest("dialog").close()));
  $("#bNew").onclick = () => $("#dNew").showModal();
  $("#bOrders").onclick = openOrders;
  $("#bSettings").onclick = () => { renderSettings(); $("#dSettings").showModal(); };
  $("#bForget").onclick = () => { $("#dSettings").close(); lock("Locked."); };
  $("#bPdf").onclick = printPdf;
  $("#bSend").onclick = openSend;
  $("#bSendGo").onclick = doSend;
  $("#bPaperGo").onclick = doPaper;
  $("#bInvSave").onclick = () => saveInvoice(false);
  $("#bInvSend").onclick = () => saveInvoice(true);
  $("#bPayGo").onclick = doPay;
  document.querySelectorAll("#panelSeg button").forEach(b => b.onclick = () => showPanel(b.dataset.panel));
  setInterval(() => { if (order && key && document.visibilityState === "visible") loadTimeline(); }, 60000);
  $("#bBackupAll").onclick = async () => {
    $("#bBackupAll").disabled = true;
    try { const r = await api("POST", "/backup-all"); const bad = r.results.filter(x => !x.ok); toast(bad.length ? `${bad.length} backups failed: ${bad[0].error}` : `All ${r.results.length} orders backed up.`); openOrders(); }
    catch (e) { toast(e.message); } finally { $("#bBackupAll").disabled = false; }
  };
  document.addEventListener("keydown", e => { if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); dirty = true; save(); } });

  async function refreshClients() {
    try {
      clients = (await api("GET", "/clients")).clients || [];
      const pick = $("#clientPick");
      if (pick) pick.innerHTML = `<option value="">New client (made when you save)</option>` + clients.map(c =>
        `<option value="${esc(c.id)}"${order && order.clientId === c.id ? " selected" : ""}>${esc(c.name || c.email || c.id)}${c.email ? " · " + esc(c.email) : ""}</option>`).join("");
    } catch (_) { /* the picker keeps its last list */ }
  }

  let started = false;
  function start() {
    if (started) return; started = true;
    renderTemplates();
    api("GET", "/health").then(h => { health = h; }).catch(() => {});
    refreshClients();
    const cur = LS.get("wo-current", "");
    if (cur) loadOrder(cur); else buildEditor();
  }

  if (key) unlock(key); else lock();
})();
