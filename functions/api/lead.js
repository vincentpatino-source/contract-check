// Cloudflare Pages Function: POST /api/lead
// Forwards a report copy or consultation request to the DebtMedx Google Apps Script,
// which writes it to the "Reports" tab of the leads sheet, saves files to Drive and emails the owner.
// Set SHEET_WEBHOOK_URL (the Apps Script web app URL, including ?token=...) as a Secret in Cloudflare.

const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

export async function onRequestPost({ request, env }) {
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const origin = request.headers.get("origin") || "";
  if (allowed.length && origin && !allowed.includes(origin)) return json(403, { error: "Not allowed." });
  if (!env.SHEET_WEBHOOK_URL) return json(503, { error: "Lead storage isn't set up yet." });

  const body = await request.text();
  if (!body || body.length > 14000000) return json(413, { error: "Upload too large." });

  try {
    const r = await fetch(env.SHEET_WEBHOOK_URL, { method: "POST", headers: { "content-type": "application/json" }, body, redirect: "follow" });
    const text = await r.text();
    const ok = r.ok && text.indexOf('"ok":true') > -1;
    if (!ok) console.error("Sheet webhook failed", r.status, text.slice(0, 300));
    return json(ok ? 200 : 502, { ok });
  } catch (err) {
    console.error(err);
    return json(502, { ok: false });
  }
}

export function onRequestGet() { return json(405, { error: "Use POST." }); }
