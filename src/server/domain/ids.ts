// =============================================================================
// ID + reference generation.
//
// Central helpers for every identifier in the system so their shape is
// consistent and greppable: opaque row ids (`newId`), human-facing ticket/
// record references (`reference` / `ticketReference`, e.g. INC-9F2A1C which the
// UI and email subject tokens rely on), and ISO timestamp helpers used across
// services and the seed. Keep all id/timestamp formatting here — nothing else
// should hand-roll these.
// =============================================================================

import { randomUUID } from "node:crypto";
import type { TicketType } from "./models";

/** Opaque id with optional prefix, e.g. newId("kb") -> "kb_3f9a...". */
export function newId(prefix = ""): string {
  const id = randomUUID().replace(/-/g, "").slice(0, 20);
  return prefix ? `${prefix}_${id}` : id;
}

/** Human-friendly reference, e.g. reference("PRB") -> "PRB-9F2A1C". */
export function reference(prefix: string): string {
  const n = randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
  return `${prefix}-${n}`;
}

const TICKET_PREFIX: Record<TicketType, string> = {
  incident: "INC",
  service_request: "REQ",
  problem: "PRB",
  change: "CHG",
};

/** Type-prefixed ticket reference, e.g. incident -> "INC-9F2A1C". */
export function ticketReference(type: TicketType): string {
  return reference(TICKET_PREFIX[type]);
}

/** Current time as an ISO string — the canonical timestamp format for all rows. */
export function now(): string {
  return new Date().toISOString();
}

/** ISO string for `mins` minutes ago (handy for realistic seed timestamps). */
export function minutesAgo(mins: number): string {
  return new Date(Date.now() - mins * 60_000).toISOString();
}
