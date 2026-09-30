import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { DataStore } from "../data/store";
import type { TicketRow } from "../domain/models";

export const ACK_LIFETIME_MS = 7 * 86_400_000;
export const digest = (text: string) => createHash("sha256").update(text).digest("hex");

/** Domain-separated HMAC reconstructs a link at delivery time; only its hash is stored. */
export function acknowledgementToken(id: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("Acknowledgement signing is not configured.");
  return `${id}.${createHmac("sha256", secret).update(`ticket-ack:v1:${id}`).digest("base64url")}`;
}

export function validAcknowledgementToken(token: string): string | null {
  if (!/^ack_[a-f0-9]{64}\.[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const id = token.split(".")[0];
  try {
    const expected = Buffer.from(acknowledgementToken(id));
    const actual = Buffer.from(token);
    return expected.length === actual.length && timingSafeEqual(expected, actual) ? id : null;
  } catch { return null; }
}

export async function createAcknowledgement(store: DataStore, ticket: TicketRow, eventId: string, at: number): Promise<string | null> {
  if (!ticket.resolvedAt || !process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32) return null;
  const id = `ack_${digest(`${ticket.tenantId}:${ticket.id}:${eventId}`)}`;
  if (await store.acknowledgements.get(id)) return id;
  await store.acknowledgements.create({ id, tenantId: ticket.tenantId, ticketId: ticket.id,
    tokenHash: digest(acknowledgementToken(id)), resolvedAt: ticket.resolvedAt,
    expiresAt: new Date(Date.parse(ticket.resolvedAt) + ACK_LIFETIME_MS).toISOString(), usedAt: null, createdAt: new Date(at).toISOString() });
  return id;
}
