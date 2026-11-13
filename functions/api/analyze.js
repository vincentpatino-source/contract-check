// Cloudflare Pages Function: POST /api/analyze
// Receives one contract (extracted text and/or page images), asks Claude to decode it, returns JSON.
// Nothing is stored. Add ANTHROPIC_API_KEY as a Secret in Cloudflare: your Pages project > Settings > Variables and Secrets.

const MAX_TEXT = 200000;
const MAX_IMAGES = 15;
const MAX_IMAGE_B64 = 1500000;

const CLAUSE_KEYS = [
  "reconciliation", "personal_guarantee", "confession_of_judgment", "security_interest_ucc",
  "processor_or_account_change_default", "stacking_prohibition", "events_of_default",
  "default_fees_and_penalties", "prepayment_or_early_payoff", "arbitration_venue_jury_waiver",
  "cross_default", "true_sale_language"
];

// Best-effort limiter per warm instance. Also set a monthly spend limit in the Anthropic Console.
const hits = new Map();
function limited(ip) {
  const now = Date.now(), windowMs = 10 * 60 * 1000, max = 12;
  const list = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(ip, list);
  return list.length > max;
}

function buildPrompt(hasImages, contractText) {
  return [
    "You review merchant cash advance (MCA) agreements for small business owners. Read the contract " + (hasImages ? "page images" : "text") + " and return ONLY a JSON object, no prose, no code fences, in this shape:",
    "{",
    '  "is_mca_contract": boolean,',
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
    "- signed_date: the date the merchant signed or the agreement's effective/funding date. null if not shown.",
    "- first_payment_date and payment_weekday: fill ONLY if the contract explicitly states them. Otherwise null.",
    "- funding_structure: \"reverse_consolidation\" when the funder pays the merchant in installments instead of one lump sum. Then fill disbursement.schedule with EVERY disbursement listed in the contract's disbursement schedule (usually a table near the end), in order, with its exact amount and its date if given. Amounts usually decrease over time. Fees are already reflected in the total paid to the merchant, so never subtract fees from a disbursement yourself.",
    "- Include exactly one clauses entry for each key: " + CLAUSE_KEYS.join(", ") + ". Absent clause: found=false, quote=\"\", short explanation in summary.",
    "- quote: at most 30 words copied verbatim, or \"\". Never invent text.",
    "- risk is risk to the business owner. An existing reconciliation right is low risk; a missing one is high risk.",
    "- Money values are plain dollar numbers. specified_percentage is a percent (12 means 12%). net_funded = purchase price minus fees withheld, if stated or computable. Use null when not stated; never guess.",
    "- red_flags: up to 5, most serious first, one plain sentence each.",
    "- owner_next_steps: 3-4 short, general, educational options written to the owner (for example, how reconciliation works if their contract has it, or questions to ask before signing another advance). Never promise outcomes, never advise stopping or skipping payments, never call anything illegal, never give legal advice.",
    "- summary: 3-5 short plain-English sentences written to the owner. confidence_note: one sentence on unreadable parts or uncertain figures.",
    "- If this is not an MCA or financing agreement, set is_mca_contract=false and explain in summary.",
    "",
    contractText ? "CONTRACT TEXT:\n" + contractText : "The contract pages are attached as images, in order."
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

  let body;
  try { body = await request.json(); } catch (e) { return json(400, { error: "Couldn't read the upload. Please try again." }); }
  const text = typeof body.text === "string" ? body.text.slice(0, MAX_TEXT) : "";
  const images = Array.isArray(body.images) ? body.images.filter((s) => typeof s === "string" && s.length <= MAX_IMAGE_B64).slice(0, MAX_IMAGES) : [];
  if (!text.trim() && !images.length) return json(400, { error: "No contract text or pages received." });

  const content = images.map((data) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } }));
  content.push({ type: "text", text: buildPrompt(images.length > 0, text.trim()) });

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: env.ANTHROPIC_MODEL || "claude-sonnet-5-5", max_tokens: 6000, messages: [{ role: "user", content }] })
    });
    if (r.status === 429) return json(429, { error: "We're busy right now. Please try again in a minute." });
    if (!r.ok) { console.error("Anthropic error", r.status, (await r.text()).slice(0, 500)); return json(502, { error: "The review service had a problem. Please try again." }); }
    const data = await r.json();
    const out = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    try { return json(200, { result: parseJson(out) }); }
    catch (e) { return json(502, { error: "The review came back unreadable. Please try again." }); }
  } catch (err) {
    console.error(err);
    return json(500, { error: "Something went wrong. Please try again." });
  }
}

export function onRequestGet() { return json(405, { error: "Use POST." }); }
