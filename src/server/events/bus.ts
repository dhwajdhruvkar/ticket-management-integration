// =============================================================================
// In-process event bus (single-node realtime).
//
// notify() and mutateTicket() publish here; the SSE route (/api/v1/events)
// subscribes and pushes to connected browsers, replacing bell polling with
// live updates. Single-node by design — for multi-replica deployments this is
// the seam where Redis pub/sub slots in behind the same subscribe() contract.
// =============================================================================

import { EventEmitter } from "node:events";

export interface AppEvent {
  type: "notification" | "ticket.updated" | "ticket.typing";
  tenantId: string;
  /** notification: recipient address. */
  toAddress?: string;
  /** ticket.updated / ticket.typing: the ticket + requester (for record-level SSE filtering). */
  ticketId?: string;
  ticketReference?: string;
  requesterEmail?: string;
  /** ticket.typing: who is composing (ephemeral, never persisted). */
  actorId?: string;
  actorName?: string;
  actorKind?: "agent" | "requester";
  /** ticket.typing: internal-note typing is hidden from requesters. */
  visibility?: "public" | "internal";
  at: string;
}

const CHANNEL = "app-event";

function emitter(): EventEmitter {
  const g = globalThis as unknown as { __netlinkBus?: EventEmitter };
  if (!g.__netlinkBus) {
    g.__netlinkBus = new EventEmitter();
    g.__netlinkBus.setMaxListeners(500); // one listener per open SSE connection
  }
  return g.__netlinkBus;
}

export function publishEvent(event: Omit<AppEvent, "at">): void {
  emitter().emit(CHANNEL, { ...event, at: new Date().toISOString() } satisfies AppEvent);
}

/** Subscribe to all app events; returns the unsubscribe function. */
export function subscribeEvents(listener: (event: AppEvent) => void): () => void {
  const bus = emitter();
  bus.on(CHANNEL, listener);
  return () => bus.off(CHANNEL, listener);
}
