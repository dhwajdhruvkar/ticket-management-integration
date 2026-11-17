// Optional context a requester adds about screenshots or the issue. Stored as
// customFields.issueContext (no schema change). Pure and client-safe so the
// route, the service and the form share one set of limits.

export const ISSUE_CONTEXT_LIMITS = { notes: 4000, occurredAt: 40, activity: 1000 } as const;

export interface IssueContext {
  notes?: string;
  /** ISO 8601 date or date-time of when the problem happened. */
  occurredAt?: string;
  /** What the requester was doing at the time. */
  activity?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : undefined; // over-long values are dropped, never truncated
}

/** The issue context stored on a ticket's customFields, re-validated for display. */
export function readIssueContext(customFields: unknown): IssueContext | null {
  return sanitizeIssueContext((customFields as { issueContext?: unknown } | null | undefined)?.issueContext);
}

/** Returns only valid, trimmed fields (unknown keys ignored), or null when nothing usable remains. */
export function sanitizeIssueContext(raw: unknown): IssueContext | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  const out: IssueContext = {};
  const notes = text(input.notes, ISSUE_CONTEXT_LIMITS.notes);
  if (notes) out.notes = notes;
  const occurredAt = text(input.occurredAt, ISSUE_CONTEXT_LIMITS.occurredAt);
  if (occurredAt && ISO_DATE.test(occurredAt) && Number.isFinite(Date.parse(occurredAt))) out.occurredAt = occurredAt;
  const activity = text(input.activity, ISSUE_CONTEXT_LIMITS.activity);
  if (activity) out.activity = activity;
  return Object.keys(out).length ? out : null;
}
