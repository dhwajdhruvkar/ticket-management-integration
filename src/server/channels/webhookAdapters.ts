// =============================================================================
// Webhook payload adapters (server-side).
//
// Each adapter maps a provider-specific webhook body into NewTicketInput so
// every provider flows through the same unified intake pipeline (classify ->
// SLA -> routing -> automations -> AI). Adding a provider = one function.
// =============================================================================

import type { NewTicketInput } from "../services/ticketService";
import type { TicketCategory, TicketChannel, TicketPriority } from "../domain/models";

const VALID_CATEGORIES: TicketCategory[] = [
  "IT",
  "HR",
  "Access",
  "Software",
  "Hardware",
  "Network",
  "Billing",
  "Other",
];

function asCategory(value: unknown): TicketCategory | undefined {
  if (typeof value === "string") {
    const match = VALID_CATEGORIES.find((c) => c.toLowerCase() === value.toLowerCase());
    if (match) return match;
  }
  return undefined;
}

function asChannel(value: unknown, fallback: TicketChannel = "email"): TicketChannel {
  const v = typeof value === "string" ? value.toLowerCase() : "";
  if (v === "email" || v === "portal" || v === "chat" || v === "phone" || v === "api") return v;
  return fallback;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export class AdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdapterError";
  }
}

// ---------------------------------------------------------------------------
// Generic — accepts our own internal shape directly.
//   { subject, body, requester, priority?, category?, channel?, tags? }
// ---------------------------------------------------------------------------

const VALID_PRIORITIES: TicketPriority[] = ["critical", "high", "medium", "low", "very_low"];

export function normalizeGeneric(payload: unknown): NewTicketInput {
  const p = (payload ?? {}) as Record<string, unknown>;
  const subject = asString(p.subject).trim();
  const body = asString(p.body).trim();
  const requester = asString(p.requester ?? p.requesterEmail).trim();
  if (!subject || !body || !requester) {
    throw new AdapterError("subject, body, and requester are required");
  }
  const priority =
    typeof p.priority === "string" && VALID_PRIORITIES.includes(p.priority.toLowerCase() as TicketPriority)
      ? (p.priority.toLowerCase() as TicketPriority)
      : undefined;
  return {
    subject,
    body,
    requesterEmail: requester,
    priority,
    category: asCategory(p.category),
    channel: asChannel(p.channel, "api"),
    tags: Array.isArray(p.tags) ? p.tags.filter((t): t is string => typeof t === "string") : [],
    source: "webhook:generic",
  };
}

// ---------------------------------------------------------------------------
// Zendesk — Ticket Created webhook ({ ticket: {...} } from Triggers).
// Priorities low/normal/high/urgent map onto P4/P3/P2/P1.
// ---------------------------------------------------------------------------

interface ZendeskPayload {
  ticket?: {
    id?: number | string;
    subject?: string;
    description?: string;
    priority?: string;
    type?: string;
    requester?: { email?: string; name?: string } | null;
    requester_email?: string;
    via?: { channel?: string };
    tags?: string[];
  };
}

const ZENDESK_PRIORITY: Record<string, TicketPriority> = {
  low: "low",
  normal: "medium",
  high: "high",
  urgent: "critical",
};

export function normalizeZendesk(payload: unknown): NewTicketInput {
  const p = (payload as ZendeskPayload | undefined)?.ticket ?? {};
  const subject = asString(p.subject).trim();
  const body = asString(p.description).trim();
  const requester = asString(p.requester?.email ?? p.requester_email).trim();
  if (!subject || !body || !requester) {
    throw new AdapterError(
      "Zendesk webhook missing ticket.subject, ticket.description, or ticket.requester.email"
    );
  }
  return {
    subject,
    body,
    requesterEmail: requester,
    priority: ZENDESK_PRIORITY[(p.priority ?? "normal").toLowerCase()] ?? "medium",
    category: asCategory(p.type),
    channel: asChannel(p.via?.channel, "email"),
    tags: Array.isArray(p.tags) ? p.tags : [],
    source: p.id != null ? `webhook:zendesk:${p.id}` : "webhook:zendesk",
  };
}

// ---------------------------------------------------------------------------
// Freshdesk — webhook body under `freshdesk_webhook`.
// Numeric priorities 1..4 map onto P4/P3/P2/P1.
// ---------------------------------------------------------------------------

interface FreshdeskPayload {
  freshdesk_webhook?: {
    ticket_id?: number | string;
    ticket_subject?: string;
    ticket_description?: string;
    ticket_description_text?: string;
    ticket_priority?: number | string;
    ticket_requester_email?: string;
    ticket_tags?: string[] | string;
    ticket_source?: string;
    ticket_type?: string;
  };
}

const FRESHDESK_PRIORITY: Record<string, TicketPriority> = {
  "1": "low",
  "2": "medium",
  "3": "high",
  "4": "critical",
};

export function normalizeFreshdesk(payload: unknown): NewTicketInput {
  const p = (payload as FreshdeskPayload | undefined)?.freshdesk_webhook ?? {};
  const subject = asString(p.ticket_subject).trim();
  const body = asString(p.ticket_description_text ?? p.ticket_description).trim();
  const requester = asString(p.ticket_requester_email).trim();
  if (!subject || !body || !requester) {
    throw new AdapterError(
      "Freshdesk webhook missing ticket_subject, ticket_description, or ticket_requester_email"
    );
  }
  const tags = Array.isArray(p.ticket_tags)
    ? p.ticket_tags
    : typeof p.ticket_tags === "string"
    ? p.ticket_tags.split(",").map((t) => t.trim()).filter(Boolean)
    : [];

  return {
    subject,
    body,
    requesterEmail: requester,
    priority: FRESHDESK_PRIORITY[String(p.ticket_priority ?? "2")] ?? "medium",
    category: asCategory(p.ticket_type),
    channel: asChannel(p.ticket_source, "email"),
    tags,
    source: p.ticket_id != null ? `webhook:freshdesk:${p.ticket_id}` : "webhook:freshdesk",
  };
}
