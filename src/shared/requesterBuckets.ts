// How a requester's "My requests" list groups tickets, shared by the browser
// (labels, KPI cards), the MemoryStore and the SQL twin so all three agree.
import { PRIORITY_ORDER } from "./priority";

export type RequesterBucket = "open" | "waiting" | "resolved" | "escalated" | "closed";
export type RequesterFilter = "all" | RequesterBucket;
export type RequesterSort = "recent" | "oldest" | "priority";

export const REQUESTER_FILTERS: readonly RequesterFilter[] = ["all", "open", "waiting", "resolved", "escalated", "closed"];
export const REQUESTER_SORTS: readonly RequesterSort[] = ["recent", "oldest", "priority"];

/** Statuses of every bucket except "open", which is everything not listed here. */
export const BUCKET_STATUSES: Record<Exclude<RequesterBucket, "open">, readonly string[]> = {
  waiting: ["pending", "pending_agent"],
  resolved: ["auto_resolved", "resolved"],
  escalated: ["escalated"],
  closed: ["closed", "cancelled"],
};

export function bucketOf(status: string): RequesterBucket {
  for (const bucket of Object.keys(BUCKET_STATUSES) as (keyof typeof BUCKET_STATUSES)[]) {
    if (BUCKET_STATUSES[bucket].includes(status)) return bucket;
  }
  return "open";
}

export const isRequesterFilter = (v: unknown): v is RequesterFilter => typeof v === "string" && (REQUESTER_FILTERS as readonly string[]).includes(v);
export const isRequesterSort = (v: unknown): v is RequesterSort => typeof v === "string" && (REQUESTER_SORTS as readonly string[]).includes(v);

export interface RequesterListSpec {
  bucket: RequesterFilter;
  /** Matches subject, reference, category or subcategory, case-insensitively. */
  q?: string;
  sort: RequesterSort;
  skip: number;
  take: number;
}

export type RequesterCounts = Record<RequesterFilter, number>;
export const emptyRequesterCounts = (): RequesterCounts => ({ all: 0, open: 0, waiting: 0, resolved: 0, escalated: 0, closed: 0 });

interface Sortable { id: string; priority: string; createdAt: string; updatedAt: string }
const code = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0); // code-unit order, like the SQL twin
const byId = (a: Sortable, b: Sortable) => code(a.id, b.id);
const newestUpdate = (a: Sortable, b: Sortable) => code(b.updatedAt, a.updatedAt) || byId(a, b);

/** The ordering the SQL twin reproduces: ties always fall back to most recently updated, then id. */
export function compareRequesterTickets(sort: RequesterSort): (a: Sortable, b: Sortable) => number {
  if (sort === "oldest") return (a, b) => code(a.createdAt, b.createdAt) || byId(a, b);
  if (sort === "priority") return (a, b) => PRIORITY_ORDER.indexOf(a.priority as never) - PRIORITY_ORDER.indexOf(b.priority as never) || newestUpdate(a, b);
  return newestUpdate;
}
