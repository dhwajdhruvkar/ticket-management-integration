// =============================================================================
// Inbound webhook authentication (HMAC).
//
// Senders sign requests with a shared secret:
//   x-webhook-timestamp: <unix seconds>
//   x-webhook-signature: sha256=<hex HMAC-SHA256 of "<timestamp>.<rawBody>">
//
// The timestamp binds the signature to a 5-minute window (replay protection).
// Secrets come from WEBHOOK_SECRET / ZENDESK_WEBHOOK_SECRET /
// FRESHDESK_WEBHOOK_SECRET. When no secret is configured: demo mode accepts
// unsigned requests (zero-infra demo), production mode rejects them.
// =============================================================================

import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config";

const TOLERANCE_SECONDS = 300;

export type WebhookSource = "generic" | "zendesk" | "freshdesk";

export interface WebhookVerification {
  ok: boolean;
  /** Machine-readable failure reason (also safe to return to the sender). */
  reason?: string;
}

export function signWebhookPayload(secret: string, timestamp: string, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
}

export function verifyWebhookRequest(
  source: WebhookSource,
  req: Request,
  rawBody: string,
  nowMs = Date.now()
): WebhookVerification {
  const secret = config.webhookSecrets[source];

  if (!secret) {
    return config.demoMode
      ? { ok: true }
      : { ok: false, reason: "Webhook secret not configured; unsigned webhooks are rejected in production." };
  }

  const timestamp = req.headers.get("x-webhook-timestamp")?.trim();
  const signature = req.headers.get("x-webhook-signature")?.trim();
  if (!timestamp || !signature) {
    return { ok: false, reason: "Missing x-webhook-timestamp or x-webhook-signature header." };
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > TOLERANCE_SECONDS) {
    return { ok: false, reason: "Webhook timestamp outside the accepted window." };
  }

  const presented = signature.startsWith("sha256=") ? signature.slice(7) : signature;
  const expected = signWebhookPayload(secret, timestamp, rawBody);

  const a = Buffer.from(expected, "hex");
  let b: Buffer;
  try {
    b = Buffer.from(presented, "hex");
  } catch {
    return { ok: false, reason: "Malformed signature." };
  }
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "Signature mismatch." };
  }
  return { ok: true };
}
