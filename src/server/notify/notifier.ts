// =============================================================================
// Notifications.
//
// Every notification is recorded as a Notification row (in-app feed) and, when
// the channel is configured, delivered via Microsoft Graph (email) or a Teams
// webhook. With nothing configured it still records — so the audit/feed is
// complete and the demo works offline.
//
// User preferences are enforced at send time: a recipient with
// emailNotifications=false still gets the in-app feed row, but no email is
// dispatched. Every recorded notification is also published to the in-process
// event bus so open SSE connections update live.
// =============================================================================

import { config } from "../config";
import { getStore } from "../data";
import { newId, now } from "../domain/ids";
import { publishEvent } from "../events/bus";
import { logger } from "../observability/logger";
import type { NotificationChannel, NotificationRow, UserPreferences } from "../domain/models";

export interface EmailAttachment {
  filename: string;
  /** Base64-encoded file content. */
  contentBase64: string;
  contentType: string;
}

export interface NotifyInput {
  tenantId: string;
  channel?: NotificationChannel;
  to: string;
  subject: string;
  body: string;
  /** App-relative destination for the in-app feed (e.g. "/tickets/tkt_1"). */
  link?: string;
  /** Email-only file attachments (e.g. a monthly report PDF). */
  attachments?: EmailAttachment[];
}

async function recipientPreferences(
  tenantId: string,
  email: string
): Promise<UserPreferences | null> {
  const store = await getStore();
  const user = (await store.users.list({ tenantId })).find(
    (u) => u.email.toLowerCase() === email.toLowerCase()
  );
  return user?.preferences ?? null;
}

export async function notify(input: NotifyInput): Promise<NotificationRow> {
  const store = await getStore();
  const channel = input.channel ?? "in_app";
  let sent = false;

  try {
    if (channel === "email") {
      const prefs = await recipientPreferences(input.tenantId, input.to);
      if (prefs?.emailNotifications === false) {
        logger.debug("email suppressed by user preference", { to: input.to });
      } else if (config.emailProvider === "brevo" && config.features.brevoOutbound) {
        const { sendBrevoMail } = await import("../channels/brevoEmail");
        await sendBrevoMail(input.to, input.subject, input.body, input.attachments);
        sent = true;
      } else if (config.emailProvider === "graph" && config.features.graph) {
        await sendGraphMail(input.to, input.subject, input.body, input.attachments);
        sent = true;
      }
      // else: no email provider configured -> record-only (in-app feed).
    } else if (channel === "teams" && process.env.TEAMS_WEBHOOK_URL) {
      await sendTeams(input.subject, input.body);
      sent = true;
    } else if (channel === "slack" && config.features.slackOutbound) {
      const { sendSlackMessage } = await import("../channels/slack");
      await sendSlackMessage(input.subject, input.body);
      sent = true;
    }
  } catch (err) {
    logger.error("notification delivery failed, recording only", {
      to: input.to,
      channel,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const record: NotificationRow = {
    id: newId("ntf"),
    tenantId: input.tenantId,
    channel,
    toAddress: input.to,
    subject: input.subject,
    body: input.body,
    link: input.link ?? null,
    sent,
    sentAt: sent ? now() : null,
    readAt: null,
    createdAt: now(),
  };
  const created = await store.notifications.create(record);
  publishEvent({ type: "notification", tenantId: input.tenantId, toAddress: input.to });
  return created;
}

async function graphToken(): Promise<string> {
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
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

async function sendGraphMail(
  to: string,
  subject: string,
  body: string,
  attachments?: EmailAttachment[]
): Promise<void> {
  const token = await graphToken();
  const from = config.graph.mailbox;
  const message: Record<string, unknown> = {
    subject,
    body: { contentType: "Text", content: body },
    toRecipients: [{ emailAddress: { address: to } }],
  };
  if (attachments?.length) {
    message.attachments = attachments.map((a) => ({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: a.filename,
      contentType: a.contentType,
      contentBytes: a.contentBase64,
    }));
  }
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from ?? "")}/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) throw new Error(`Graph sendMail ${res.status}`);
}

async function sendTeams(subject: string, body: string): Promise<void> {
  const url = process.env.TEAMS_WEBHOOK_URL!;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: `**${subject}**\n\n${body}` }),
  });
}
