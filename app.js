(function () {
  "use strict";

  // ======== SETTINGS: edit these before launch ========
  const SETTINGS = {
    tallyFormId: "M1N2EX",
    businessName: "DebtMedx",   // your brand name, shown in the header and footer
    phone: "1-862-MCA-HERO (1-862-622-4376)",
    apiPath: "/api/analyze"
  };
  // ====================================================

  const CLAUSE_LABELS = {
    security_interest_ucc: "Security interest / UCC lien",
    stacking_prohibition: "Ban on other advances (stacking)",
    prepayment_or_early_payoff: "Early payoff discount",
    true_sale_language: "\"Not a loan\" language"
  };
  const RISK_ORDER = { high: 0, medium: 1, low: 2 };
  const FREQS = ["daily", "weekly", "biweekly", "monthly"];
  const WEEKDAYS = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5 };
  const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
  const MAX_CONTRACTS = 6;

  const $ = (id) => document.getElementById(id);
  const num = (v) => (typeof v === "number" && isFinite(v) ? v : (typeof v === "string" && v.trim() !== "" && isFinite(+v.replace(/[$,]/g, "")) ? +v.replace(/[$,]/g, "") : null));
  const usd = (v) => v == null || !isFinite(v) ? "—" : "$" + Math.round(v).toLocaleString("en-US");
  const usd2 = (v) => v == null || !isFinite(v) ? "—" : "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDate = (s, year) => (!s || !ISO_RE.test(s)) ? "—" : SCHED.D(s).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: year ? "numeric" : undefined });
  const fmtShort = (s) => (!s || !ISO_RE.test(s)) ? "—" : SCHED.D(s).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
  const todayIso = () => { const t = new Date(); return SCHED.iso(new Date(Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()))); };
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  document.querySelectorAll("[data-brand]").forEach((n) => { n.textContent = SETTINGS.businessName; });

  // ---------- Lead capture (Tally popup, falls back to a link) ----------
  function openLeadForm(hidden) {
    const fields = Object.assign({ source: "mcadebtcalculator" }, hidden || {});
    if (!SETTINGS.tallyFormId) { location.hash = "contact"; return; }
    if (window.Tally && typeof window.Tally.openPopup === "function") {
      window.Tally.openPopup(SETTINGS.tallyFormId, { layout: "modal", width: 560, hiddenFields: fields });
    } else {
      const q = Object.keys(fields).map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(fields[k])).join("&");
      window.open("https://tally.so/r/" + SETTINGS.tallyFormId + "?" + q, "_blank", "noopener");
    }
  }
  document.querySelectorAll("[data-lead]").forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); openLeadForm({ entry_point: b.getAttribute("data-lead") }); }));
  if (SETTINGS.phone) document.querySelectorAll("[data-phone]").forEach((n) => {
    const m = SETTINGS.phone.match(/^(.*?)\s*\((.*)\)\s*$/);
    if (m) {
      const href = "tel:" + m[2].replace(/[^0-9]/g, "");
      const a1 = el("a", "phone-link", m[1]); a1.href = href;
      const a2 = el("a", "phone-link phone-digits", m[2]); a2.href = href;
      n.textContent = ""; n.append(a1, el("br"), a2);
    } else n.textContent = SETTINGS.phone;
    n.closest("[data-phone-wrap]")?.classList.remove("hidden");
  });

  // ---------- State ----------
  const drop = $("drop"), fileInput = $("fileInput"), fileList = $("fileList");
  const analyzeBtn = $("analyzeBtn"), statusEl = $("status"), agree = $("agree");
  const resultsWrap = $("results"), stackEl = $("stack"), cardsEl = $("cards");
  let files = [], contracts = [];
  const asOf = todayIso();

  function setStatus(msg, isError, busy) {
    statusEl.innerHTML = "";
    if (busy) statusEl.appendChild(el("span", "spinner"));
    statusEl.appendChild(document.createTextNode(msg || ""));
    statusEl.classList.toggle("error", !!isError);
  }
  const leadName = $("leadName"), leadPhone = $("leadPhone"), leadEmail = $("leadEmail");
  const SHARE_TEXT = (document.getElementById("agreeText").textContent + " " + document.getElementById("fineText").textContent).replace(/\s+/g, " ").trim();
  const unlockEl = $("unlock"), unlockBtn = $("unlockBtn");
  let unlocked = false, unlockedLead = null;
  function lead() {
    return { name: leadName.value.trim(), phone: leadPhone.value.trim(), email: leadEmail.value.trim(), consent_share: agree.checked, consent_contact: agree.checked };
  }
  function leadReady() { const l = lead(); return l.name.length > 1 && l.phone.replace(/\D/g, "").length >= 10 && l.consent_share; }
  function refreshButton() {
    analyzeBtn.disabled = files.length === 0;
    unlockBtn.disabled = !leadReady();
    const l = lead(), hint = $("unlockHint");
    const touched = l.name || l.phone || l.consent_share;
    hint.textContent = touched && !leadReady() ? "Add your name and mobile number, and check the box to unlock." : "";
  }
  unlockBtn.addEventListener("click", () => {
    if (!leadReady()) return;
    unlocked = true; unlockedLead = Object.assign(lead(), { consultation_requested: true });
    unlockEl.classList.add("hidden");
    contracts.forEach((c) => { c.lead = unlockedLead; renderCard(c); if (c.status === "done") shareReport(c); });
    renderStack();
    stackEl.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  });
  function renderFiles() {
    fileList.innerHTML = "";
    files.forEach((f, i) => {
      const li = document.createElement("li");
      li.append(el("span", null, f.name));
      const rm = el("button", null, "Remove"); rm.type = "button"; rm.setAttribute("aria-label", "Remove " + f.name);
      rm.addEventListener("click", () => { files.splice(i, 1); renderFiles(); refreshButton(); });
      li.append(rm); fileList.appendChild(li);
    });
  }
  function addFiles(list) {
    for (const f of list) if (/pdf$/i.test(f.type) || /^image\//.test(f.type)) files.push(f);
    const pdfs = files.filter((f) => /pdf$/i.test(f.type));
    if (pdfs.length > MAX_CONTRACTS) { files = files.filter((f) => !/pdf$/i.test(f.type) || pdfs.indexOf(f) < MAX_CONTRACTS); setStatus("Up to " + MAX_CONTRACTS + " contracts at a time.", true); }
    renderFiles(); refreshButton();
  }
  drop.addEventListener("click", () => fileInput.click());
  drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } });
  fileInput.addEventListener("change", () => { addFiles(fileInput.files); fileInput.value = ""; });
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => { if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files); });
  agree.addEventListener("change", refreshButton);
  [leadName, leadPhone, leadEmail].forEach((x) => x.addEventListener("input", refreshButton));

  // ---------- Copy of each report to DebtMedx ----------
  function sendToOwner(payload) {
    return fetch("/api/lead", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) })
      .then((r) => r.ok).catch(() => false);
  }
  function reportText(c) {
    const r = c.result, m = c.metrics || {}, inp = c.inp;
    const lines = [];
    lines.push("Funder: " + ((r.parties && r.parties.funder) || "unknown") + " | Merchant: " + ((r.parties && r.parties.merchant) || "unknown"));
    lines.push("Structure: " + (inp.structure === "reverse_consolidation" ? "reverse consolidation" : "lump sum") + " | Signed: " + (inp.signed || "unknown"));
    lines.push("Payback " + usd(inp.payback) + " | Payment " + (inp.pmt ? usd2(inp.pmt) + " " + inp.freq : "unknown") + " | Net received " + usd(inp.net));
    if (m.pays) lines.push("First payment " + m.firstPayment + " | Paid to date " + usd(m.paid) + " | Owed " + usd(m.owed) + " | Payoff " + m.payoff + (m.apr ? " | Est. APR " + Math.round(m.apr) + "%" : ""));
    if (inp.structure === "reverse_consolidation" && m.disb) lines.push("Disbursed " + usd(m.disbToDate) + " of " + usd(m.disbTotal));
    lines.push("", "Summary: " + (r.summary || ""), "", "Clauses:");
    (r.clauses || []).forEach((x) => lines.push("- " + (CLAUSE_LABELS[x.key] || x.key) + ": " + (x.found ? (x.risk || "").toUpperCase() : "NOT FOUND") + " - " + (x.summary || "")));
    lines.push("", "Red flags:");
    (r.red_flags || []).forEach((t) => lines.push("- " + t));
    return lines.join("\n");
  }
  async function shareReport(c) {
    const l = c.lead, r = c.result, m = c.metrics || SCHED.metrics(c.inp, asOf), inp = c.inp;
    const filesOut = [];
    let size = 0;
    for (const f of c.job.files || []) {
      if (f.size > 9000000 || size + f.size > 9000000) continue;
      filesOut.push({ name: f.name, type: f.type || "application/octet-stream", data: await blobToB64(f) });
      size += f.size;
    }
    return sendToOwner(Object.assign({}, l, {
      type: "report",
      consent_share_text: SHARE_TEXT,
      consent_contact_text: "",
      submitted_at: new Date().toISOString(),
      page: location.href,
      file_name: c.name,
      funder: (r.parties && r.parties.funder) || "",
      merchant: (r.parties && r.parties.merchant) || "",
      structure: inp.structure,
      payback: inp.payback, payment: inp.pmt, frequency: inp.freq,
      owed: m.pays ? Math.round(m.owed) : "", payoff: m.payoff || "", apr: m.apr ? Math.round(m.apr) : "",
      high_risks: (r.clauses || []).filter((x) => x.risk === "high").map((x) => CLAUSE_LABELS[x.key] || x.key).join("; "),
      summary: r.summary || "",
      report_text: reportText(c),
      files: filesOut
    }));
  }

  // ---------- Reading files in the browser ----------
  function blobToB64(blob) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(blob); });
  }
  async function canvasJpeg(canvas, quality) { return await new Promise((res) => canvas.toBlob(res, "image/jpeg", quality)); }
  async function imageFileToJpeg(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const scale = Math.min(1, 2000 / Math.max(img.width, img.height));
      const c = document.createElement("canvas"); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      return await canvasJpeg(c, 0.85);
    } finally { URL.revokeObjectURL(url); }
  }
  async function readPdf(file) {
    const lib = window.pdfjsLib;
    if (!lib) throw new Error("The PDF reader didn't load. Reload the page.");
    lib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    const pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
    let text = "";
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      text += "\n--- page " + p + " ---\n" + tc.items.map((it) => it.str).join(" ");
    }
    const chars = text.replace(/--- page \d+ ---/g, "").replace(/\s+/g, "").length;
    if (chars >= 90 * pdf.numPages) return { text, images: [] };
    const images = [];
    for (let p = 1; p <= Math.min(pdf.numPages, 15); p++) {
      const page = await pdf.getPage(p);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width; canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      const blob = await canvasJpeg(canvas, 0.82);
      if (blob) images.push(blob);
    }
    return { text: "", images };
  }

  function parseResultText(text) {
    const cleaned = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    const i = cleaned.indexOf("{"), j = cleaned.lastIndexOf("}");
    if (i < 0 || j < 0) throw new Error("The review came back unreadable.");
    return JSON.parse(cleaned.slice(i, j + 1));
  }
  async function postReview(body, headers) {
    let resp;
    try { resp = await fetch(SETTINGS.apiPath, { method: "POST", headers, body }); }
    catch (e) { const err = new Error("The connection dropped while sending this contract."); err.retryable = true; throw err; }
    const ctype = resp.headers.get("content-type") || "";
    if (!resp.ok || ctype.indexOf("event-stream") < 0) {
      let data = null; try { data = await resp.json(); } catch (e) { data = null; }
      const err = new Error((data && data.error) || ("The review didn't finish (error " + resp.status + ")."));
      err.retryable = resp.status >= 500 || resp.status === 429 || !data;
      throw err;
    }
    // Read the streamed answer as it arrives.
    const reader = resp.body.getReader(), dec = new TextDecoder();
    let buf = "", text = "", streamErr = null;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let k;
        while ((k = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, k).trim(); buf = buf.slice(k + 1);
          if (line.indexOf("data:") !== 0) continue;
          let ev; try { ev = JSON.parse(line.slice(5)); } catch (e) { continue; }
          if (ev.type === "content_block_delta" && ev.delta && ev.delta.type === "text_delta") text += ev.delta.text;
          else if (ev.type === "error") streamErr = (ev.error && ev.error.message) || "The review service had a problem.";
        }
      }
    } catch (e) { const err = new Error("The connection dropped while reading this contract."); err.retryable = true; throw err; }
    if (streamErr) { const err = new Error(streamErr); err.retryable = true; throw err; }
    if (!text.trim()) { const err = new Error("The review came back empty."); err.retryable = true; throw err; }
    try { return parseResultText(text); }
    catch (e) { const err = new Error("The review came back unreadable."); err.retryable = true; throw err; }
  }

  async function analyzeJob(job) {
    // A PDF goes to the AI whole, so it reads the real text and every page image, fine print included.
    if (job.files.length === 1 && /pdf$/i.test(job.files[0].type) && job.files[0].size <= 20000000) {
      const b64 = await blobToB64(job.files[0]);
      return postReview(b64, { "content-type": "text/plain", "x-doc-type": "pdf" });
    }
    // Photos (or a very large PDF): send sharp page images.
    let text = "", blobs = [];
    for (const f of job.files) {
      if (/pdf$/i.test(f.type)) { const r = await readPdf(f); text += r.text; blobs = blobs.concat(r.images); }
      else if (/^image\//.test(f.type) && blobs.length < 15) blobs.push(await imageFileToJpeg(f));
    }
    if (!text.trim() && !blobs.length) throw new Error("We couldn't read this file. Try a clearer PDF or photos of each page.");
    const images = [];
    let total = 0;
    for (const b of blobs) { const s = await blobToB64(b); if (total + s.length > 9000000) break; images.push(s); total += s.length; }
    return postReview(JSON.stringify({ text: text.slice(0, 180000), images }), { "content-type": "application/json" });
  }

  // Only show the contract terms we cover (no default-related terms).
  function cleanResult(r) {
    if (r && Array.isArray(r.clauses)) r.clauses = r.clauses.filter((x) => x && CLAUSE_LABELS[x.key]);
    return r;
  }
  // Quietly retry hiccups (up to 4 tries) so the owner never has to.
  const RETRY_WAITS = [2000, 5000, 10000];
  async function runOne(c) {
    c.status = "running"; c.error = ""; c.tries = 0; renderCard(c);
    for (let attempt = 0; attempt <= RETRY_WAITS.length; attempt++) {
      try { c.result = cleanResult(await analyzeJob(c.job)); c.inp = inpFromResult(c.result); c.status = "done"; c.error = ""; break; }
      catch (err) {
        c.status = "error"; c.error = (err && err.message) || "We couldn't finish reading this contract.";
        if (!(err && err.retryable) || attempt === RETRY_WAITS.length) break;
        c.status = "running"; c.tries = attempt + 1; renderCard(c);
        await new Promise((res) => setTimeout(res, RETRY_WAITS[attempt]));
      }
    }
    if (c.status === "error") c.error = c.error.replace(/\s*Please (re)?try( again)?[^.]*\.?/gi, "").trim();
    renderCard(c); renderStack();
    if (c.status === "done" && unlocked) shareReport(c);
  }
  function retryContract(c) {
    setStatus("Retrying " + c.name + "…", false, true);
    runOne(c).then(() => {
      const failed = contracts.filter((x) => x.status === "error").length;
      setStatus(c.status === "done" ? "Done." : "We still couldn't read " + c.name + ". A clearer copy usually fixes it.", c.status !== "done" && failed > 0);
    });
  }

  analyzeBtn.addEventListener("click", async () => {
    const jobs = [];
    files.filter((f) => /pdf$/i.test(f.type)).forEach((f) => jobs.push({ name: f.name, files: [f] }));
    const imgs = files.filter((f) => /^image\//.test(f.type));
    if (imgs.length) jobs.push({ name: "Photos (" + imgs.length + " page" + (imgs.length > 1 ? "s" : "") + ")", files: imgs });
    if (!jobs.length) return;

    // Add to what's already on screen; only clear the sample report.
    if (contracts.some((c) => c.id === "sample")) { contracts = []; cardsEl.innerHTML = ""; }
    const room = MAX_CONTRACTS - contracts.length;
    if (room <= 0) { setStatus("You can check up to " + MAX_CONTRACTS + " contracts at a time. Reload the page to start over.", true); return; }
    const batchJobs = jobs.slice(0, room);
    $("sampleNote").classList.add("hidden");
    resultsWrap.classList.remove("hidden");
    const batch = batchJobs.map((j) => {
      const c = { id: Math.random().toString(36).slice(2), name: j.name, status: "pending", job: j, lead: unlockedLead, node: el("article", "panel contract contract-card") };
      cardsEl.appendChild(c.node); renderCard(c); contracts.push(c); return c;
    });
    files = []; renderFiles(); refreshButton();
    analyzeBtn.disabled = true;
    batch[0].node.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });

    const started = Date.now(); let done = 0;
    const tick = () => setStatus("Reviewing " + batch.length + " contract" + (batch.length > 1 ? "s" : "") + "… " + done + " of " + batch.length + " done", false, true);
    tick(); const timer = setInterval(tick, 1000);
    const queue = batch.slice();
    async function worker() { while (queue.length) { const c = queue.shift(); await runOne(c); done++; } }
    await Promise.all([worker(), worker()]);
    clearInterval(timer);
    const failed = batch.filter((c) => c.status === "error").length;
    setStatus("Finished in " + Math.round((Date.now() - started) / 1000) + "s" + (failed ? " · " + failed + " couldn't be read." : "") + (jobs.length > batchJobs.length ? " Only " + MAX_CONTRACTS + " contracts fit at once." : ""), failed > 0);
    refreshButton();
  });

  // ---------- From analysis to schedule inputs ----------
  function inpFromResult(r) {
    const m = r.money || {}, dsb = r.disbursement || {};
    const fees = (m.upfront_fees || []).reduce((s, f) => s + (num(f && f.amount) || 0), 0);
    let net = num(m.net_funded);
    if (net == null && num(m.purchase_price) != null) net = num(m.purchase_price) - fees;
    return {
      signed: ISO_RE.test(r.signed_date || "") ? r.signed_date : "",
      firstDate: ISO_RE.test(r.first_payment_date || "") ? r.first_payment_date : "",
      payback: num(m.purchased_amount), pmt: num(m.payment_amount),
      freq: FREQS.indexOf(m.payment_frequency) > -1 ? m.payment_frequency : "",
      weekday: WEEKDAYS[String(r.payment_weekday || "").toLowerCase()] || 5,
      structure: r.funding_structure === "reverse_consolidation" ? "reverse_consolidation" : "lump_sum",
      net, fees, price: num(m.purchase_price),
      disbFreq: dsb.frequency === "daily" ? "daily" : "weekly",
      disbSchedule: Array.isArray(dsb.schedule) ? dsb.schedule.map((x) => ({ date: ISO_RE.test((x && x.date) || "") ? x.date : "", amount: num(x && x.amount) })).filter((x) => x.amount > 0) : [],
      missed: 0
    };
  }
  function schedToText(list) { return (list || []).map((x) => (x.date ? x.date + "  " : "") + x.amount).join("\n"); }
  function textToSched(t) {
    return String(t || "").split(/\n+/).map((line) => {
      const dm = line.match(/(\d{4}-\d{2}-\d{2})/);
      const amount = num(line.replace(/\d{4}-\d{2}-\d{2}/, "").replace(/[$,\s]/g, ""));
      return { date: dm ? dm[1] : "", amount };
    }).filter((x) => x.amount > 0);
  }

  // ---------- Contract card ----------
  function field(label, id, value, type, onChange, opts) {
    const f = el("div", "field");
    const lab = el("label", null, label); lab.htmlFor = id;
    let input;
    if (type === "textarea") { input = document.createElement("textarea"); input.value = value == null ? "" : value; input.rows = Math.max(4, String(input.value).split("\n").length + 1); }
    else if (type === "select") {
      input = document.createElement("select");
      opts.forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; input.appendChild(o); });
      input.value = value == null ? "" : String(value);
    } else {
      input = document.createElement("input"); input.type = type;
      if (type === "number") { input.step = "any"; input.min = "0"; input.inputMode = "decimal"; }
      input.value = value == null ? "" : value;
    }
    input.id = id;
    input.addEventListener("change", () => onChange(input.value));
    f.append(lab, input);
    return f;
  }
  function tile(label, value, note, emph) {
    const t = el("div", "tile" + (emph ? " emph" : ""));
    t.append(el("div", "label", label), el("div", "value", value));
    if (note) t.append(el("div", "note", note));
    return t;
  }

  function renderCard(c) {
    const n = c.node; n.innerHTML = "";
    if (c.status === "pending" || c.status === "running") {
      n.append(el("div", "file-tag", c.name));
      const p = el("p", "placeholder"); p.append(el("span", "spinner"), document.createTextNode(c.status === "pending" ? "Waiting in line…" : c.tries ? "Still working on it…" : "Reading every page of your contract. Long contracts can take 1 to 2 minutes."));
      n.append(p); return;
    }
    if (c.status === "error") {
      n.append(el("div", "file-tag", c.name), el("p", "err", c.error));
      const rb = el("button", "secondary", "Read it again"); rb.type = "button";
      rb.addEventListener("click", () => retryContract(c));
      n.append(rb); return;
    }
    const r = c.result, inp = c.inp;
    if (!unlocked && c.id !== "sample") { renderTeaser(c); return; }

    const head = el("div", "head-row");
    const tw = el("div");
    tw.append(el("div", "file-tag", c.name), el("h2", null, (r.parties && r.parties.funder) || "Funder not identified"));
    if (r.parties && r.parties.merchant) tw.append(el("p", "sub", r.parties.merchant));
    const pills = el("div", "pills");
    const TYPE_LABELS = { merchant_cash_advance: "Merchant cash advance", reverse_consolidation: "Reverse consolidation", term_loan: "Business term loan", line_of_credit: "Line of credit", equipment_financing: "Equipment financing", other_financing: "Business financing" };
    const typeLabel = inp.structure === "reverse_consolidation" ? TYPE_LABELS.reverse_consolidation : TYPE_LABELS[r.agreement_type];
    if (typeLabel) pills.append(el("span", "pill " + (inp.structure === "reverse_consolidation" ? "medium" : "neutral"), typeLabel));
    const highs = (r.clauses || []).filter((x) => x.risk === "high").length;
    pills.append(el("span", "pill " + (highs ? "high" : "low"), highs + " high-risk term" + (highs === 1 ? "" : "s")));
    head.append(tw, pills);
    n.append(head);
    if (r.agreement_type === "not_financing") n.append(el("div", "banner", "This doesn't look like a financing agreement, so some numbers may be missing. Check that you uploaded the right document."));

    c.calcEl = el("div", "contract"); n.append(c.calcEl);

    const sum = el("div");
    sum.append(el("h3", null, "In plain English"), el("p", "summary-text", r.summary || ""));
    if (r.confidence_note) sum.append(el("p", "hint", r.confidence_note));
    n.append(sum);

    if ((r.red_flags || []).length) {
      const rf = el("div"); rf.append(el("h3", null, "Watch out for"));
      const ul = el("ul", "plain flags"); r.red_flags.forEach((t) => ul.append(el("li", null, String(t)))); rf.append(ul); n.append(rf);
    }

    const clauses = (r.clauses || []).slice().sort((a, b) => ((RISK_ORDER[a.risk] ?? 3) - (RISK_ORDER[b.risk] ?? 3)) || ((a.found ? 0 : 1) - (b.found ? 0 : 1)));
    const det = el("details", "more");
    det.append(el("summary", null, "What your contract says · " + clauses.length + " terms checked"));
    const list = el("div", "clauses");
    clauses.forEach((cl) => {
      const row = el("div", "clause " + (cl.risk || ""));
      const body = el("div");
      body.append(el("div", "name", CLAUSE_LABELS[cl.key] || cl.key));
      if (cl.summary) body.append(el("p", "desc", cl.summary));
      if (cl.quote) body.append(el("blockquote", null, "“" + cl.quote + "”" + (cl.page ? "  · p. " + cl.page : "")));
      const riskLabel = { high: "High risk", medium: "Watch", low: "Low risk" }[cl.risk] || "Unrated";
      const pill = el("span", "pill " + (cl.found ? (cl.risk || "absent") : "absent"), cl.found ? riskLabel : "Not found");
      if (!cl.found && cl.risk === "high") { pill.className = "pill high"; pill.textContent = "Missing"; }
      row.append(el("div", "stripe"), body, pill); list.append(row);
    });
    det.append(list); n.append(det);

    if ((r.owner_next_steps || []).length) {
      const ns = el("div"); ns.append(el("h3", null, "Options to look into"));
      const ul = el("ul", "plain"); r.owner_next_steps.forEach((t) => ul.append(el("li", null, String(t)))); ns.append(ul); n.append(ns);
    }

    // Adjust numbers (collapsed so it doesn't crowd the report)
    const adj = el("details", "more");
    adj.append(el("summary", null, "Something look off? Adjust the numbers"));
    const box = el("div", "inputs-box");
    box.append(el("p", "inputs-note", "These were read from your contract. Correct anything that's wrong and the balance, dates and APR update."));
    const grid = el("div", "field-grid");
    const pre = c.id + "-";
    const set = (k, cast) => (v) => { c.inp[k] = cast ? cast(v) : v; recalcCard(c); renderStack(); vis(); };
    grid.append(
      field("Signed / funded date", pre + "signed", inp.signed, "date", set("signed")),
      field("Total payback ($)", pre + "payback", inp.payback, "number", set("payback", num)),
      field("Payment ($)", pre + "pmt", inp.pmt, "number", set("pmt", num)),
      field("How often", pre + "freq", inp.freq, "select", set("freq"), [["", "Choose…"], ["daily", "Daily (business days)"], ["weekly", "Weekly"], ["biweekly", "Every 2 weeks"], ["monthly", "Monthly"]])
    );
    const wd = field("Weekly payment day", pre + "wd", inp.weekday, "select", set("weekday", (v) => +v), [["1", "Monday"], ["2", "Tuesday"], ["3", "Wednesday"], ["4", "Thursday"], ["5", "Friday"]]);
    const netF = field("Cash you received ($)", pre + "net", inp.net, "number", set("net", num));
    const missedF = field("Payments missed", pre + "missed", inp.missed, "number", set("missed", (v) => Math.max(0, Math.round(num(v) || 0))));
    const dF = field("Disbursed", pre + "dfreq", inp.disbFreq, "select", set("disbFreq"), [["weekly", "Weekly"], ["daily", "Daily (business days)"]]);
    const dS = field("Disbursement schedule (one amount per line)", pre + "dsched", schedToText(inp.disbSchedule), "textarea", set("disbSchedule", textToSched));
    dS.classList.add("wide");
    grid.append(wd, netF, missedF, dF, dS);
    function vis() {
      wd.classList.toggle("hidden", !(c.inp.freq === "weekly" || c.inp.freq === "biweekly"));
      const rev = c.inp.structure === "reverse_consolidation";
      netF.classList.toggle("hidden", rev); dF.classList.toggle("hidden", !rev); dS.classList.toggle("hidden", !rev);
    }
    vis();
    box.append(grid); adj.append(box); n.append(adj);

    recalcCard(c);
  }

  function renderTeaser(c) {
    const n = c.node, r = c.result, m = SCHED.metrics(c.inp, asOf);
    c.metrics = m;
    const highs = (r.clauses || []).filter((x) => x.risk === "high").length;
    const tw = el("div");
    tw.append(el("div", "file-tag", c.name), el("h2", null, (r.parties && r.parties.funder) || "Your agreement"));
    n.append(tw);
    const stated = num(r.stated_apr);
    const tiles = el("div", "tiles");
    tiles.append(
      tile("Still owed today", m.pays ? usd(m.owed) : "—", m.pays ? "if every payment cleared" : null, m.pays && m.owed > 0),
      tile(stated ? "APR" : "Estimated APR", stated ? (Math.round(stated * 10) / 10) + "%" : (m.apr ? Math.round(m.apr) + "%" : "—"), null, (stated || m.apr || 0) >= 60),
      tile("Terms that could hurt you", String(highs), null, highs > 0)
    );
    n.append(tiles);
    const lk = el("div", "locked");
    lk.append(el("strong", null, "Unlock to see the rest of your report:"),
      el("span", null, "Your payoff date and upcoming payments"),
      el("span", null, "Every contract term explained in plain English"),
      el("span", null, "Red flags and options to look into"));
    n.append(lk);
  }

  function recalcCard(c) {
    if (c.status !== "done" || !c.calcEl) return;
    const inp = c.inp, r = c.result, m = SCHED.metrics(inp, asOf);
    c.metrics = m;
    const box = c.calcEl; box.innerHTML = "";
    const rev = inp.structure === "reverse_consolidation";
    const tiles = el("div", "tiles");
    if (rev) tiles.append(tile("Paid to you so far", usd(m.disbToDate), m.disbTotal != null ? "of " + usd(m.disbTotal) + " scheduled" : null));
    else tiles.append(tile("Cash you received", usd(inp.net), inp.fees ? usd(inp.fees) + " in fees taken out" : null));
    const base = inp.price || (rev ? (m.disbTotal != null ? m.disbTotal + (inp.fees || 0) : null) : (inp.net != null ? inp.net + (inp.fees || 0) : null));
    const factor = num(r.money && r.money.factor_rate) || (inp.payback && base ? inp.payback / base : null);
    tiles.append(
      tile("You pay back", usd(inp.payback), factor ? "factor rate " + factor.toFixed(2) : null),
      tile("Payment", inp.pmt ? usd(inp.pmt) : "—", inp.freq || null),
      tile("Still owed today", m.pays ? usd(m.owed) : "—", m.pays ? "if every payment cleared" : "needs more details", m.pays && m.owed > 0),
      tile("Paid off on", m.payoff ? fmtShort(m.payoff) : "—"),
      tile(num(r.stated_apr) ? "APR" : "Estimated APR", num(r.stated_apr) ? (Math.round(num(r.stated_apr) * 10) / 10) + "%" : (m.apr ? Math.round(m.apr) + "%" : "—"), num(r.stated_apr) ? "as stated in the agreement" : (m.apr ? "yearly cost of this money" : null), (num(r.stated_apr) || m.apr || 0) >= 60)
    );
    box.append(tiles);
    if (!m.pays) { box.append(el("p", "hint", "We couldn't find the full payment terms. Open \"Adjust the numbers\" below to fill them in.")); return; }
    const fp = el("p", "sub");
    fp.textContent = "First payment " + fmtDate(m.firstPayment, true) + "." + (m.doubles ? " " + m.doubles + " double payment" + (m.doubles > 1 ? "s" : "") + " coming after bank holidays." : "");
    box.append(fp);

    const rows = [];
    m.pays.filter((p) => p.date > asOf).slice(0, 6).forEach((p) => rows.push({ date: p.date, out: p.amount, inn: null, note: p.note }));
    if (rev && m.disb) m.disb.filter((x) => x.date > asOf).forEach((x) => rows.push({ date: x.date, out: null, inn: x.amount, note: "" }));
    rows.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    const merged = [];
    rows.forEach((x) => { const p = merged[merged.length - 1]; if (p && p.date === x.date) { if (x.out != null) p.out = x.out; if (x.inn != null) p.inn = x.inn; if (x.note) p.note = x.note; } else merged.push(Object.assign({}, x)); });
    const shown = merged.slice(0, 6);
    if (shown.length) {
      const det = el("details", "more");
      det.append(el("summary", null, "Your next payments"));
      const wrap = el("div", "table-wrap"); const t = el("table", "sched");
      const hr = el("tr"); hr.append(el("th", null, "Date"), el("th", "num", "You pay")); if (rev) hr.append(el("th", "num", "Funder sends")); hr.append(el("th", null, ""));
      const thead = el("thead"); thead.append(hr); t.append(thead);
      const tb = el("tbody");
      shown.forEach((x) => {
        const tr = el("tr"); tr.append(el("td", null, fmtDate(x.date)), el("td", "num", x.out != null ? usd2(x.out) : ""));
        if (rev) tr.append(el("td", "num", x.inn != null ? usd2(x.inn) : ""));
        const td = el("td");
        if (x.note && x.note.indexOf("holiday") > -1) td.append(el("span", "tag-double", "Double (bank holiday)"));
        else if (x.note && x.note.indexOf("Moved from") === 0) td.append(el("span", "tag-moved", "Moved for holiday"));
        tr.append(td); tb.append(tr);
      });
      t.append(tb); wrap.append(t); det.append(wrap); box.append(det);
    }
  }

  // ---------- Debt health report (the preview) ----------
  let revenueOverride = null;
  const MONTHLY = { daily: 21.67, weekly: 4.333, biweekly: 2.167, monthly: 1 };
  const GRADES = [
    { max: 0.075, g: "A", color: "#2f9a5a", dx: "Healthy", text: "Your payments take a small share of your revenue. Your business has room to breathe." },
    { max: 0.15, g: "B", color: "#5c9a2f", dx: "Stable", text: "Payments are manageable, but keep an eye on adding more financing." },
    { max: 0.25, g: "C", color: "#c58a0a", dx: "Strained", text: "About a fifth of your revenue goes to payments. One slow month can make this tight." },
    { max: 0.40, g: "D", color: "#d9661f", dx: "Serious", text: "Payments are taking a large bite out of your revenue. There is little room left for other expenses." },
    { max: Infinity, g: "F", color: "#c62828", dx: "Critical", text: "Payments are eating a dangerous share of your revenue. Most of your sales are going to these payments." }
  ];
  function healthData(done) {
    let monthly = 0, owed = 0, aprW = 0, aprBase = 0, highs = 0, revenue = null, revSrc = "", revDate = "";
    done.forEach((c) => {
      const m = c.metrics || SCHED.metrics(c.inp, asOf), r = c.result;
      const active = !m.pays || m.owed > 0;
      if (active && c.inp.pmt && MONTHLY[c.inp.freq]) monthly += c.inp.pmt * MONTHLY[c.inp.freq];
      if (m.pays) owed += m.owed;
      const apr = num(r.stated_apr) || m.apr;
      if (apr && m.pays && m.owed > 0) { aprW += apr * m.owed; aprBase += m.owed; }
      highs += (r.clauses || []).filter((x) => x.risk === "high").length;
      const rev = num(r.stated_monthly_revenue);
      if (rev && rev > 0 && (!revDate || (c.inp.signed || "") > revDate)) { revenue = rev; revDate = c.inp.signed || "0"; revSrc = (r.parties && r.parties.funder) || c.name; }
    });
    const rev = revenueOverride || revenue;
    const ratio = rev ? monthly / rev : null;
    const grade = ratio == null ? null : GRADES.find((x) => ratio < x.max);
    return { monthly, owed, apr: aprBase ? aprW / aprBase : null, highs, revenue: rev, revSrc: revenueOverride ? "you" : revSrc, ratio, grade };
  }
  function svgEl(tag, attrs) { const e = document.createElementNS("http://www.w3.org/2000/svg", tag); Object.keys(attrs || {}).forEach((k) => e.setAttribute(k, attrs[k])); return e; }
  function vital(title, value, unit, note, color, drawing, level) {
    const v = el("div", "vital"); v.style.setProperty("--vc", color);
    const t = el("div", "vt"); t.append(el("span", null, title));
    if (level) t.append(el("span", "lvl", level));
    v.append(t, drawing);
    const vv = el("div", "vv", value); if (unit) vv.append(el("small", null, unit));
    v.append(vv, el("div", "vn", note));
    return v;
  }
  function ekg(bpm, color) {
    const svg = svgEl("svg", { viewBox: "0 0 240 70", preserveAspectRatio: "none", "aria-hidden": "true" });
    let d = "M0 40";
    for (let x = 0; x < 300; x += 60) d += " L" + (x + 18) + " 40 L" + (x + 22) + " 34 L" + (x + 26) + " 40 L" + (x + 30) + " 40 L" + (x + 33) + " 50 L" + (x + 37) + " 8 L" + (x + 41) + " 58 L" + (x + 45) + " 40 L" + (x + 50) + " 40 L" + (x + 55) + " 32 L" + (x + 60) + " 40";
    const g = svgEl("g", { class: "ekg-anim" }); g.style.setProperty("--beat", (60 / bpm).toFixed(2) + "s");
    g.append(svgEl("path", { d, class: "ekg-line" })); svg.append(g);
    return svg;
  }
  function thermo(tempF, color) {
    const svg = svgEl("svg", { viewBox: "0 0 240 70", "aria-hidden": "true" });
    const pct = Math.max(0.08, Math.min(1, (tempF - 97) / 8));
    svg.append(svgEl("rect", { x: 20, y: 26, width: 190, height: 16, rx: 8, fill: "#22383b" }));
    svg.append(svgEl("rect", { x: 20, y: 26, width: Math.max(18, 190 * pct), height: 16, rx: 8, fill: color }));
    svg.append(svgEl("circle", { cx: 22, cy: 34, r: 15, fill: color }));
    for (let i = 0; i <= 8; i++) svg.append(svgEl("line", { x1: 40 + i * 21, x2: 40 + i * 21, y1: 48, y2: 54, stroke: "#4d6b6e", "stroke-width": 1.5 }));
    return svg;
  }
  function gauge(frac, color) {
    const svg = svgEl("svg", { viewBox: "0 0 240 70", "aria-hidden": "true" });
    const cx = 120, cy = 66, r = 54, a0 = Math.PI, ang = a0 - Math.PI * Math.max(0, Math.min(1, frac));
    const arc = (from, to, col) => { const x1 = cx + r * Math.cos(from), y1 = cy - r * Math.sin(from), x2 = cx + r * Math.cos(to), y2 = cy - r * Math.sin(to); svg.append(svgEl("path", { d: "M" + x1 + " " + y1 + " A" + r + " " + r + " 0 0 1 " + x2 + " " + y2, stroke: col, "stroke-width": 10, fill: "none" })); };
    arc(Math.PI, Math.PI * 2 / 3, "#2f9a5a"); arc(Math.PI * 2 / 3, Math.PI / 3, "#c58a0a"); arc(Math.PI / 3, 0.001, "#c62828");
    svg.append(svgEl("line", { x1: cx, y1: cy, x2: cx + (r - 6) * Math.cos(ang), y2: cy - (r - 6) * Math.sin(ang), stroke: "#ffffff", "stroke-width": 3, "stroke-linecap": "round" }));
    svg.append(svgEl("circle", { cx, cy, r: 5, fill: "#ffffff" }));
    return svg;
  }
  function renderHealth(done) {
    const h = healthData(done), gr = h.grade;
    const col = gr ? gr.color : "#5d6870";
    const box = el("div", "health"); box.style.setProperty("--hc", col);
    const head = el("div", "health-head");
    const title = el("h2"); title.append(document.createTextNode("Financial Health Report"));
    const merchant = (done.find((c) => c.result.parties && c.result.parties.merchant) || { result: { parties: {} } }).result.parties.merchant;
    head.append(title, el("span", "chart-meta", (merchant ? merchant + " · " : "") + done.length + " agreement" + (done.length > 1 ? "s" : "") + " · " + fmtShort(asOf)));
    box.append(head);

    const top = el("div", "health-top");
    const g = el("div", "grade"); g.append(el("div", "letter", gr ? gr.g : "?"), el("div", "gl", "Health grade"));
    const dg = el("div", "diag");
    dg.append(el("h3", null, "Diagnosis"));
    if (gr) {
      dg.append(el("p", "dx", gr.dx + ": payments are " + Math.round(h.ratio * 100) + "% of your monthly revenue"), el("p", null, gr.text));
    } else {
      dg.append(el("p", "dx", "We need your monthly sales to grade this"), el("p", null, "Your contracts didn't list your revenue. Enter your average monthly sales to see your grade."));
    }
    const rr = el("div", "rev-row");
    rr.append(el("span", null, h.revenue ? "Monthly revenue used: " + usd(h.revenue) + (h.revSrc === "you" ? " (you entered)" : h.revSrc ? " (from your " + h.revSrc + " agreement)" : "") + ". Not right?" : "Monthly sales:"));
    const inp = document.createElement("input"); inp.type = "number"; inp.min = "0"; inp.inputMode = "decimal"; inp.placeholder = "e.g. 80000"; inp.id = "revInput"; inp.setAttribute("aria-label", "Average monthly sales");
    if (revenueOverride) inp.value = revenueOverride;
    inp.addEventListener("change", () => { const v = num(inp.value); revenueOverride = v && v > 0 ? v : null; renderStack(); });
    rr.append(inp);
    dg.append(rr);
    top.append(g, dg);
    box.append(top);

    const ratioPct = h.ratio != null ? h.ratio * 100 : null;
    const bpm = ratioPct != null ? Math.min(190, Math.round(62 + ratioPct * 2)) : 80;
    const bpmCol = !gr ? "#8fb3ae" : gr.g <= "B" ? "#39ff8a" : gr.g === "C" ? "#ffd23f" : "#ff5a4f";
    const temp = h.apr ? Math.min(105.5, 98.6 + h.apr / 50) : 98.6;
    const tCol = !h.apr ? "#8fb3ae" : h.apr < 30 ? "#39ff8a" : h.apr < 80 ? "#ffd23f" : "#ff5a4f";
    const sys = Math.min(200, 115 + h.highs * 12), dia = Math.min(120, 75 + h.highs * 7);
    const bpCol = h.highs <= 1 ? "#39ff8a" : h.highs <= 3 ? "#ffd23f" : "#ff5a4f";
    const vitals = el("div", "vitals");
    vitals.append(
      vital("Payment pressure", ratioPct != null ? Math.round(ratioPct) + "%" : "--", "of revenue", usd(h.monthly) + "/mo in payments", bpmCol, ekg(bpm, bpmCol), ratioPct == null ? "" : ratioPct < 15 ? "Low" : ratioPct < 25 ? "Elevated" : ratioPct < 40 ? "High" : "Critical"),
      vital("Cost of money", h.apr ? Math.round(h.apr) + "%" : "--", "APR", h.apr ? (done.length > 1 ? "Average across your agreements" : "Yearly cost of this money") : "APR not available", tCol, thermo(temp, tCol), !h.apr ? "" : h.apr < 30 ? "Low" : h.apr < 80 ? "Elevated" : h.apr < 150 ? "High" : "Critical"),
      vital("Contract risk", String(h.highs), "high-risk term" + (h.highs === 1 ? "" : "s"), "Terms in your contract" + (done.length > 1 ? "s" : "") + " that could hurt you", bpCol, gauge(h.highs / 6, bpCol), h.highs <= 1 ? "Low" : h.highs <= 3 ? "Elevated" : "High")
    );
    box.append(vitals);
    box.append(el("p", "health-note", "Vitals are a visual way to show your real numbers. Balance still owed today: " + usd(h.owed) + "."));
    return box;
  }

  // ---------- Combined + call to action ----------
  function renderStack() {
    const done = contracts.filter((c) => c.status === "done");
    stackEl.innerHTML = "";
    if (!done.length) { stackEl.classList.add("hidden"); return; }
    stackEl.classList.remove("hidden");
    stackEl.classList.add("health-wrap");
    stackEl.append(renderHealth(done));
    let weekly = 0, owed = 0, latest = null, highs = 0;
    done.forEach((c) => {
      const m = c.metrics || SCHED.metrics(c.inp, asOf);
      if (m.weekly) weekly += m.weekly;
      if (m.pays) { owed += m.owed; if (!latest || m.payoff > latest) latest = m.payoff; }
      highs += (c.result.clauses || []).filter((x) => x.risk === "high").length;
    });
    const isSampleOnly = done.every((c) => c.id === "sample");
    if (!unlocked && !isSampleOnly) { unlockEl.classList.remove("hidden"); return; }
    const tiles = el("div", "tiles"); tiles.style.marginTop = "16px";
    tiles.append(tile("Paying each week", usd(weekly), "daily payments counted as 5 days"), tile("Still owed today", usd(owed), null, owed > 0), tile("Last one paid off", latest ? fmtShort(latest) : "—"));
    stackEl.append(tiles);
    const cta = el("div", "cta-row");
    if (unlocked && !isSampleOnly) {
      // Unlocking already sent their info and reports; no second click needed.
      const first = ((unlockedLead && unlockedLead.name) || "").split(/\s+/)[0];
      const msg = el("p", "reach-out");
      msg.append(el("strong", null, (first ? "Thanks, " + first + ". " : "Thanks. ") + "Someone will reach out to you soon."));
      msg.append(document.createTextNode(" We'll go over your report and options for lowering these payments, free and with no obligation."));
      cta.append(msg); stackEl.append(cta); return;
    }
    cta.append(el("p", null, "Want someone to look at options for lowering these payments? It's free and there's no obligation."));
    const btn = el("button", "primary inline", "Request my free consultation");
    btn.type = "button";
    const isSample = done.some((c) => c.id === "sample");
    btn.addEventListener("click", async () => {
      if (isSample || !done[0].lead) { openLeadForm({ entry_point: "decoder_sample" }); return; }
      btn.disabled = true; btn.textContent = "Sending…";
      const l = done[0].lead;
      const ok = await sendToOwner(Object.assign({}, l, {
        type: "consultation_request", submitted_at: new Date().toISOString(), page: location.href,
        consent_share_text: SHARE_TEXT, consent_contact_text: "",
        funder: done.map((c) => (c.result.parties && c.result.parties.funder) || "unknown").join("; "),
        owed: Math.round(owed), summary: "Weekly payments " + usd(weekly) + " across " + done.length + " advance(s); " + highs + " high-risk terms.",
        report_text: done.map(reportText).join("\n\n----------\n\n"), files: []
      }));
      btn.textContent = ok ? "Request sent. We'll reach out soon." : "Couldn't send. Please call us.";
      if (!ok) btn.disabled = false;
    });
    cta.append(btn);
    stackEl.append(cta);
  }

  // ---------- Sample report ----------
  $("sampleBtn").addEventListener("click", () => {
    const ex = {
      is_mca_contract: true, parties: { merchant: "Sample Restaurant LLC", funder: "Sample Funding Group" },
      contract_type: "receivables_purchase", funding_structure: "lump_sum", signed_date: "2026-10-23",
      stated_monthly_revenue: 90000,
      money: { purchase_price: 50000, purchased_amount: 74500, factor_rate: 1.49, upfront_fees: [{ name: "Origination", amount: 2995 }], net_funded: 47005, payment_amount: 745, payment_frequency: "daily" },
      clauses: [
        { key: "security_interest_ucc", found: true, summary: "The funder files a UCC lien on your business receivables.", quote: "", page: 3, risk: "medium" },
        { key: "stacking_prohibition", found: true, summary: "You can't take another advance without the funder's written consent.", quote: "", page: 4, risk: "high" },
        { key: "prepayment_or_early_payoff", found: true, summary: "Paying early does not reduce the $74,500 you owe.", quote: "", page: 5, risk: "high" }
      ],
      red_flags: ["Paying early does not reduce what you owe.", "A $2,995 origination fee came out of your funding."],
      owner_next_steps: ["Compare the $74,500 you pay back with the $47,005 you actually received.", "Before taking another advance, add up all your daily payments against your daily deposits."],
      summary: "Sample report. You received about $47,000 and will pay back $74,500 at $745 every business day.",
      confidence_note: "This is a sample, not your contract."
    };
    contracts = []; cardsEl.innerHTML = ""; unlockEl.classList.add("hidden");
    const c = { id: "sample", name: "sample-contract.pdf", status: "done", result: ex, inp: inpFromResult(ex), node: el("article", "panel contract contract-card") };
    contracts.push(c); cardsEl.appendChild(c.node); renderCard(c); renderStack();
    resultsWrap.classList.remove("hidden"); $("sampleNote").classList.remove("hidden");
    resultsWrap.scrollIntoView({ behavior: "auto", block: "start" });
  });

  // ---------- Quick estimate (no contract) ----------
  const qeDialog = $("quick"), qeRows = $("qeRows"), qeOut = $("qeOut");
  function addQeRow() {
    if (qeRows.children.length >= 8) return;
    const i = qeRows.children.length + 1;
    const row = el("div", "qe-row");
    const id = "qe" + Date.now() + i;
    row.innerHTML =
      '<div class="field"><label for="' + id + 'p">Payment ($)</label><input id="' + id + 'p" type="number" min="0" step="any" inputmode="decimal" placeholder="e.g. 450"></div>' +
      '<div class="field"><label for="' + id + 'f">How often</label><select id="' + id + 'f"><option value="daily">Daily</option><option value="weekly">Weekly</option></select></div>' +
      '<div class="field"><label for="' + id + 'b">About how much is left ($)</label><input id="' + id + 'b" type="number" min="0" step="any" inputmode="decimal" placeholder="e.g. 30000"></div>';
    const rm = el("button", "link-btn", "Remove"); rm.type = "button";
    rm.addEventListener("click", () => { row.remove(); calcQe(); });
    row.append(rm);
    row.addEventListener("input", calcQe);
    qeRows.append(row);
  }
  function calcQe() {
    const rows = Array.from(qeRows.children).map((r) => { const ins = r.querySelectorAll("input,select"); return { pmt: num(ins[0].value), freq: ins[1].value, bal: num(ins[2].value) }; }).filter((x) => x.pmt > 0);
    const rev = num($("qeRevenue").value);
    qeOut.innerHTML = "";
    if (!rows.length) { qeOut.append(el("p", "hint", "Add at least one payment to see your numbers.")); return null; }
    let weekly = 0, owed = 0, latest = null;
    rows.forEach((x) => {
      weekly += x.freq === "daily" ? x.pmt * 5 : x.pmt;
      if (x.bal > 0) {
        owed += x.bal;
        const s = SCHED.payments({ signed: asOf, payback: x.bal, pmt: x.pmt, freq: x.freq, weekday: 5 });
        if (s && s.length) { const end = s[s.length - 1].date; if (!latest || end > latest) latest = end; }
      }
    });
    const monthly = weekly * 52 / 12;
    const tiles = el("div", "tiles");
    tiles.append(
      tile("Paying each week", usd(weekly)),
      tile("Paying each month", usd(monthly)),
      tile("Still owed", owed ? usd(owed) : "—"),
      tile("Last one paid off", latest ? fmtShort(latest) : "—", latest ? "if nothing changes" : null)
    );
    if (rev > 0) tiles.append(tile("Share of your sales", Math.round(monthly / rev * 100) + "%", "of monthly revenue", monthly / rev > 0.2));
    qeOut.append(tiles);
    return { rows: rows.length, weekly, owed, monthly, rev };
  }
  $("quickOpen").addEventListener("click", (e) => { e.preventDefault(); if (!qeRows.children.length) addQeRow(); calcQe(); qeDialog.showModal(); });
  $("qeAdd").addEventListener("click", () => { addQeRow(); });
  $("qeRevenue").addEventListener("input", calcQe);
  $("qeClose").addEventListener("click", () => qeDialog.close());
  $("qeLead").addEventListener("click", () => {
    const r = calcQe() || {};
    qeDialog.close();
    openLeadForm({ entry_point: "quick_estimate", advances: String(r.rows || 0), weekly_payments: String(Math.round(r.weekly || 0)), total_owed: String(Math.round(r.owed || 0)), monthly_revenue: r.rev ? String(Math.round(r.rev)) : "" });
  });

  refreshButton();
})();
