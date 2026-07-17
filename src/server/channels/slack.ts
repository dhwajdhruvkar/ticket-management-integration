// =============================================================================
// Slack channel.
//
// Inbound (/api/webhooks/slack): Slack Events API + slash commands. Requests
// are verified with Slack's v0 signing scheme (X-Slack-Signature over
// "v0:{timestamp}:{rawBody}", 5-minute replay window). Supported inputs:
//   - url_verification handshake (returns the challenge)
//   - event_callback with message / app_mention events -> ticket via intake
//   - slash command form posts (/ticket <text>)      -> ticket via intake
// Bot messages are ignored (loop guard).
//
// Outbound: the notifier posts to SLACK_WEBHOOK_URL when channel="slack".
// =============================================================================

import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config";
import { defaultTenantId } from "../data";
import { intakeTicket } from "../services/intake";

const TOLERANCE_SECONDS = 300;

/** Slack v0 signature: v0=hex(HMAC_SHA256(secret, "v0:{ts}:{body}")). */
export function slackSignature(secret: string, timestamp: string, rawBody: string): string {
  return `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`, "utf8").digest("hex")}`;
}

export interface SlackVerification {
  ok: boolean;
  reason?: string;
}

export function verifySlackRequest(
  req: Request,
  rawBody: string,
  nowMs = Date.now(),
  secret = config.slack.signingSecret
): SlackVerification {
  if (!secret) {
    return config.demoMode
      ? { ok: true }
      : { ok: false, reason: "SLACK_SIGNING_SECRET not configured; requests are rejected in production." };
  }
  const timestamp = req.headers.get("x-slack-request-timestamp")?.trim();
  const signature = req.headers.get("x-slack-signature")?.trim();
  if (!timestamp || !signature) {
    return { ok: false, reason: "Missing Slack signature headers." };
  }
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > TOLERANCE_SECONDS) {
    return { ok: false, reason: "Slack timestamp outside the accepted window." };
  }
  const expected = slackSignature(secret, timestamp, rawBody);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "Slack signature mismatch." };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Inbound payload handling
// ---------------------------------------------------------------------------

interface SlackEventEnvelope {
  type?: string;
  challenge?: string;
  event?: {
    type?: string;
    text?: string;
    user?: string;
    bot_id?: string;
    subtype?: string;
  };
}

export interface SlackInboundResult {
  /** Body to return to Slack (challenge echo, ack text, or null for 200-empty). */
  response: Record<string, unknown> | null;
}

function requesterFor(user: string | undefined): string {
  // Slack user ids aren't emails; a directory lookup via users.info needs a bot
  // token (documented follow-up). The synthetic address keeps replies routable
  // in-app while remaining clearly non-deliverable.
  return `${(user ?? "slack-user").toLowerCase()}@slack.netlink.local`;
}

async function openTicket(text: string, user: string | undefined): Promise<string> {
  const tenantId = await defaultTenantId();
  const subject = text.length > 80 ? `${text.slice(0, 77)}...` : text;
  const ticket = await intakeTicket(tenantId, {
    subject: subject || "(no subject)",
    body: text,
    requesterEmail: requesterFor(user),
    channel: "chat",
    source: "slack",
  });
  return ticket.status === "auto_resolved"
    ? `Created ${ticket.reference} — the assistant resolved it instantly; check the ticket for steps.`
    : `Created ${ticket.reference}. An agent will follow up shortly.`;
}

/** Events API envelope (JSON). */
export async function handleSlackEvent(envelope: SlackEventEnvelope): Promise<SlackInboundResult> {
  if (envelope.type === "url_verification" && envelope.challenge) {
    return { response: { challenge: envelope.challenge } };
  }
  if (envelope.type === "event_callback" && envelope.event) {
    const ev = envelope.event;
    // Loop guard: ignore bot posts and message edits/joins.
    if (ev.bot_id || ev.subtype) return { response: null };
    if ((ev.type === "message" || ev.type === "app_mention") && ev.text?.trim()) {
      const text = ev.text.replace(/<@[A-Z0-9]+>/g, "").trim();
      if (text) await openTicket(text, ev.user);
    }
    return { response: null };
  }
  return { response: null };
}

/** Slash command (application/x-www-form-urlencoded). */
export async function handleSlackSlashCommand(form: URLSearchParams): Promise<SlackInboundResult> {
  const text = (form.get("text") ?? "").trim();
  const user = form.get("user_name") ?? form.get("user_id") ?? undefined;
  if (!text) {
    return {
      response: { response_type: "ephemeral", text: "Describe the issue: `/ticket my laptop won't start`" },
    };
  }
  const reply = await openTicket(text, user ?? undefined);
  return { response: { response_type: "ephemeral", text: reply } };
}

// ---------------------------------------------------------------------------
// Outbound
// ---------------------------------------------------------------------------

export async function sendSlackMessage(subject: string, body: string): Promise<void> {
  const url = config.slack.webhookUrl;
  if (!url) throw new Error("SLACK_WEBHOOK_URL not configured");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: `*${subject}*\n\n${body}` }),
  });
  if (!res.ok) throw new Error(`Slack webhook ${res.status}`);
}
