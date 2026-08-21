import { NextResponse } from "next/server";
import { config } from "@/server/config";
import { ingestBrevoPayload } from "@/server/channels/brevoEmail";
import { clientKey, rateLimit } from "@/server/rateLimit";
import { readTextBody } from "@/server/http";

// =============================================================================
// POST /api/webhooks/brevo
//
// Brevo Inbound Parsing endpoint. Only active when EMAIL_PROVIDER resolves to
// "brevo" (the switch truly disables it otherwise). Brevo Inbound Parsing has
// no HMAC signature, so requests authenticate with a shared secret
// (BREVO_INBOUND_SECRET) presented as ?token= or the x-brevo-secret header;
// unsigned requests are accepted only in demo mode. The payload is mapped and
// pushed through the unified ingestion pipeline.
// =============================================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: Request, url: URL): boolean {
  const secret = config.brevo.inboundSecret;
  if (!secret) return config.demoMode; // open in demo, rejected in production
  const presented = url.searchParams.get("token") ?? req.headers.get("x-brevo-secret") ?? "";
  return presented === secret;
}

export async function POST(req: Request) {
  if (!rateLimit(clientKey(req, "webhook"), 60, 60_000)) {
    return NextResponse.json({ ok: false, error: "Rate limit exceeded." }, { status: 429 });
  }

  if (config.emailProvider !== "brevo") {
    return NextResponse.json(
      { ok: false, source: "brevo", error: "Brevo is not the active email provider (EMAIL_PROVIDER)." },
      { status: 503 }
    );
  }

  const url = new URL(req.url);
  if (!authorized(req, url)) {
    return NextResponse.json(
      { ok: false, source: "brevo", error: "Invalid or missing inbound secret." },
      { status: 401 }
    );
  }

  const rawBody = await readTextBody(req);
  if (rawBody instanceof NextResponse) return rawBody;

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const { processed } = await ingestBrevoPayload(payload);
    return NextResponse.json({ ok: true, source: "brevo", processed });
  } catch (err) {
    return NextResponse.json(
      { ok: false, source: "brevo", error: err instanceof Error ? err.message : "Failed to ingest payload." },
      { status: 400 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    source: "brevo",
    message:
      "POST Brevo Inbound Parsing payloads (items[]) here. Authenticate with ?token= or the x-brevo-secret header. Active only when EMAIL_PROVIDER=brevo.",
  });
}
