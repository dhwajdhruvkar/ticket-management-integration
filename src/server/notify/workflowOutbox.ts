import { randomUUID } from "node:crypto";
import type { DataStore } from "../data/store";
import type { NotificationRow, TicketRow } from "../domain/models";
import { config } from "../config";
import { createAcknowledgement, acknowledgementToken, digest } from "./acknowledgementTokens";
import { logger } from "../observability/logger";

const LIFECYCLE: Record<string, string> = {
  created: "Received in the service-desk review bucket",
  "workflow.claim_review": "Service-desk review started", "workflow.route": "Routed to the department bucket",
  "workflow.offer": "Assigned — awaiting agent acceptance", "workflow.pickup": "Accepted — work in progress",
  "workflow.accept": "Accepted — work in progress", "workflow.decline": "Returned to the department bucket",
  "workflow.release": "Returned to the department bucket", reply_sent: "Progress update", resolved: "Resolved — awaiting your confirmation",
  reopened: "Reopened — awaiting department pickup", closed: "Closed", pending: "Waiting for further information or approval",
};

/** Call inside the ticket transaction. Event + normalized recipient is the dedupe key. */
export async function queueWorkflowNotice(store: DataStore, ticket: TicketRow, eventId: string, to: string, subject: string, body: string, acknowledgementId: string | null = null, at = Date.now()) {
  const address = to.trim().toLowerCase();
  const id = `delivery_${digest(`${ticket.tenantId}:${eventId}:${address}`)}`;
  if (await store.notificationDeliveries.get(id)) return;
  const stamp = new Date(at).toISOString();
  const notificationId = `ntf_${digest(id)}`;
  await store.notifications.create({ id: notificationId, tenantId: ticket.tenantId, channel: "email", toAddress: address, subject, body,
    link: `/tickets/${ticket.id}`, sent: false, sentAt: null, readAt: null, createdAt: stamp });
  await store.notificationDeliveries.create({ id, tenantId: ticket.tenantId, ticketId: ticket.id, notificationId, acknowledgementId,
    status: "pending", attempts: 0, nextAttemptAt: stamp, leaseUntil: null, owner: null, lastError: null, createdAt: stamp, updatedAt: stamp });
}

export async function queueLifecycle(store: DataStore, ticket: TicketRow, eventId: string, eventType: string, publicBody?: string, at = Date.now()) {
  if (!ticket.workflow || ticket.deletedAt || !LIFECYCLE[eventType]) return;
  let heading = LIFECYCLE[eventType];
  if (eventType === "closed") heading = ticket.workflow.closureReason === "requester_confirmed" ? "Closed — requester confirmed resolution" : "Closed after seven days without requester response (not confirmed)";
  const body = `${ticket.reference}: ${heading}.\n${ticket.subject}\n${publicBody ? `\n${publicBody.slice(0, 8000)}\n` : ""}`;
  const ackId = eventType === "resolved" ? await createAcknowledgement(store, ticket, eventId, at) : null;
  const recipients = new Map<string, boolean>([[ticket.requesterEmail.toLowerCase(), true]]);
  if (ticket.assigneeId) {
    const user = await store.users.get(ticket.assigneeId);
    if (user?.active && user.tenantId === ticket.tenantId) recipients.set(user.email.toLowerCase(), recipients.get(user.email.toLowerCase()) ?? false);
  }
  for (const [email, requester] of recipients) await queueWorkflowNotice(store, ticket, eventId, email, `[${ticket.reference}] ${heading}`, body, requester ? ackId : null, at);
}

export function outboundEmailConfigured(): boolean {
  return config.emailProvider === "brevo" ? !!config.brevo.apiKey && !!config.brevo.sender
    : config.emailProvider === "graph" && config.features.graph && !!config.graph.mailbox;
}

export function publicAppOrigin(): string | null {
  try {
    const url = new URL(process.env.APP_BASE_URL ?? process.env.AUTH_URL ?? "");
    if (url.username || url.password || (url.protocol !== "https:" && !(config.demoMode && ["localhost", "127.0.0.1"].includes(url.hostname)))) return null;
    return url.origin;
  } catch { return null; }
}

type DeliverySender = (notification: NotificationRow, body: string, key: string) => Promise<void>;
async function defaultSender(notification: NotificationRow, body: string, key: string) {
  if (config.emailProvider === "brevo") {
    const { sendBrevoMail } = await import("../channels/brevoEmail");
    await sendBrevoMail(notification.toAddress, notification.subject, body, undefined, key);
  } else {
    const { sendGraphMail } = await import("./notifier");
    await sendGraphMail(notification.toAddress, notification.subject, body);
  }
}

