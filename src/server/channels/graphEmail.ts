// =============================================================================
// Microsoft 365 email channel (Microsoft Graph).
//
// Polls the support mailbox for unread messages and hands each to the
// provider-agnostic ingestion pipeline (emailIngest.ts): full HTML/text body,
// RFC headers for threading/dedupe, and file attachments. Messages are marked
// read even when skipped (loops/spam/duplicates) so they are never reprocessed.
// No-op (returns 0) when Graph isn't configured.
// =============================================================================

import { config } from "../config";
import { defaultTenantId } from "../data";
import { logger } from "../observability/logger";
import { processInboundEmail, type InboundAttachment } from "./emailIngest";

interface GraphMessage {
  id: string;
  subject?: string;
  from?: { emailAddress?: { address?: string } };
  toRecipients?: { emailAddress?: { address?: string } }[];
  body?: { contentType?: string; content?: string };
  bodyPreview?: string;
  receivedDateTime?: string;
  internetMessageId?: string;
  conversationId?: string;
  hasAttachments?: boolean;
  internetMessageHeaders?: { name?: string; value?: string }[];
}

interface GraphAttachment {
  "@odata.type"?: string;
  name?: string;
  contentType?: string;
  size?: number;
  contentBytes?: string;
  isInline?: boolean;
}

async function token(): Promise<string> {
  const { tenantId, clientId, clientSecret } = config.graph;
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId ?? "",
      client_secret: clientSecret ?? "",
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`Graph token ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

function header(m: GraphMessage, name: string): string | null {
  const hit = m.internetMessageHeaders?.find(
    (h) => h.name?.toLowerCase() === name.toLowerCase()
  );
  return hit?.value ?? null;
}

async function fetchAttachments(
  accessToken: string,
  mailbox: string,
  messageId: string
): Promise<InboundAttachment[]> {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${mailbox}/messages/${messageId}/attachments`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) return [];
  const json = (await res.json()) as { value?: GraphAttachment[] };
  return (json.value ?? [])
    .filter(
      (a) =>
        a["@odata.type"] === "#microsoft.graph.fileAttachment" &&
        !!a.contentBytes &&
        !a.isInline
    )
    .map((a) => ({
      fileName: a.name ?? "attachment",
      mimeType: a.contentType ?? "application/octet-stream",
      contentBase64: a.contentBytes!,
    }));
}

const SELECT_FIELDS =
  "id,subject,from,toRecipients,body,bodyPreview,receivedDateTime,internetMessageId,conversationId,hasAttachments,internetMessageHeaders";

export async function pollMailbox(): Promise<number> {
  if (!config.features.graph || !config.graph.mailbox) return 0;
  const accessToken = await token();
  const mailbox = encodeURIComponent(config.graph.mailbox);
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${mailbox}/mailFolders/inbox/messages` +
      `?$filter=isRead eq false&$top=25&$select=${SELECT_FIELDS}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`Graph list messages ${res.status}`);
  const json = (await res.json()) as { value?: GraphMessage[] };
  const messages = json.value ?? [];
  const tenantId = await defaultTenantId();

  let processed = 0;
  for (const m of messages) {
    const attachments = m.hasAttachments
      ? await fetchAttachments(accessToken, mailbox, m.id).catch(() => [])
      : [];

    const isHtml = (m.body?.contentType ?? "").toLowerCase() === "html";
    const result = await processInboundEmail(
      tenantId,
      {
        providerId: m.id,
        internetMessageId: m.internetMessageId ?? null,
        conversationId: m.conversationId ?? null,
        inReplyTo: header(m, "In-Reply-To"),
        referencesHeader: header(m, "References"),
        from: m.from?.emailAddress?.address ?? "unknown@external",
        to: m.toRecipients?.[0]?.emailAddress?.address ?? config.graph.mailbox,
        subject: m.subject || "(no subject)",
        bodyHtml: isHtml ? m.body?.content ?? null : null,
        bodyText: isHtml ? null : m.body?.content ?? m.bodyPreview ?? "",
        receivedAt: m.receivedDateTime ?? null,
        attachments,
      },
      { supportMailbox: config.graph.mailbox }
    );

    // Mark read regardless of outcome so skipped mail is never reprocessed.
    await fetch(`https://graph.microsoft.com/v1.0/users/${mailbox}/messages/${m.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ isRead: true }),
    }).catch(() => undefined);

    if (result.status === "processed") processed++;
    else logger.info("email skipped", { status: result.status, reason: result.reason });
  }
  return processed;
}
