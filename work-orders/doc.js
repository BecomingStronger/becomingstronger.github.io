/* Work order document renderer.
 *
 * renderDoc(order, opts) returns one complete, standalone HTML page. The same
 * page is the live preview, the printed PDF, the copy backed up to Google
 * Drive, and the document sent for signature, so the four never disagree.
 *
 * opts.signing = true replaces the blank signature lines with signing-field
 * tags (see SIGN_TAGS) for the e-signature service.
 */
(function (global) {
  "use strict";

  const esc = s => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const paras = s => esc(s).split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
    .map(p => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");
  const money = n => (Number(n) || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
  const num = n => { const v = Number(n) || 0; return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, "").replace(/\.$/, ""); };
  const fmtDate = d => {
    if (!d) return "";
    const t = new Date(d.length <= 10 ? d + "T12:00:00" : d);
    return isNaN(t) ? esc(d) : t.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  };
  const fmtDateTime = d => {
    if (!d) return "";
    const t = new Date(d);
    if (isNaN(t)) return esc(d);
    if (d.length <= 10) return fmtDate(d);
    return t.toLocaleString("en-US", { year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
  };

  function lineAmount(l) { return (Number(l.qty) || 0) * (Number(l.rate) || 0); }

  function totals(o) {
    const lines = (o.lines || []).filter(l => l.desc || Number(l.qty) || Number(l.rate));
    const subtotal = lines.reduce((a, l) => a + lineAmount(l), 0);
    const taxable = lines.filter(l => l.taxable).reduce((a, l) => a + lineAmount(l), 0);
    const rate = Number(o.billing && o.billing.taxRate) || 0;
    const tax = Math.round(taxable * rate) / 100;
    const total = subtotal + tax;
    const deposit = Number(o.billing && o.billing.deposit) || 0;
    const paid = Number(o.billing && o.billing.paid) || 0;
    return { subtotal, taxable, tax, total, deposit, paid, balance: total - deposit - paid };
  }

  function hoursOf(t) {
    if (t.hours !== "" && t.hours != null && !isNaN(Number(t.hours))) return Number(t.hours);
    if (!t.start || !t.end) return 0;
    const [a, b] = [t.start, t.end].map(x => { const [h, m] = x.split(":").map(Number); return h * 60 + (m || 0); });
    return Math.max(0, (b - a) / 60);
  }

  const STAGE_LABEL = { authorization: "Authorization", completion: "Completion and acceptance" };
  const TYPE_LABEL = {
    breakfix: "Repair (break/fix)", install: "Installation and setup", project: "Project",
    recurring: "Recurring support", onsite: "On-site service call", data: "Data and scanning project",
  };

  // SignWell text tags: {{type:signer:required:label:prefill:api_id:width:height}}.
  // Signer 1 = client, signer 2 = contractor (the order of the recipients sent).
  // SignWell leaves the tag text in the file, so it is printed in white.
  const SIGNER = { Client: 1, Contractor: 2 };
  // Tags stay short (no label on signatures) so each one fits on one line of its
  // cell; a tag that wraps is not read. Dates lock to the signing date.
  const R = role => SIGNER[role];
  const SIGN_TAGS = {
    sig: role => `<span class="swtag">{{s:${R(role)}:y:::${role.toLowerCase()}_sig:220:40}}</span>`,
    date: role => `<span class="swtag">{{d:${R(role)}:y:Date::${role.toLowerCase()}_date:110:18:y:mm/dd/yyyy}}</span>`,
    text: role => `<span class="swtag">{{text:${R(role)}:y:Name::${role.toLowerCase()}_name:200:18}}</span>`,
  };

  function sigBlock(o, opts, who, role, label) {
    const signing = opts && opts.signing;
    const person = who === "client" ? o.client || {} : o.contractor || {};
    const printed = person.name || "";
    const sig = signing ? SIGN_TAGS.sig(role, `${label} signature`) : "";
    const date = signing ? SIGN_TAGS.date(role, `${label} date`) : "";
    const nameCell = printed ? esc(printed) : (signing ? SIGN_TAGS.text(role, `${label} printed name`) : "");
    return `<div class="sigbox">
      <div class="siglabel">${esc(label)}</div>
      <div class="sigline">${sig}</div>
      <div class="sigmeta"><span>Signature</span></div>
      <div class="sigrow">
        <div><div class="sigfill">${nameCell}</div><span>Printed name</span></div>
        <div><div class="sigfill">${date}</div><span>Date</span></div>
      </div>
    </div>`;
  }

  const CSS = `
@import url("https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&display=swap");
:root{--ink:#16181d;--ink-2:#545a66;--rule:#cdd1d9;--fill:#f3f5f9;--accent:#24408e}
@page{size:letter;margin:0.6in 0.65in 0.7in}
*{box-sizing:border-box}
html{background:#fff}
body{margin:0;color:var(--ink);font:9.6pt/1.45 "IBM Plex Sans",-apple-system,"Helvetica Neue",Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sheet{max-width:7.2in;margin:0 auto;padding:0.4in 0}
@media print{.sheet{padding:0;max-width:none}}
.mono{font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace}
header.doc{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;border-bottom:2px solid var(--accent);padding-bottom:10px;margin-bottom:14px}
.from{font-size:8.8pt;color:var(--ink-2);line-height:1.4}
.from b{display:block;color:var(--ink);font-size:10.5pt;font-weight:600}
.titleblock{text-align:right}
.kind{font-size:8pt;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);font-weight:600}
h1{font-size:16pt;line-height:1.15;margin:2px 0 4px;font-weight:600}
.idrow{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:8.6pt;color:var(--ink-2)}
.idrow b{color:var(--ink);font-weight:500}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:0;border:1px solid var(--rule);margin:0 0 12px}
.grid2>div{padding:7px 9px}
.grid2>div+div{border-left:1px solid var(--rule)}
.lbl{font-size:7.4pt;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-2);font-weight:600;margin-bottom:2px}
.facts{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--rule);border-top:none;margin:-12px 0 12px}
.facts>div{padding:6px 9px}
.facts>div+div{border-left:1px solid var(--rule)}
h2{font-size:8.2pt;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);margin:16px 0 5px;font-weight:600;border-bottom:1px solid var(--rule);padding-bottom:3px;break-after:avoid}
p{margin:0 0 6px}
ol,ul{margin:2px 0 6px;padding-left:17px}
li{margin:1.5px 0}
table{border-collapse:collapse;width:100%;margin:2px 0 6px;font-size:9pt}
th,td{border-bottom:1px solid var(--rule);padding:4px 6px;text-align:left;vertical-align:top}
th{font-size:7.4pt;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-2);font-weight:600;border-bottom:1px solid var(--ink)}
td.n,th.n{text-align:right;font-family:"IBM Plex Mono",ui-monospace,monospace;white-space:nowrap}
tr{break-inside:avoid}
.tot{width:50%;margin-left:auto}
.tot td{border:none;padding:2px 6px}
.tot tr.grand td{border-top:1px solid var(--ink);font-weight:600;padding-top:5px}
.note{font-size:8.4pt;color:var(--ink-2)}
.terms{font-size:8.4pt;color:#2b2f37}
.terms li{margin:2px 0}
.signs{display:grid;grid-template-columns:1fr 1fr;gap:26px;margin-top:14px;break-inside:avoid}
.sigbox{break-inside:avoid}
.siglabel{font-weight:600;font-size:9pt;margin-bottom:22px}
.sigline{border-bottom:1px solid var(--ink);min-height:46px;display:flex;align-items:flex-start}
.sigmeta,.sigrow span{font-size:7.4pt;color:var(--ink-2);letter-spacing:.06em;text-transform:uppercase}
.sigrow{display:grid;grid-template-columns:1.4fr 1fr;gap:14px;margin-top:10px}
.sigfill{border-bottom:1px solid var(--ink);min-height:20px;font-size:9.2pt}
.consent{font-size:8pt;color:var(--ink-2);margin-top:12px;border:1px solid var(--rule);background:var(--fill);padding:6px 9px;break-inside:avoid}
footer.doc{margin-top:18px;font-size:7.6pt;color:var(--ink-2);display:flex;justify-content:space-between;border-top:1px solid var(--rule);padding-top:5px}
.empty{color:#9aa0ab;font-style:italic}
.swtag,.sigrow .swtag,.sigmeta .swtag{color:#fff;font-size:4pt;line-height:1;white-space:nowrap;text-transform:none;letter-spacing:0}
`;

  function renderDoc(o, opts) {
    opts = opts || {};
    const c = o.contractor || {}, cl = o.client || {}, s = o.site || {}, sch = o.schedule || {}, b = o.billing || {};
    const t = totals(o);
    const stage = o.stage || "authorization";
    const isDone = stage === "completion";
    const out = [];
    const sec = (title, body) => { if (body && body.trim()) out.push(`<h2>${esc(title)}</h2>${body}`); };
    const list = (items, tag = "ul") => {
      const xs = (items || []).map(x => String(x || "").trim()).filter(Boolean);
      return xs.length ? `<${tag}>${xs.map(x => `<li>${esc(x)}</li>`).join("")}</${tag}>` : "";
    };
    const addr = p => [p.org && p.name ? p.name : "", p.address, [p.email, p.phone].filter(Boolean).join(" · ")]
      .filter(Boolean).map(esc).join("<br>");

    // Request / purpose
    sec(o.type === "breakfix" ? "Problem reported" : "Purpose", paras(o.request));

    // Equipment
    const assets = (o.assets || []).filter(a => a.desc || a.make || a.model || a.serial || a.tag);
    if (assets.length) sec("Equipment", `<table><thead><tr><th>Item</th><th>Make / model</th><th>Serial</th><th>Asset tag</th><th>Condition / notes</th></tr></thead><tbody>${
      assets.map(a => `<tr><td>${esc(a.desc)}</td><td>${esc([a.make, a.model].filter(Boolean).join(" "))}</td><td class="mono">${esc(a.serial)}</td><td class="mono">${esc(a.tag)}</td><td>${esc(a.notes)}</td></tr>`).join("")}</tbody></table>`);

    sec("Scope of work", list(o.scope, "ol"));
    sec("Deliverables", list(o.deliverables));
    sec("Not included", list(o.exclusions));
    sec("Client responsibilities", list(o.clientDuties));
    const pl = o.plan || {};
    if (pl.implementation || pl.test || pl.rollback) {
      sec("Plan", [["Steps", pl.implementation], ["Test", pl.test], ["If it fails", pl.rollback]]
        .filter(([, v]) => v && v.trim()).map(([k, v]) => `<p><b>${k}.</b> ${esc(v).replace(/\n/g, "<br>")}</p>`).join(""));
    }
    if (o.termLength) sec("Term", paras(o.termLength));

    // Charges
    const lines = (o.lines || []).filter(l => l.desc || Number(l.qty) || Number(l.rate));
    if (lines.length || t.total) {
      const head = isDone ? "Charges" : (b.mode === "flat" ? "Price" : "Estimate");
      let body = `<table><thead><tr><th>Description</th><th class="n">Qty</th><th>Unit</th><th class="n">Rate</th><th class="n">Amount</th></tr></thead><tbody>${
        lines.map(l => `<tr><td>${esc(l.desc)}${l.taxable ? ' <span class="note">(taxable)</span>' : ""}</td><td class="n">${num(l.qty)}</td><td>${esc(l.unit)}</td><td class="n">${money(l.rate)}</td><td class="n">${money(lineAmount(l))}</td></tr>`).join("")
      }</tbody></table><table class="tot"><tbody>
        <tr><td>Subtotal</td><td class="n">${money(t.subtotal)}</td></tr>
        ${t.tax ? `<tr><td>Sales tax (${num(b.taxRate)}% of taxable items)</td><td class="n">${money(t.tax)}</td></tr>` : ""}
        <tr class="grand"><td>${isDone ? "Total" : "Estimated total"}</td><td class="n">${money(t.total)}</td></tr>
        ${t.deposit ? `<tr><td>Deposit${isDone ? " received" : " due before work starts"}</td><td class="n">${money(t.deposit)}</td></tr>` : ""}
        ${isDone && t.paid ? `<tr><td>Other payments received</td><td class="n">${money(t.paid)}</td></tr>` : ""}
        ${isDone ? `<tr class="grand"><td>Balance due</td><td class="n">${money(t.balance)}</td></tr>` : ""}
      </tbody></table>`;
      if (!isDone && b.mode === "hourly" && b.cap) body += `<p class="note">The contractor will not go over ${money(b.cap)} without the client's written approval.</p>`;
      if (!isDone && b.mode === "hourly" && !b.cap) body += `<p class="note">This is an estimate. The client pays for actual time, billed in ${esc(b.increment || "15-minute")} increments.</p>`;
      sec(head, body);
    }

    // Completion
    if (isDone) {
      const w = o.work || {};
      const te = (w.time || []).filter(x => x.date || x.start || x.hours || x.note);
      if (te.length) {
        const hrs = te.reduce((a, x) => a + hoursOf(x), 0);
        sec("Time log", `<table><thead><tr><th>Date</th><th>Start</th><th>End</th><th class="n">Hours</th><th>Work done</th></tr></thead><tbody>${
          te.map(x => `<tr><td>${fmtDate(x.date)}</td><td class="mono">${esc(x.start)}</td><td class="mono">${esc(x.end)}</td><td class="n">${num(hoursOf(x))}</td><td>${esc(x.note)}</td></tr>`).join("")
        }<tr><td colspan="3"><b>Total</b></td><td class="n"><b>${num(hrs)}</b></td><td></td></tr></tbody></table>`);
      }
      if (w.outcome) sec("Outcome", `<p><b>${w.outcome === "incomplete" ? "Not complete" : "Complete"}.</b> ${esc(w.outcomeNote || "")}</p>`);
      sec("Work performed", paras(w.performed));
      sec("Result", paras(w.resolution));
      sec("Recommendations and follow-up", paras(w.followUp));
    }

    // Payment + terms
    const pay = [];
    if (b.terms) pay.push(`Payment is due ${esc(b.terms)}.`);
    if (b.methods) pay.push(`Accepted methods: ${esc(b.methods)}.`);
    if (pay.length) sec("Payment", `<p>${pay.join(" ")}</p>`);
    const terms = (o.terms || []).filter(x => x && String(x).trim());
    if (terms.length) sec("Terms", `<ol class="terms">${terms.map(x => `<li>${esc(x)}</li>`).join("")}</ol>`);
    if (o.notes) sec("Notes", paras(o.notes));

    // Signatures
    const clientLabel = isDone ? "Work accepted by client" : "Authorized by client";
    const signs = `<div class="signs">${sigBlock(o, opts, "client", "Client", clientLabel)}${sigBlock(o, opts, "contractor", "Contractor", "Contractor")}</div>
      <div class="consent">${isDone
        ? "By signing, the client confirms that the work above was completed and accepted, and agrees to pay the balance due under the payment terms."
        : "By signing, the client authorizes the work above, at the stated rates and terms, and confirms they have the authority to approve work on the listed equipment and premises."}
        ${opts.signing ? " Each party agrees to sign this document electronically, and agrees that an electronic signature has the same effect as a handwritten one." : ""}</div>`;

    const facts = [
      ["Order date", fmtDate(o.date)],
      [isDone ? "Completed" : "Scheduled", fmtDateTime(isDone ? (o.work && o.work.completed) || sch.start : sch.start) || "To be agreed"],
      ["Priority", o.priority ? o.priority[0].toUpperCase() + o.priority.slice(1) : "Normal"],
      ["Rate", b.mode === "flat" ? "Fixed price" : (b.rate ? `${money(b.rate)} / hour` : "See charges")],
    ];

    const title = `${o.number || "Draft"}${cl.org || cl.name ? " · " + (cl.org || cl.name) : ""}${o.title ? " · " + o.title : ""}`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title><style>${CSS}</style></head><body><div class="sheet">
<header class="doc">
  <div class="from"><b>${esc(c.business || c.name || "Contractor")}</b>${addr({ ...c, org: c.business })}</div>
  <div class="titleblock"><div class="kind">Work order · ${esc(STAGE_LABEL[stage])}</div>
    <h1>${esc(o.title || TYPE_LABEL[o.type] || "Work order")}</h1>
    <div class="idrow">No. <b>${esc(o.number || "DRAFT")}</b>${o.ticket ? ` · Ref <b>${esc(o.ticket)}</b>` : ""}</div></div>
</header>
<div class="grid2">
  <div><div class="lbl">Client</div><b>${esc(cl.org || cl.name) || '<span class="empty">Client name</span>'}</b><br>${addr(cl)}</div>
  <div><div class="lbl">Service location</div>${esc(s.address) || (cl.address ? "Client address" : "To be agreed")}${s.access ? `<br><span class="note">Access: ${esc(s.access)}</span>` : ""}${s.contact ? `<br><span class="note">On-site contact: ${esc(s.contact)}</span>` : ""}</div>
</div>
<div class="facts">${facts.map(([k, v]) => `<div><div class="lbl">${esc(k)}</div>${v}</div>`).join("")}</div>
${out.join("\n")}
${signs}
<footer class="doc"><span class="mono">${esc(o.number || "DRAFT")}</span><span>${esc(TYPE_LABEL[o.type] || "")}</span></footer>
</div></body></html>`;
  }

  global.WODoc = { renderDoc, totals, hoursOf, lineAmount, money, TYPE_LABEL, STAGE_LABEL };
})(typeof window !== "undefined" ? window : globalThis);
