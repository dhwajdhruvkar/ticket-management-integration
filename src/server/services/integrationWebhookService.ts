import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { appendAudit } from "../audit/auditChain";
import { config } from "../config";
import { getStore } from "../data";
import { newId, now } from "../domain/ids";
import { logger } from "../observability/logger";
import type { ApiKeyRow, TicketRow, WebhookDeliveryRow } from "../domain/models";
import { REQUESTER_SCOPED_API_ROLES } from "../auth/apiKeys";

export const TICKET_WEBHOOK_EVENTS = [
  "ticket.created",
  "ticket.updated",
  "ticket.resolved",
  "ticket.closed",
  "ticket.reopened",
] as const;

export type TicketWebhookEvent = (typeof TICKET_WEBHOOK_EVENTS)[number];

const MAX_ATTEMPTS = 8;
const DEMO_MASTER_SECRET = "netlink-demo-webhook-signing-key-not-for-production";

export class WebhookConfigurationError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "WebhookConfigurationError";
  }
}

export function assertWebhookSigningAvailable(): void {
  if (!config.auth.secret && !config.demoMode) {
    throw new WebhookConfigurationError(
      "AUTH_SECRET is required before outbound callbacks can be enabled.",
      503
    );
  }
}

export function normalizeWebhookUrl(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new WebhookConfigurationError("Webhook URL must be a valid absolute URL.");
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw new WebhookConfigurationError("Webhook URL cannot contain credentials or a fragment.");
  }
  if (parsed.protocol !== "https:" && !(config.demoMode && parsed.protocol === "http:")) {
    throw new WebhookConfigurationError("Webhook URL must use HTTPS.");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    isPrivateAddress(hostname)
  ) {
    throw new WebhookConfigurationError("Webhook target cannot use a local or private network address.");
  }
  return parsed.toString();
}

export function normalizeWebhookEvents(values: string[] | undefined): TicketWebhookEvent[] {
  const selected = values?.length ? values : ["ticket.created", "ticket.updated"];
  const allowed = new Set<string>(TICKET_WEBHOOK_EVENTS);
  const unique = [...new Set(selected)];
  if (unique.some((event) => !allowed.has(event))) {
    throw new WebhookConfigurationError("Unsupported ticket webhook event.");
  }
  return unique as TicketWebhookEvent[];
}

/** Derived per-integration signing secret; only the random salt is persisted. */
export function webhookSigningSecret(key: ApiKeyRow): string | null {
  if (!key.webhookSecretSalt) return null;
  const master = config.auth.secret ?? (config.demoMode ? DEMO_MASTER_SECRET : undefined);
  if (!master) throw new WebhookConfigurationError("AUTH_SECRET is required before outbound callbacks can be enabled.", 503);
  return createHmac("sha256", master)
    .update(`netlink-webhook\n${key.tenantId}\n${key.id}\n${key.webhookSecretSalt}`)
    .digest("base64url");
}

function ticketPayload(ticket: TicketRow, event: TicketWebhookEvent): Record<string, unknown> {
  return {
    id: newId("wh_evt"),
    event,
    createdAt: now(),
    data: {
      id: ticket.id,
      reference: ticket.reference,
      externalTicketId: ticket.externalTicketId ?? null,
      subject: ticket.subject,
      type: ticket.type,
      status: ticket.status,
      priority: ticket.priority,
      requesterEmail: ticket.requesterEmail,
      assigneeId: ticket.assigneeId ?? null,
      assignmentGroupId: ticket.assignmentGroupId ?? null,
      resolvedAt: ticket.resolvedAt ?? null,
      closedAt: ticket.closedAt ?? null,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
    },
  };
}

export async function queueTicketWebhookEvent(
  ticket: TicketRow,
  event: TicketWebhookEvent
): Promise<void> {
  const store = await getStore();
  const keys = await store.apiKeys.list({ tenantId: ticket.tenantId, active: true });
  const subscribers = keys.filter(
    (key) =>
      key.webhookActive &&
      key.webhookUrl &&
      key.webhookEvents?.includes(event) &&
      (!REQUESTER_SCOPED_API_ROLES.has(key.role) || ticket.integrationKeyId === key.id)
  );
  for (const key of subscribers) {
    const ts = now();
    const delivery: WebhookDeliveryRow = {
      id: newId("whd"),
      tenantId: ticket.tenantId,
      apiKeyId: key.id,
      ticketId: ticket.id,
      event,
      payload: ticketPayload(ticket, event),
      attempts: 0,
      nextAttemptAt: ts,
      lastError: null,
      createdAt: ts,
      updatedAt: ts,
    };
    await store.webhookDeliveries.create(delivery);
    await deliverWebhookDelivery(delivery.id).catch((error) =>
      logger.warn("integration webhook delivery failed", {
        deliveryId: delivery.id,
        error: error instanceof Error ? error.message : String(error),
      })
    );
  }
}

