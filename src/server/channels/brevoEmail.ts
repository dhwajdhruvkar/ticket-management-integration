// =============================================================================
// Brevo email channel (alternative to Microsoft Graph).
//
// Inbound: Brevo Inbound Parsing POSTs a parsed JSON payload (items[]) to
// /api/webhooks/brevo after the support domain's MX records are pointed at
// Brevo. parseBrevoItems() maps each item onto the provider-agnostic
// InboundEmail shape; ingestBrevoPayload() downloads attachments (referenced by
// a DownloadToken, not inlined) and hands each message to processInboundEmail()
// — the same dedupe / threading / loop-guard pipeline the Graph poller uses.
//
// Outbound: sendBrevoMail() posts to the transactional email API, mirroring
// sendGraphMail() (text body + optional base64 attachments).
// =============================================================================

import { config } from "../config";
import { defaultTenantId } from "../data";
import { logger } from "../observability/logger";
import {
  processInboundEmail,
  type InboundAttachment,
  type InboundEmail,
  type IngestResult,
} from "./emailIngest";
import type { EmailAttachment } from "../notify/notifier";

// ---- Brevo Inbound Parsing payload (subset we consume) --------------------

interface BrevoAddress {
  Name?: string;
  Address?: string;
}

interface BrevoAttachmentMeta {
  Name?: string;
  ContentType?: string;
  ContentLength?: number;
  ContentId?: string;
  DownloadToken?: string;
  Token?: string;
}

interface BrevoItem {
  Uuid?: string[];
  MessageId?: string;
  InReplyTo?: string;
  From?: BrevoAddress;
  To?: BrevoAddress[];
  Subject?: string;
  RawHtmlBody?: string | null;
  RawTextBody?: string | null;
  SentAtDate?: string;
  Attachments?: BrevoAttachmentMeta[];
  Headers?: Record<string, string | string[]>;
}

interface BrevoPayload {
  items?: BrevoItem[];
}

export interface ParsedBrevoItem {
  email: InboundEmail;
  /** Attachment references to resolve via the Brevo API (download tokens). */
  attachments: { name: string; contentType: string; token: string }[];
}

/** Case-insensitive header lookup; array values are space-joined. */
function headerValue(
  headers: Record<string, string | string[]> | undefined,
  name: string
): string | null {
  if (!headers) return null;
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return Array.isArray(v) ? v.join(" ") : v;
  }
  return null;
}

function toIso(value: string | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Map a Brevo Inbound Parsing payload to normalized InboundEmail rows. Pure —
 * no network — so it is unit testable. Attachment binaries are represented by
 * their download tokens; ingestBrevoPayload() resolves them.
 */
export function parseBrevoItems(payload: unknown): ParsedBrevoItem[] {
  const items = (payload as BrevoPayload | null)?.items;
  if (!Array.isArray(items)) return [];

  return items.map((item) => {
    const messageId = item.MessageId ?? headerValue(item.Headers, "Message-Id");
    const inReplyTo = item.InReplyTo ?? headerValue(item.Headers, "In-Reply-To");
    const references = headerValue(item.Headers, "References");

    const email: InboundEmail = {
      providerId: item.Uuid?.[0] ?? messageId ?? undefined,
      internetMessageId: messageId,
      conversationId: null, // Brevo doesn't expose one; threading uses Message-Id/References
      inReplyTo,
      referencesHeader: references,
      from: item.From?.Address ?? "unknown@external",
      to: item.To?.[0]?.Address ?? config.brevo.sender ?? null,
      subject: item.Subject ?? "(no subject)",
      bodyHtml: item.RawHtmlBody ?? null,
      bodyText: item.RawTextBody ?? null,
      receivedAt: toIso(item.SentAtDate),
    };

    const attachments = (item.Attachments ?? [])
      .map((a) => ({
        name: a.Name ?? "attachment",
        contentType: a.ContentType ?? "application/octet-stream",
        token: a.DownloadToken ?? a.Token ?? "",
      }))
      .filter((a) => a.token);

    return { email, attachments };
  });
}

async function downloadAttachment(token: string): Promise<Buffer | null> {
  if (!config.brevo.apiKey) return null;
  try {
    const res = await fetch(
      `https://api.brevo.com/v3/inbound/attachments/${encodeURIComponent(token)}`,
      { headers: { "api-key": config.brevo.apiKey, accept: "application/octet-stream" } }
    );
    if (!res.ok) {
      logger.warn("brevo attachment download failed", { status: res.status });
      return null;
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    logger.warn("brevo attachment download error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Ingest a Brevo inbound payload through the shared pipeline. */
export async function ingestBrevoPayload(
  payload: unknown
): Promise<{ processed: number; results: IngestResult[] }> {
  const tenantId = await defaultTenantId();
  const parsed = parseBrevoItems(payload);
  const results: IngestResult[] = [];
  let processed = 0;

  for (const item of parsed) {
    const attachments: InboundAttachment[] = [];
    for (const att of item.attachments) {
      const bytes = await downloadAttachment(att.token);
      if (bytes) {
        attachments.push({
          fileName: att.name,
          mimeType: att.contentType,
          contentBase64: bytes.toString("base64"),
        });
      }
    }

    const result = await processInboundEmail(
      tenantId,
      { ...item.email, attachments },
      { supportMailbox: config.brevo.sender }
    );
    results.push(result);
    if (result.status === "processed") processed++;
    else logger.info("brevo email skipped", { status: result.status, reason: result.reason });
  }

  return { processed, results };
}

// ---- Outbound (transactional email) ---------------------------------------

export async function sendBrevoMail(
  to: string,
  subject: string,
  body: string,
  attachments?: EmailAttachment[]
): Promise<void> {
  const { apiKey, sender } = config.brevo;
  if (!apiKey) throw new Error("BREVO_API_KEY not configured");
  if (!sender) throw new Error("BREVO_SENDER (or SUPPORT_MAILBOX) not configured");

  const message: Record<string, unknown> = {
    sender: { email: sender, name: "Netlink Support" },
    to: [{ email: to }],
    subject,
    textContent: body,
  };
  if (attachments?.length) {
    message.attachment = attachments.map((a) => ({ name: a.filename, content: a.contentBase64 }));
  }

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify(message),
  });
  if (!res.ok) throw new Error(`Brevo sendEmail ${res.status}: ${await res.text()}`);
}
