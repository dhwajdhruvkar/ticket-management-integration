import { NextResponse } from "next/server";
import {
  handleSlackEvent,
  handleSlackSlashCommand,
  verifySlackRequest,
} from "@/server/channels/slack";
import { clientKey, rateLimit } from "@/server/rateLimit";
import { readTextBody } from "@/server/http";

// =============================================================================
// POST /api/webhooks/slack
//
// Single endpoint for the Slack app's Events API subscription AND slash
// command. Requests are verified with Slack's v0 signing scheme
// (SLACK_SIGNING_SECRET); unsigned requests are accepted only in demo mode.
// =============================================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!rateLimit(clientKey(req, "webhook"), 60, 60_000)) {
    return NextResponse.json({ ok: false, error: "Rate limit exceeded." }, { status: 429 });
  }

  const rawBody = await readTextBody(req);
  if (rawBody instanceof NextResponse) return rawBody;
  const verdict = verifySlackRequest(req, rawBody);
  if (!verdict.ok) {
    return NextResponse.json({ ok: false, source: "slack", error: verdict.reason }, { status: 401 });
  }

  const contentType = req.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const result = await handleSlackSlashCommand(new URLSearchParams(rawBody));
      return NextResponse.json(result.response ?? { ok: true });
    }
    const envelope = JSON.parse(rawBody) as Parameters<typeof handleSlackEvent>[0];
    const result = await handleSlackEvent(envelope);
    return NextResponse.json(result.response ?? { ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to process Slack payload." }, { status: 400 });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    source: "slack",
    message:
      "Point your Slack app's Events API subscription and /ticket slash command here. Requests must carry Slack v0 signatures.",
  });
}