/** Leased, bounded, at-least-once delivery. A timeout after provider acceptance may duplicate mail. */
export async function drainWorkflowOutbox(store: DataStore, deadline = Date.now() + 20_000, sender?: DeliverySender) {
  if (!sender && (!outboundEmailConfigured() || !publicAppOrigin())) return { sent: 0, failed: 0, configured: false };
  let sent = 0, failed = 0;
  const pending = await store.notificationDeliveries.list({ status: "pending" }, { take: 100, orderBy: { field: "nextAttemptAt", dir: "asc" } });
  const abandoned = await store.notificationDeliveries.list({ status: "sending" }, { take: 100, orderBy: { field: "leaseUntil", dir: "asc" } });
  for (const delivery of [...pending, ...abandoned]) {
    if (Date.now() >= deadline || sent + failed >= 20) break;
    const at = Date.now();
    if (Date.parse(delivery.nextAttemptAt) > at || (delivery.leaseUntil && Date.parse(delivery.leaseUntil) > at)) continue;
    const owner = randomUUID();
    const claimed = await store.notificationDeliveries.updateIf(delivery.id, { status: delivery.status, attempts: delivery.attempts, owner: delivery.owner },
      { status: "sending", owner, leaseUntil: new Date(at + 120_000).toISOString(), attempts: delivery.attempts + 1 });
    if (!claimed) continue;
    try {
      const ticket = await store.tickets.get(delivery.ticketId);
      const notification = await store.notifications.get(delivery.notificationId);
      const recipient = notification ? (await store.users.list({ tenantId: delivery.tenantId })).find((user) => user.email.toLowerCase() === notification.toAddress) : null;
      if (!notification || !ticket || ticket.tenantId !== delivery.tenantId || ticket.deletedAt || recipient?.preferences?.emailNotifications === false) {
        await store.notificationDeliveries.updateIf(delivery.id, { owner }, { status: "suppressed", owner: null, leaseUntil: null, updatedAt: new Date().toISOString() });
        continue;
      }
      let body = notification.body;
      if (delivery.acknowledgementId) {
        const ack = await store.acknowledgements.get(delivery.acknowledgementId);
        // Suppress obsolete resolution/reminder mail rather than sending a dead link.
        if (!ack || ack.usedAt || Date.parse(ack.expiresAt) <= at || ticket.status !== "resolved" || ticket.resolvedAt !== ack.resolvedAt) {
          await store.notificationDeliveries.updateIf(delivery.id, { owner }, { status: "suppressed", owner: null, leaseUntil: null, updatedAt: new Date().toISOString() });
          continue;
        }
        body += `\nConfirm the fix or reopen this ticket (link expires ${ack.expiresAt}):\n${publicAppOrigin() ?? "http://localhost:3000"}/ticket-confirmation#token=${acknowledgementToken(ack.id)}\nOpening the link alone does not change the ticket.\n`;
      } else if (publicAppOrigin()) body += `\nOpen the workspace: ${publicAppOrigin()}/tickets/${encodeURIComponent(ticket.id)}\n`;
      await (sender ?? defaultSender)(notification, body, delivery.id);
      await store.transaction(async (tx) => {
        const updated = await tx.notificationDeliveries.updateIf(delivery.id, { owner }, { status: "sent", owner: null, leaseUntil: null, lastError: null, updatedAt: new Date().toISOString() });
        if (updated) await tx.notifications.update(notification.id, { sent: true, sentAt: new Date().toISOString() });
      });
      sent++;
    } catch {
      failed++;
      const exhausted = claimed.attempts >= 8;
      await store.notificationDeliveries.updateIf(delivery.id, { owner }, { status: exhausted ? "failed" : "pending", owner: null, leaseUntil: null,
        nextAttemptAt: new Date(Date.now() + Math.min(60 * 60_000, 60_000 * 2 ** (claimed.attempts - 1))).toISOString(),
        lastError: "Delivery failed; check provider credentials, quota and service health.", updatedAt: new Date().toISOString() });
      logger.warn("workflow.email.delivery_failed", { requestId: owner, entryPoint: "workflow_outbox", attempts: claimed.attempts, exhausted });
    }
  }
  return { sent, failed, configured: true };
}
