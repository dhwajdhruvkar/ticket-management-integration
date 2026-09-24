import { createHash } from "node:crypto";
import { getStore } from "../data";
import type { ActingUser } from "../context";
import type { TicketRow } from "../domain/models";

const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

export class IdempotencyError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
    this.name = "IdempotencyError";
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonicalize(item)])
    );
  }
  return value;
}

export interface IdempotencyMetadata {
  scopeHash: string;
  requestHash: string;
  integrationKeyId?: string;
  externalTicketId?: string;
}

/**
 * Build non-secret idempotency metadata. The raw Idempotency-Key header is
 * never persisted; an explicit externalTicketId remains on the ticket for
 * partner correlation. Both forms are scoped to the identity plus tenant.
 */
export function ticketIdempotencyMetadata(
  req: Request,
  tenantId: string,
  actor: ActingUser,
  payload: Record<string, unknown>
): IdempotencyMetadata | null {
  const header = req.headers.get("idempotency-key")?.trim();
  const externalTicketId =
    typeof payload.externalTicketId === "string" ? payload.externalTicketId.trim() : "";
  const rawKey = header || (externalTicketId ? `external:${externalTicketId}` : "");
  if (!rawKey) return null;
  if (
    (header && header.length > MAX_IDEMPOTENCY_KEY_LENGTH) ||
    /[\r\n\0]/.test(rawKey)
  ) {
    throw new IdempotencyError("Idempotency-Key must be 1-128 characters without control characters.", 400);
  }

  const actorScope = actor.apiKeyId
    ? `api-key:${actor.apiKeyId}`
    : actor.id
      ? `user:${actor.id}`
      : `actor:${actor.name}`;
  return {
    scopeHash: sha256(`${tenantId}\n${actorScope}\n${rawKey}`),
    requestHash: sha256(JSON.stringify(canonicalize(payload))),
    integrationKeyId: actor.apiKeyId,
    externalTicketId: externalTicketId || undefined,
  };
}

export async function findIdempotentTicket(
  tenantId: string,
  metadata: IdempotencyMetadata
): Promise<TicketRow | null> {
  const store = await getStore();
  const rows = await store.tickets.list({
    tenantId,
    idempotencyScopeHash: metadata.scopeHash,
  });
  const ticket = rows[0] ?? null;
  if (!ticket) return null;
  if (ticket.idempotencyRequestHash !== metadata.requestHash) {
    throw new IdempotencyError(
      "This idempotency key was already used with a different ticket payload."
    );
  }
  return ticket;
}
