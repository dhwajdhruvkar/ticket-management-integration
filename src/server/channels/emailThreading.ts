// =============================================================================
// Email thread recognition.
//
// Decides whether an inbound email belongs to an existing ticket, in priority
// order (highest confidence first):
//   1. Ticket reference token in the subject — "[INC-AB12CD]" (our outbound
//      notifications always carry it).
//   2. RFC 5322 ancestry — In-Reply-To / References matching the
//      internetMessageId of a previously ingested email on a ticket.
//   3. Provider conversation — Graph conversationId seen before on a ticket.
//
// matchThread() is pure (operates on the prior email ledger) so it is unit
// testable; resolveThreadTicket() feeds it from the store.
// =============================================================================

import { getStore } from "../data";
import type { EmailMessageRow } from "../domain/models";

/** "[INC-8F3K2A] Re: printer" -> "INC-8F3K2A". Case-insensitive, first match. */
export function extractReferenceToken(subject: string): string | null {
  const m = /\[((?:INC|REQ|PRB|CHG)-[A-Z0-9]+)\]/i.exec(subject);
  return m ? m[1].toUpperCase() : null;
}

export interface ThreadCandidate {
  subject: string;
  conversationId?: string | null;
  inReplyTo?: string | null;
  referencesHeader?: string | null;
}

export interface ThreadMatch {
  ticketId: string;
  /** Which signal produced the match (for the audit trail). */
  via: "subject_reference" | "in_reply_to" | "conversation_id";
}

/** Pure matcher over the prior email ledger (rows that already have a ticketId). */
export function matchThread(
  candidate: ThreadCandidate,
  ledger: Pick<EmailMessageRow, "internetMessageId" | "conversationId" | "ticketId">[],
  referenceToTicketId: (reference: string) => string | null
): ThreadMatch | null {
  const token = extractReferenceToken(candidate.subject);
  if (token) {
    const ticketId = referenceToTicketId(token);
    if (ticketId) return { ticketId, via: "subject_reference" };
  }

  const ancestry = new Set<string>();
  if (candidate.inReplyTo) ancestry.add(candidate.inReplyTo.trim());
  for (const ref of (candidate.referencesHeader ?? "").split(/\s+/)) {
    if (ref.trim()) ancestry.add(ref.trim());
  }
  if (ancestry.size > 0) {
    const hit = ledger.find(
      (row) => row.ticketId && row.internetMessageId && ancestry.has(row.internetMessageId)
    );
    if (hit?.ticketId) return { ticketId: hit.ticketId, via: "in_reply_to" };
  }

  if (candidate.conversationId) {
    const hit = ledger.find(
      (row) => row.ticketId && row.conversationId === candidate.conversationId
    );
    if (hit?.ticketId) return { ticketId: hit.ticketId, via: "conversation_id" };
  }

  return null;
}

/** Store-backed resolution: ledger + ticket reference lookup for one tenant. */
export async function resolveThreadTicket(
  tenantId: string,
  candidate: ThreadCandidate
): Promise<ThreadMatch | null> {
  const store = await getStore();
  const [ledger, tickets] = await Promise.all([
    store.emails.list({ tenantId }),
    store.tickets.list({ tenantId }),
  ]);
  const byReference = new Map(tickets.map((t) => [t.reference.toUpperCase(), t.id]));
  return matchThread(candidate, ledger, (ref) => byReference.get(ref) ?? null);
}
