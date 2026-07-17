import { NextResponse } from "next/server";
import { currentTenantId } from "@/server/context";
import { intakeTicket } from "@/server/services/intake";
import { AdapterError, normalizeZendesk } from "@/server/channels/webhookAdapters";
import { verifyWebhookRequest } from "@/server/channels/webhookSecurity";
import { clientKey, rateLimit } from "@/server/rateLimit";

// =============================================================================
// POST /api/webhooks/zendesk
//
// Zendesk "Ticket Created" trigger webhook. Requests are HMAC-verified
// (x-webhook-signature over "<timestamp>.<rawBody>", secret from
// ZENDESK_WEBHOOK_SECRET / WEBHOOK_SECRET), rate limited per IP, then
// normalized and pushed through the unified server intake pipeline.
// =============================================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!rateLimit(clientKey(req, "webhook"), 60, 60_000)) {
    return NextResponse.json({ ok: false, error: "Rate limit exceeded." }, { status: 429 });
  }

  const rawBody = await req.text();
  const verdict = verifyWebhookRequest("zendesk", req, rawBody);
  if (!verdict.ok) {
    return NextResponse.json({ ok: false, source: "zendesk", error: verdict.reason }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  try {
    const input = normalizeZendesk(payload);
    const tenantId = await currentTenantId(req);
    const ticket = await intakeTicket(tenantId, input);
    return NextResponse.json({ ok: true, source: "zendesk", reference: ticket.reference, id: ticket.id });
  } catch (err) {
    const message = err instanceof AdapterError ? err.message : "Failed to ingest payload.";
    return NextResponse.json({ ok: false, source: "zendesk", error: message }, { status: 400 });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    source: "zendesk",
    message: "POST a Zendesk trigger payload shaped as { ticket: { subject, description, requester } }.",
  });
}
