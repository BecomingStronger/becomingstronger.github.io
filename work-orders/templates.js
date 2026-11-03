/* Work order templates and the standard terms library.
 *
 * Field set taken from real service paperwork: ServiceNow work orders and
 * change requests, Syncro ticket/invoice PDF tags, Freshservice ticket fields,
 * Autotask SLA dates, a university paper work order, two university IT repair
 * shops' terms, and a data recovery shop's work order. Two client signatures
 * (authorize at intake, accept at completion) follow Syncro's intake and
 * outtake signature lines.
 *
 * Terms are plain-language starting points, not legal advice. Edit per job.
 */
(function (global) {
  "use strict";

  const TERMS = {
    backup: { label: "Data backup", text: "The client is responsible for a current backup of all data before work starts. The contractor takes reasonable care but is not liable for loss of data, software, or settings." },
    liability: { label: "Liability limit", text: "The contractor's total liability for this work order is limited to the amount the client paid for it. Neither party is liable for indirect or consequential losses, such as lost profits or lost business." },
    laborWarranty: { label: "Labor warranty", text: "If the same problem returns within 30 days because of the contractor's work, the contractor fixes it at no labor charge. Parts carry only the manufacturer's warranty." },
    changes: { label: "Changes in writing", text: "Any change to scope, price, or schedule must be agreed in writing (email or text is enough) before the changed work starts." },
    overage: { label: "Estimate overrun", text: "If the work will cost more than 10% over the estimate, the contractor stops and gets the client's approval first." },
    cancellation: { label: "Cancellation", text: "Either party can cancel at any time. The client pays for work done and parts ordered up to that point. A visit cancelled with less than 24 hours' notice can be billed at one hour." },
    diagnostic: { label: "Diagnostic fee", text: "The diagnostic fee is charged even if the client decides not to go ahead with the repair. It is credited toward the repair if the client approves it." },
    access: { label: "Access and passwords", text: "The client gives the contractor the access needed to do the work (accounts, passwords, premises). The contractor uses that access only for this work and returns or removes it at the end." },
    confidentiality: { label: "Confidentiality", text: "The contractor keeps the client's data and documents confidential, does not copy or keep them except as this work requires, and does not discuss their contents with anyone." },
    licenses: { label: "Software licenses", text: "The client supplies, or pays for, all software licenses. The contractor installs only licensed software and can accept license terms and install updates on the client's behalf." },
    abandoned: { label: "Unclaimed equipment", text: "Equipment left with the contractor more than 30 days after the client is told it is ready can be returned to the client at the client's cost or disposed of." },
    ownership: { label: "Ownership", text: "When the client pays in full, the client owns the deliverables. The contractor keeps the right to reuse general know-how, tools, and scripts that contain no client data." },
    retention: { label: "Data retention", text: "Files recovered or moved for the client are kept by the contractor for 5 business days after delivery so the client can check them, then securely deleted." },
    nonsolicit: { label: "Independent contractor", text: "The contractor works as an independent contractor, not an employee, and is responsible for their own taxes." },
    entire: { label: "Entire agreement", text: "This work order is the whole agreement for this work. It replaces earlier discussions about the same work." },
  };

  const blankLine = (desc = "", unit = "hour", taxable = false) => ({ desc, qty: "", unit, rate: "", taxable });

  const TEMPLATES = {
    breakfix: {
      label: "Repair (break/fix)",
      blurb: "One device or problem. Drop-off authorization, pickup acceptance.",
      order: {
        title: "Computer repair", priority: "normal",
        request: "",
        assets: [{ desc: "Laptop", make: "", model: "", serial: "", tag: "", notes: "Accessories received: charger" }],
        scope: ["Diagnose the reported problem and report the cause and cost to the client before repair.", "Repair or replace failed parts after the client approves the cost.", "Test the device and confirm the reported problem is gone."],
        deliverables: [], exclusions: ["Data recovery from a failed drive (quoted separately).", "Problems not related to the reported problem."],
        clientDuties: ["Back up data before drop-off, or tell the contractor that no backup exists.", "Give the device password, or approve a password reset."],
        billing: { mode: "hourly", rate: "", increment: "15-minute", cap: "", deposit: "", taxRate: "", terms: "when the device is returned", methods: "" },
        lines: [{ desc: "Diagnostic fee", qty: 1, unit: "flat", rate: "", taxable: false }, blankLine("Repair labor"), blankLine("Parts", "each", true)],
        terms: ["backup", "diagnostic", "laborWarranty", "overage", "liability", "abandoned"],
      },
    },
    install: {
      label: "Installation and setup",
      blurb: "New hardware, software, or network. Plan, rollback, test.",
      order: {
        title: "Installation and setup", priority: "normal",
        request: "",
        assets: [{ desc: "", make: "", model: "", serial: "", tag: "", notes: "New" }],
        scope: ["Install and configure the equipment and software listed above.", "Move the client's data and settings from the old system, if any.", "Test each item with the client and fix any problem found.", "Show the client how to use the new setup."],
        deliverables: ["A short written record of the setup: device names, network settings, and where account details are kept."],
        exclusions: ["Purchase of hardware or licenses, unless listed under charges.", "Repairs to existing equipment not listed above."],
        clientDuties: ["Supply licenses, account logins, and admin access before the start date.", "Have a current backup of any system that will be changed."],
        plan: { implementation: "", rollback: "If the new setup fails, return the client's system to its earlier condition from the backup or the old equipment.", test: "" },
        billing: { mode: "hourly", rate: "", increment: "15-minute", cap: "", deposit: "", taxRate: "", terms: "within 15 days of the invoice", methods: "" },
        lines: [blankLine("Installation and setup labor"), blankLine("Hardware", "each", true)],
        terms: ["backup", "licenses", "access", "changes", "overage", "laborWarranty", "liability"],
      },
    },
    project: {
      label: "Project (fixed scope)",
      blurb: "Defined deliverables at a fixed price, with a deposit.",
      order: {
        title: "IT project", priority: "normal",
        request: "",
        assets: [],
        scope: ["", ""],
        deliverables: [""],
        exclusions: ["Work not listed under scope."],
        clientDuties: ["Name one person who approves the work and answers questions within 2 business days."],
        billing: { mode: "flat", rate: "", increment: "", cap: "", deposit: "", taxRate: "", terms: "50% before work starts and the balance within 15 days of completion", methods: "" },
        lines: [{ desc: "Project, fixed price", qty: 1, unit: "flat", rate: "", taxable: false }],
        terms: ["changes", "ownership", "access", "confidentiality", "cancellation", "liability", "nonsolicit", "entire"],
      },
    },
    recurring: {
      label: "Recurring support",
      blurb: "Monthly retainer with included hours and response times.",
      order: {
        title: "Monthly IT support", priority: "normal",
        request: "Ongoing IT support for the client's users and equipment.",
        assets: [],
        scope: ["Remote and on-site support for the client's users, up to the included hours each month.", "Response within 1 business day (4 business hours for urgent problems).", "Monthly check of updates, backups, and security alerts.", "A short monthly report of the time used and the work done."],
        deliverables: [], exclusions: ["Hours over the monthly limit are billed at the hourly rate below.", "Hardware, software, and licenses.", "Projects such as office moves or new systems (quoted separately)."],
        clientDuties: ["Report problems by email or text so each one has a record."],
        billing: { mode: "flat", rate: "", increment: "15-minute", cap: "", deposit: "", taxRate: "", terms: "on the first day of each month, in advance", methods: "" },
        lines: [{ desc: "Monthly support, includes ___ hours", qty: 1, unit: "month", rate: "", taxable: false }, blankLine("Additional hours, if used")],
        terms: ["access", "confidentiality", "backup", "changes", "liability", "nonsolicit", "cancellation"],
        termLength: "Month to month. Either party can end this agreement with 30 days' written notice.",
      },
    },
    onsite: {
      label: "On-site service call",
      blurb: "A visit with arrival and departure times and a trip charge.",
      order: {
        title: "On-site service call", priority: "normal",
        request: "",
        assets: [],
        scope: ["Travel to the service location and find the cause of the reported problem.", "Fix the problem on site if possible, or give the client a written estimate for more work."],
        deliverables: [], exclusions: ["Parts, unless listed under charges."],
        clientDuties: ["Make sure that someone can let the contractor in and stays reachable during the visit."],
        billing: { mode: "hourly", rate: "", increment: "15-minute", cap: "", deposit: "", taxRate: "", terms: "at the end of the visit", methods: "" },
        lines: [{ desc: "Trip charge", qty: 1, unit: "flat", rate: "", taxable: false }, blankLine("On-site labor (1 hour minimum)")],
        terms: ["backup", "cancellation", "laborWarranty", "liability"],
      },
    },
    data: {
      label: "Data and scanning project",
      blurb: "Paper to searchable PDF, file migration, or data cleanup.",
      order: {
        title: "Document scanning", priority: "normal",
        request: "Convert the client's paper records into searchable PDF files, sorted into the client's existing folder structure.",
        assets: [],
        scope: ["Remove staples, clips, and bindings.", "Separate each stack into individual documents.", "Scan each document as one searchable PDF (OCR) into the matching folder.", "Set aside items that do not fit the scanner, label them, and record them in the session log.", "Return processed paper to its box, labeled as done."],
        deliverables: ["Searchable PDF files in the client's folder tree.", "A session log: date, hours, box, number of files, and number of pages."],
        exclusions: ["Shredding or disposal of paper. The client decides what is destroyed and when.", "Uploading to cloud storage or setting up search tools (quoted separately).", "Oversized items."],
        clientDuties: ["Supply the scanner, computer, and folder structure, or approve the contractor's equipment."],
        billing: { mode: "hourly", rate: "", increment: "15-minute", cap: "", deposit: "", taxRate: "", terms: "weekly, against the hours in the session log", methods: "" },
        lines: [blankLine("Scanning and sorting labor")],
        terms: ["confidentiality", "retention", "changes", "cancellation", "liability"],
        notes: "Scan settings: PDF, OCR on, one file per document, duplex, color, 300 DPI. The contractor does not change these settings without the client's approval.\n\nHold for client review before any shredding: wills, trusts, powers of attorney, death certificates, deeds, titles, stock certificates, recent tax returns, and any document with an original signature or seal.",
      },
    },
  };

  global.WOTemplates = { TERMS, TEMPLATES };
})(typeof window !== "undefined" ? window : globalThis);
