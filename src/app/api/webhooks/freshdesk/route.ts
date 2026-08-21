import { NextResponse } from "next/server";
import { currentTenantId } from "@/server/context";
import { intakeTicket } from "@/server/services/intake";
import { AdapterError, normalizeFreshdesk } from "@/server/channels/webhookAdapters";
import { verifyWebhookRequest } from "@/server/channels/webhookSecurity";
import { clientKey, rateLimit } from "@/server/rateLimit";
import { readTextBody } from "@/server/http";

// =============================================================================
// POST /api/webhooks/freshdesk
//
// Freshdesk Automator webhook. Requests are HMAC-verified (x-webhook-signature
// over "<timestamp>.<rawBody>", secret from FRESHDESK_WEBHOOK_SECRET /
// WEBHOOK_SECRET), rate limited per IP, then normalized and pushed through the
// unified server intake pipeline.
// =============================================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!rateLimit(clientKey(req, "webhook"), 60, 60_000)) {
    return NextResponse.json({ ok: false, error: "Rate limit exceeded." }, { status: 429 });
  }

  const rawBody = await readTextBody(req);
  if (rawBody instanceof NextResponse) return rawBody;
  const verdict = verifyWebhookRequest("freshdesk", req, rawBody);
  if (!verdict.ok) {
    return NextResponse.json({ ok: false, source: "freshdesk", error: verdict.reason }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  try {
    const input = normalizeFreshdesk(payload);
    const tenantId = await currentTenantId(req);
    const ticket = await intakeTicket(tenantId, input);
    return NextResponse.json({ ok: true, source: "freshdesk", reference: ticket.reference, id: ticket.id });
  } catch (err) {
    const message = err instanceof AdapterError ? err.message : "Failed to ingest payload.";
    return NextResponse.json({ ok: false, source: "freshdesk", error: message }, { status: 400 });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    source: "freshdesk",
    message: "POST a Freshdesk webhook payload under the freshdesk_webhook key.",
  });
}
