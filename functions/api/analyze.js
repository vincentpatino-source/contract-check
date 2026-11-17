// Cloudflare Pages Function: POST /api/analyze
// Receives one contract (the original PDF, or extracted text and/or page photos), asks Claude to decode it, returns JSON.
// Large uploads are passed through as strings, not parsed, to stay within the free plan's CPU limit.
// Nothing is stored. Add ANTHROPIC_API_KEY as a Secret in Cloudflare: your Pages project > Settings > Variables and Secrets.

const MAX_TEXT = 200000;
const MAX_IMAGES = 15;
const MAX_IMAGE_B64 = 2500000;

const CLAUSE_KEYS = [
  "total_payback", "upfront_fees", "hidden_fees", "secured_by", "reconciliation", "bankruptcy_prohibition", "prepayment_or_early_payoff", "stacking_prohibition"
];

// Best-effort limiter per warm instance. Also set a monthly spend limit in the Anthropic Console.
const hits = new Map();
function limited(ip) {
  const now = Date.now(), windowMs = 10 * 60 * 1000, max = 40;
  const list = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(ip, list);
  return list.length > max;
}

function buildPrompt(hasImages, contractText, isPdf) {
  return [
    "You review small business financing agreements (merchant cash advances, reverse consolidations, business term loans, lines of credit, equipment financing and similar) for business owners. Read the contract " + (isPdf ? "PDF" : hasImages ? "page images" : "text") + " and return ONLY a JSON object, no prose, no code fences, in this shape:",
    "{",
    '  "is_mca_contract": boolean,',
    '  "agreement_type": "merchant_cash_advance" | "reverse_consolidation" | "term_loan" | "line_of_credit" | "equipment_financing" | "other_financing" | "not_financing",',
    '  "stated_apr": number|null,',
    '  "stated_monthly_revenue": number|null,',
    '  "revenue_quote": string,',
    '  "parties": {"merchant": string|null, "funder": string|null, "guarantors": [string]},',
    '  "contract_type": "receivables_purchase" | "loan" | "other" | "unclear",',
    '  "funding_structure": "lump_sum" | "reverse_consolidation" | "unclear",',
    '  "signed_date": "YYYY-MM-DD" | null,',
    '  "first_payment_date": "YYYY-MM-DD" | null,',
    '  "payment_weekday": "monday"|"tuesday"|"wednesday"|"thursday"|"friday"|null,',
    '  "disbursement": {"frequency": "daily"|"weekly"|null, "schedule": [{"number": number, "date": "YYYY-MM-DD"|null, "amount": number}], "total": number|null},',
    '  "money": {"purchase_price": number|null, "purchased_amount": number|null, "factor_rate": number|null, "upfront_fees": [{"name": string, "amount": number}], "net_funded": number|null, "payment_amount": number|null, "payment_frequency": "daily"|"weekly"|"biweekly"|"monthly"|"other"|null, "specified_percentage": number|null, "collection_method": "ach"|"split"|"lockbox"|"other"|null},',
    '  "clauses": [{"key": string, "found": boolean, "summary": string, "quote": string, "page": number|null, "risk": "low"|"medium"|"high"}],',
    '  "red_flags": [string],',
    '  "owner_next_steps": [string],',
    '  "summary": string,',
    '  "confidence_note": string',
    "}",
    "",
    "Rules:",
    "- Read every page, including fine print, footnotes, small type, addenda, exhibits, schedules and signature pages. Payment terms, fees and the disbursement schedule are often in an addendum or exhibit near the end.",
    "- signed_date: the date the merchant signed or the agreement's effective/funding date. null if not shown.",
    "- first_payment_date and payment_weekday: fill ONLY if the contract explicitly states them. Otherwise null.",
    "- funding_structure: \"reverse_consolidation\" when the funder pays the merchant in installments instead of one lump sum. Then fill disbursement.schedule with EVERY disbursement listed in the contract's disbursement schedule (usually a table near the end), in order, with its exact amount and its date if given. Amounts usually decrease over time. Fees are already reflected in the total paid to the merchant, so never subtract fees from a disbursement yourself.",
    "- Include exactly one clauses entry for each key: " + CLAUSE_KEYS.join(", ") + ". Absent clause: found=false, quote=\"\", short explanation in summary.",
    "- quote: at most 30 words copied verbatim, or \"\". Never invent text.",
    "- risk is risk to the business owner.",
    "- Money values are plain dollar numbers. specified_percentage is a percent (12 means 12%). net_funded = purchase price minus fees withheld, if stated or computable. Use null when not stated; never guess.",
    "- red_flags: up to 5, most serious first, one plain sentence each.",
    "- Never mention default, events of default, default fees or penalties, cross-default, acceleration, confession of judgment, collections, lawsuits, judgments, liens being enforced, or any other consequence of missing or stopping payments, anywhere in the output (summary, clause summaries, quotes, red_flags, owner_next_steps, confidence_note), except in the reconciliation and bankruptcy_prohibition clauses as described below. Describe each term only as what the contract requires, allows or costs. Also never mention personal guarantees or guarantors, arbitration, venue, jury waivers, or rules about changing banks or card processors.",
    "- owner_next_steps: 3-4 short, general, educational options written to the owner (for example, questions to ask before signing another advance, or how to compare total payback against what they received). Never promise outcomes, never advise stopping or skipping payments, never call anything illegal, never give legal advice.",
    "- summary: 3-5 short plain-English sentences written to the owner. confidence_note: one sentence on unreadable parts or uncertain figures.",
    "- stated_monthly_revenue: the business's monthly revenue, sales, deposits or receivables as stated anywhere in the agreement, application or underwriting pages (e.g. 'average monthly revenue', 'monthly gross sales', 'average monthly deposits'). If only an annual figure is given, divide it by 12. null if no figure is stated. revenue_quote: up to 20 words copied verbatim where you found it, or \"\".",
    "- Term loans, lines of credit and other business financing are fully supported: never treat them as an error. Map their terms onto the same fields: purchase_price = loan amount or amount financed, purchased_amount = total of all scheduled payments (total repayment), upfront_fees = origination and other fees, payment_amount and payment_frequency = the scheduled loan payment. stated_apr = the APR printed in the agreement or disclosure, if any, else null. contract_type = \"loan\" for loans and credit lines.",
    "- Clause guidance. Every clause entry must be accurate to this contract; never state anything the contract does not support.",
    "  total_payback: found=true. Say what the owner pays back in total versus what they actually received (net of fees), and the difference in dollars. risk: low if total payback is under 1.25x the amount received, medium under 1.40x, else high.",
    "  upfront_fees: every fee taken out before the money reached the owner (origination, underwriting, closing, due diligence, wire), with amounts and the total. found=false if none. risk: low under 3% of the funded amount, medium under 8%, else high.",
    "  hidden_fees: costs that are easy to miss: broker or ISO commissions built into the cost, and ongoing charges during the term (monthly, administrative, servicing, ACH or bank transfer, renewal or refinance fees). Do not include fees that only apply after missed or returned payments. found=false if none are listed. risk: medium if any recurring charge or built-in broker fee, else low.",
    "  stacking_prohibition: say whether the contract restricts taking other advances or financing. If the contract or its attachments show the funder knew of other existing advances or loans (for example, existing positions listed in the application, or funds used to pay off another funder), say so plainly.",
    "  reconciliation: say whether the contract lets the owner ask for payments based on actual sales, and what it requires (requests, documents, deadlines, who decides). Focus on the catch: funders often add a default fee automatically when a reconciled or reduced payment is made, so say plainly whether using reconciliation, missing a step in it, or paying a reduced amount during it can be treated as a breach or default that triggers default fees or other added charges, and quote that language if present. If there is no reconciliation clause, found=false. risk: high if reconciliation can trigger a default or default fees, or is entirely at the funder's discretion; medium if it has burdensome conditions; low otherwise.",
    "  bankruptcy_prohibition: say whether the contract prohibits or restricts the business or owner from filing bankruptcy, makes filing a breach or default, adds fees or makes the full balance due on filing, or lets the funder keep collecting from the business or guarantor if the business files. Add that, in general, advance agreements not to file bankruptcy are treated by courts as unenforceable against public policy. found=false if the contract has none of this. risk: high if any such term is present, else low.",
    "  secured_by: what the agreement says backs the funding. For merchant cash advances and reverse consolidations, explain in plain words that the agreement is written as a purchase of the business's future receivables (future sales) starting from the date it was signed, not as a loan; that because it isn't a loan it generally isn't subject to the interest-rate limits that apply to loans, which is how the cost can be so high even though the contract never calls it interest; and what the contract lists as the funder's security, which is usually the future receivables (if the contract also lists other business assets, say so accurately). For loans, say it is a loan and describe any collateral listed. Never mention personal guarantees or guarantors. risk: medium for merchant cash advances and reverse consolidations; for loans, low if unsecured, else medium.",
    "- is_mca_contract = true only for merchant cash advances and reverse consolidations. If the document is not a financing agreement at all, set agreement_type=\"not_financing\" and explain in summary.",
    "",
    isPdf ? "The contract is attached as a PDF document." : contractText ? "CONTRACT TEXT:\n" + contractText : "The contract pages are attached as images, in order."
  ].join("\n");
}

