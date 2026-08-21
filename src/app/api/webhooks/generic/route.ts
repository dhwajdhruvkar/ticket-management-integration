import { NextResponse } from "next/server";
import { currentTenantId } from "@/server/context";
import { intakeTicket } from "@/server/services/intake";
import { AdapterError, normalizeGeneric } from "@/server/channels/webhookAdapters";
import { verifyWebhookRequest } from "@/server/channels/webhookSecurity";
import { clientKey, rateLimit } from "@/server/rateLimit";
import { readTextBody } from "@/server/http";

// =============================================================================
// POST /api/webhooks/generic
//
// For internal systems / scripts. Requests are HMAC-verified
// (x-webhook-signature over "<timestamp>.<rawBody>", secret WEBHOOK_SECRET),
// rate limited per IP, then pushed through the unified server intake pipeline
// (classification, SLA, group routing, automations, AI triage).
//
// Expected body:
//   {
//     "subject":   "I forgot my password",
//     "body":      "I can't log in this morning. Please help.",
//     "requester": "user@example.com",
//     "priority":  "medium",         // optional: critical | high | medium | low | very_low
//     "category":  "IT",             // optional
//     "channel":   "api",            // optional: email | portal | chat | phone | api
//     "tags":      ["password"]      // optional
//   }
// =============================================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!rateLimit(clientKey(req, "webhook"), 60, 60_000)) {
    return NextResponse.json({ ok: false, error: "Rate limit exceeded." }, { status: 429 });
  }

  const rawBody = await readTextBody(req);
  if (rawBody instanceof NextResponse) return rawBody;
  const verdict = verifyWebhookRequest("generic", req, rawBody);
  if (!verdict.ok) {
    return NextResponse.json({ ok: false, source: "generic", error: verdict.reason }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  try {
    const input = normalizeGeneric(payload);
    const tenantId = await currentTenantId(req);
    const ticket = await intakeTicket(tenantId, input);
    return NextResponse.json({ ok: true, source: "generic", reference: ticket.reference, id: ticket.id });
  } catch (err) {
    const message = err instanceof AdapterError ? err.message : "Failed to ingest payload.";
    return NextResponse.json({ ok: false, source: "generic", error: message }, { status: 400 });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    source: "generic",
    message: "POST a JSON body with { subject, body, requester } at minimum.",
  });
}
