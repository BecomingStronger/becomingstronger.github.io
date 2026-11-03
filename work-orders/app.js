/* Work orders editor.
 *
 * Everything that creates or keeps an order goes through the Worker with the
 * access key: numbers, saves (each save is also copied to Google Drive), the
 * orders list, and sending for signature. The page holds no data and no
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
      order._drive = rec.drive && rec.drive.folder ? `https://drive.google.com/drive/folders/${rec.drive.folder}` : "";
      order._backedUp = rec.backedUp || "";
    } catch (e) {
      if (!local) { toast(e.message); return; }
      order = local.order; dirty = true;
    }
    LS.set("wo-current", n);
    buildEditor();
    if (dirty) scheduleSave();
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
    delete o._drive; delete o._backedUp;
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
      const r = await api("PUT", `/orders/${order.number}`, { order: o, html: D.renderDoc(o) });
      dirty = false; LS.del(`wo-draft:${order.number}`);
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
  function printPdf() {
    if (!order) return;
    const f = $("#preview");
    const w = f.contentWindow;
    if (!w) return;
    w.focus(); w.print();
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
        <div class="row">${select("type", "Work type", Object.entries(D.TYPE_LABEL))}${select("status", "Status", ["draft", "sent", "authorized", "in progress", "completed", "accepted", "paid", "void"].map(x => [x, x[0].toUpperCase() + x.slice(1)]))}</div>
        <div class="row3">${field("date", "Order date", "date")}${select("priority", "Priority", [["low", "Low"], ["normal", "Normal"], ["high", "High"], ["urgent", "Urgent"]])}${field("ticket", "Ref / PO no.")}</div>`, true),
      sec("Client", `<div class="row">${field("client.name", "Contact name")}${field("client.org", "Company (optional)")}</div>
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
        message: $("#sMsg").value,
      });
      order.status = "sent";
      order.signing = order.signing || {}; order.signing[order.stage] = { id: r.submission, sent: new Date().toISOString() };
      markDirty(); renderPreview();
      $("#dSend").close(); toast(`Sent to ${email}.`);
    } catch (e) { $("#sErr").textContent = e.message; }
    finally { $("#bSendGo").disabled = false; }
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
  $("#bBackupAll").onclick = async () => {
    $("#bBackupAll").disabled = true;
    try { const r = await api("POST", "/backup-all"); const bad = r.results.filter(x => !x.ok); toast(bad.length ? `${bad.length} backups failed: ${bad[0].error}` : `All ${r.results.length} orders backed up.`); openOrders(); }
    catch (e) { toast(e.message); } finally { $("#bBackupAll").disabled = false; }
  };
  document.addEventListener("keydown", e => { if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); dirty = true; save(); } });

  let started = false;
  function start() {
    if (started) return; started = true;
    renderTemplates();
    const cur = LS.get("wo-current", "");
    if (cur) loadOrder(cur); else buildEditor();
  }

  if (key) unlock(key); else lock();
})();
