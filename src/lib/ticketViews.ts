// Client-safe saved-view rules for the ticket explorer. They run on the server
// (so the browser receives one page instead of every ticket) and are unit tested.
import type { TicketRow } from "@/server/domain/models";
import { applyTicketFilters, type TicketFilters } from "@/lib/ticketFilters";

const UNSOLVED = ["new", "open", "in_progress", "pending", "pending_agent", "escalated", "reopened"];
const SOLVED = ["auto_resolved", "resolved", "closed"];
const byUpdatedDesc = (a: TicketRow, b: TicketRow) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();

interface ViewRule { predicate: (t: TicketRow, meId: string) => boolean; sort?: (a: TicketRow, b: TicketRow) => number }

export const TICKET_VIEW_RULES = {
  your_unsolved: { predicate: (t, me) => t.assigneeId === me && UNSOLVED.includes(t.status) },
  unassigned: { predicate: (t) => !t.assigneeId && UNSOLVED.includes(t.status) },
  all_unsolved: { predicate: (t) => UNSOLVED.includes(t.status) },
  pending: { predicate: (t) => t.status === "pending_agent" || t.status === "pending" },
  recently_updated: { predicate: () => true, sort: byUpdatedDesc },
  recently_solved: { predicate: (t) => SOLVED.includes(t.status), sort: byUpdatedDesc },
  all: { predicate: () => true },
} satisfies Record<string, ViewRule>;

export type TicketViewId = keyof typeof TICKET_VIEW_RULES;
export const isTicketViewId = (value: string | null | undefined): value is TicketViewId => !!value && Object.hasOwn(TICKET_VIEW_RULES, value);

export interface TicketSearch { meId: string; view: TicketViewId; filters: TicketFilters; q?: string }

/**
 * `tickets` must arrive in the default list order (createdAt desc). Counts
 * cover every ticket per view (ignoring filters and search), like the sidebar
 * always did; `rows` is the filtered, searched, view-sorted result.
 */
export function searchTicketRows(tickets: TicketRow[], { meId, view, filters, q }: TicketSearch, nowMs = Date.now()): { rows: TicketRow[]; counts: Record<string, number> } {
  const counts: Record<string, number> = {};
  for (const id of Object.keys(TICKET_VIEW_RULES) as TicketViewId[]) counts[id] = tickets.filter((t) => TICKET_VIEW_RULES[id].predicate(t, meId)).length;
  const rule: ViewRule = TICKET_VIEW_RULES[view];
  let rows = applyTicketFilters(tickets.filter((t) => rule.predicate(t, meId)), filters, nowMs);
  if (rule.sort) rows = [...rows].sort(rule.sort);
  const needle = q?.toLowerCase();
  if (needle) rows = rows.filter((t) => t.subject.toLowerCase().includes(needle) || t.requesterEmail.toLowerCase().includes(needle) || t.reference.toLowerCase().includes(needle));
  return { rows, counts };
}