function isPrivateAddress(address: string): boolean {
  // URL.hostname retains brackets around IPv6 literals in Node. Strip them and
  // reject every non-global-unicast IPv6 range, including IPv4-mapped loopback.
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "").split("%", 1)[0];
  const version = isIP(normalized);
  if (version === 6) return !normalized.startsWith("2") && !normalized.startsWith("3");
  if (version !== 4) return false;
  const [a, b, c] = normalized.split(".").map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}

async function assertPublicTarget(url: URL): Promise<void> {
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new WebhookConfigurationError("Webhook target cannot use a local hostname.");
  }
  if (isPrivateAddress(hostname)) {
    throw new WebhookConfigurationError("Webhook target cannot use a private network address.");
  }
  if (!config.demoMode) {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
      throw new WebhookConfigurationError("Webhook target resolves to a private network address.");
    }
  }
}

function retryAt(attempts: number): string {
  const delayMinutes = Math.min(6 * 60, 2 ** Math.max(0, attempts - 1));
  return new Date(Date.now() + delayMinutes * 60_000).toISOString();
}

export async function deliverWebhookDelivery(id: string): Promise<boolean> {
  const store = await getStore();
  const delivery = await store.webhookDeliveries.get(id);
  if (!delivery) return true;
  const [key, ticket] = await Promise.all([
    store.apiKeys.get(delivery.apiKeyId),
    store.tickets.get(delivery.ticketId),
  ]);
  if (!key || !ticket || !key.active || !key.webhookActive || !key.webhookUrl) {
    await store.webhookDeliveries.remove(id);
    return true;
  }

  let status: number | null = null;
  let errorMessage: string | null = null;
  try {
    const url = new URL(key.webhookUrl);
    await assertPublicTarget(url);
    const secret = webhookSigningSecret(key);
    if (!secret) throw new WebhookConfigurationError("Webhook signing secret is unavailable.");
    const body = JSON.stringify(delivery.payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", secret)
      .update(`${timestamp}.${body}`)
      .digest("hex");
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Netlink-Support-Webhook/1.0",
        "X-Netlink-Event": delivery.event,
        "X-Netlink-Delivery": delivery.id,
        "X-Netlink-Timestamp": timestamp,
        "X-Netlink-Signature": `sha256=${signature}`,
      },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    status = response.status;
    if (!response.ok) throw new Error(`Callback returned HTTP ${response.status}.`);
    await store.webhookDeliveries.remove(id);
    await store.apiKeys.update(key.id, {
      webhookLastDeliveredAt: now(),
      webhookLastStatus: response.status,
      webhookLastError: null,
      updatedAt: now(),
    });
    return true;
  } catch (error) {
    errorMessage = error instanceof Error ? error.message.slice(0, 300) : "Webhook delivery failed.";
  }

  const attempts = delivery.attempts + 1;
  await store.apiKeys.update(key.id, {
    webhookLastStatus: status,
    webhookLastError: errorMessage,
    updatedAt: now(),
  });
  if (attempts >= MAX_ATTEMPTS) {
    await store.webhookDeliveries.remove(id);
    await appendAudit({
      tenantId: delivery.tenantId,
      actor: "webhook-delivery",
      action: "integration.webhook_dead_lettered",
      ticketId: delivery.ticketId,
      payload: { apiKeyId: delivery.apiKeyId, event: delivery.event, attempts, error: errorMessage },
    });
    return false;
  }
  await store.webhookDeliveries.update(id, {
    attempts,
    nextAttemptAt: retryAt(attempts),
    lastError: errorMessage,
    updatedAt: now(),
  });
  return false;
}

export async function retryPendingWebhookDeliveries(limit = 100): Promise<number> {
  const store = await getStore();
  const due = (await store.webhookDeliveries.list())
    .filter((row) => new Date(row.nextAttemptAt).getTime() <= Date.now())
    .sort((a, b) => a.nextAttemptAt.localeCompare(b.nextAttemptAt))
    .slice(0, limit);
  for (const row of due) await deliverWebhookDelivery(row.id);
  return due.length;
}