function parseJson(text) {
  const cleaned = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = cleaned.indexOf("{"), end = cleaned.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("no json");
  return JSON.parse(cleaned.slice(start, end + 1));
}

const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

export async function onRequestPost({ request, env }) {
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const origin = request.headers.get("origin") || "";
  if (allowed.length && origin && !allowed.includes(origin)) return json(403, { error: "Not allowed." });
  if (!env.ANTHROPIC_API_KEY) return json(500, { error: "The site isn't set up yet: missing API key." });

  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (limited(ip)) return json(429, { error: "Too many reviews from this connection. Please wait a few minutes." });

  const model = env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
  const safeB64 = (b) => typeof b === "string" && b.length > 0 && b.indexOf('"') === -1 && b.indexOf("\\") === -1;
  let payload;
  if ((request.headers.get("x-doc-type") || "") === "pdf") {
    // Body is the PDF as base64 text. Build the API request by string, so the large file is never parsed.
    const b64 = (await request.text()).trim();
    if (b64.length > 30000000) return json(413, { error: "This PDF is too large. Try a smaller file or photos of the pages." });
    if (!safeB64(b64)) return json(400, { error: "Couldn't read the upload." });
    payload = '{"model":' + JSON.stringify(model) + ',"max_tokens":8000,"stream":true,"messages":[{"role":"user","content":[' +
      '{"type":"document","source":{"type":"base64","media_type":"application/pdf","data":"' + b64 + '"}},' +
      '{"type":"text","text":' + JSON.stringify(buildPrompt(false, "", true)) + '}]}]}';
  } else {
    let body;
    try { body = await request.json(); } catch (e) { return json(400, { error: "Couldn't read the upload." }); }
    const text = typeof body.text === "string" ? body.text.slice(0, MAX_TEXT) : "";
    const images = Array.isArray(body.images) ? body.images.filter((x) => safeB64(x) && x.length <= MAX_IMAGE_B64).slice(0, MAX_IMAGES) : [];
    if (!text.trim() && !images.length) return json(400, { error: "No contract text or pages received." });
    const parts = images.map((d) => '{"type":"image","source":{"type":"base64","media_type":"image/jpeg","data":"' + d + '"}}');
    parts.push('{"type":"text","text":' + JSON.stringify(buildPrompt(images.length > 0, text.trim(), false)) + '}');
    payload = '{"model":' + JSON.stringify(model) + ',"max_tokens":8000,"stream":true,"messages":[{"role":"user","content":[' + parts.join(",") + ']}]}';
  }

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: payload
    });
    if (r.status === 429) return json(429, { error: "We're busy right now." });
    if (!r.ok) {
      const detail = (await r.text()).slice(0, 500);
      console.error("Anthropic error", r.status, detail);
      if (r.status === 413 || /too (large|long)|exceed/i.test(detail)) return json(413, { error: "This contract is too large to review in one pass. Try uploading it in smaller parts." });
      return json(502, { error: "The review service had a problem." });
    }
    // Stream the AI's answer straight through so the connection never sits idle on long contracts.
    return new Response(r.body, { status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-cache", "x-accel-buffering": "no" } });
  } catch (err) {
    console.error(err);
    return json(500, { error: "Something went wrong." });
  }
}

export function onRequestGet() { return json(405, { error: "Use POST." }); }
