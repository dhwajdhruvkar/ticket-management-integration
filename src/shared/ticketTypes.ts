// Ticket types a user can create, and the type-specific details stored in
// customFields.typeDetails (no schema change). Pure and client-safe: the API
// route, the service, the form and the ticket views share these limits.
//
// "problem" stays in the TicketType enum only so historical tickets keep their
// PRB reference and display; Problem Management is a separate entity and is
// never a creatable ticket type. "change" is the Change Request ticket type;
// the Change Management entity (changeId) is a separate record.

export const CREATABLE_TICKET_TYPES = ["incident", "service_request", "change"] as const;
export type CreatableTicketType = (typeof CREATABLE_TICKET_TYPES)[number];

export const TICKET_TYPE_LABELS: Record<string, string> = {
  incident: "Incident",
  service_request: "Service request",
  change: "Change request",
  problem: "Problem (legacy)",
};

export const TICKET_TYPE_HINTS: Record<CreatableTicketType, string> = {
  incident: "Incident (something is broken)",
  service_request: "Service request (I need something)",
  change: "Change request (a planned change)",
};

export function isCreatableTicketType(value: unknown): value is CreatableTicketType {
  return typeof value === "string" && (CREATABLE_TICKET_TYPES as readonly string[]).includes(value);
}

export const TYPE_DETAIL_LIMITS = { short: 200, long: 4000 } as const;
export const CHANGE_RISKS = ["low", "medium", "high"] as const;
type ChangeRiskLevel = (typeof CHANGE_RISKS)[number];

interface IncidentDetails { affectedService?: string }
interface ServiceRequestDetails {
  requestedItem?: string;
  fulfilmentDetails?: string;
  /** Server-resolved from the catalog item; a client-supplied value is ignored. */
  approvalRequired?: boolean;
}
interface ChangeDetails {
  risk?: ChangeRiskLevel;
  /** Expected scope of effect of the change (separate from the ticket's priority impact). */
  impact?: ChangeRiskLevel;
  implementationPlan?: string;
  /** ISO 8601 start of the maintenance window. */
  maintenanceStart?: string;
  /** ISO 8601 end of the maintenance window. */
  maintenanceEnd?: string;
  rollbackPlan?: string;
}
export type TicketTypeDetails = IncidentDetails | ServiceRequestDetails | ChangeDetails;

const ISO = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : undefined;
}
const isoDate = (value: unknown) => {
  const v = text(value, 40);
  return v && ISO.test(v) && Number.isFinite(Date.parse(v)) ? v : undefined;
};

/**
 * Returns only the fields valid for `type` (unknown keys, wrong types and
 * over-long values are dropped), or null when nothing usable remains.
 * `approvalRequired` is never accepted from the caller.
 */
export function sanitizeTypeDetails(type: string, raw: unknown): TicketTypeDetails | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const put = (key: string, value: unknown) => { if (value !== undefined) out[key] = value; };
  if (type === "incident") {
    put("affectedService", text(input.affectedService, TYPE_DETAIL_LIMITS.short));
  } else if (type === "service_request") {
    put("requestedItem", text(input.requestedItem, TYPE_DETAIL_LIMITS.short));
    put("fulfilmentDetails", text(input.fulfilmentDetails, TYPE_DETAIL_LIMITS.long));
  } else if (type === "change") {
    put("risk", (CHANGE_RISKS as readonly unknown[]).includes(input.risk) ? input.risk : undefined);
    put("impact", (CHANGE_RISKS as readonly unknown[]).includes(input.impact) ? input.impact : undefined);
    put("implementationPlan", text(input.implementationPlan, TYPE_DETAIL_LIMITS.long));
    const start = isoDate(input.maintenanceStart);
    const end = isoDate(input.maintenanceEnd);
    // A window needs both ends and must not run backwards.
    if (start && end && Date.parse(end) > Date.parse(start)) { out.maintenanceStart = start; out.maintenanceEnd = end; }
    put("rollbackPlan", text(input.rollbackPlan, TYPE_DETAIL_LIMITS.long));
  }
  return Object.keys(out).length ? (out as TicketTypeDetails) : null;
}

/** Why `details` is incomplete for creating a ticket of `type`, or null when it is acceptable. */
export function typeDetailsProblem(type: string, raw: unknown): string | null {
  if (type !== "change") return null;
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const clean = sanitizeTypeDetails("change", input) as ChangeDetails | null;
  if (!clean?.risk) return "A change request needs a risk level (low, medium or high).";
  if (!clean.impact) return "A change request needs an impact level (low, medium or high).";
  if (!clean.implementationPlan) return "A change request needs an implementation plan.";
  if (!clean.rollbackPlan) return "A change request needs a rollback plan.";
  if (!clean.maintenanceStart || !clean.maintenanceEnd) return "A change request needs a maintenance window (start before end).";
  return null;
}

/** Details stored on a ticket, re-validated for display. */
export function readTypeDetails(type: string, customFields: unknown): TicketTypeDetails | null {
  const stored = (customFields as { typeDetails?: unknown } | null | undefined)?.typeDetails;
  const clean = sanitizeTypeDetails(type, stored);
  if (type === "service_request" && stored && typeof stored === "object" && typeof (stored as { approvalRequired?: unknown }).approvalRequired === "boolean") {
    return { ...(clean as ServiceRequestDetails | null), approvalRequired: (stored as { approvalRequired: boolean }).approvalRequired };
  }
  return clean;
}

const yesNo = (v: boolean) => (v ? "Yes" : "No");
const when = (iso: string) => new Date(iso).toLocaleString();

/**
 * Display rows (label/value, plain text) for a ticket's type-specific details.
 * `approvals` supplies a change request's live approval status.
 */
export function typeDetailRows(
  type: string,
  customFields: unknown,
  approvals: ReadonlyArray<{ state: string }> = []
): { label: string; value: string }[] {
  const d = (readTypeDetails(type, customFields) ?? {}) as Record<string, unknown>;
  const rows: { label: string; value: string }[] = [];
  const add = (label: string, value: unknown) => { if (typeof value === "string" && value) rows.push({ label, value }); };
  if (type === "incident") add("Affected service", d.affectedService);
  if (type === "service_request") {
    add("Requested item", d.requestedItem);
    add("Fulfilment details", d.fulfilmentDetails);
    if (typeof d.approvalRequired === "boolean") rows.push({ label: "Approval required", value: yesNo(d.approvalRequired) });
  }
  if (type === "change") {
    add("Risk", d.risk);
    add("Change impact", d.impact);
    add("Implementation plan", d.implementationPlan);
    if (typeof d.maintenanceStart === "string" && typeof d.maintenanceEnd === "string") {
      rows.push({ label: "Maintenance window", value: `${when(d.maintenanceStart)} – ${when(d.maintenanceEnd)}` });
    }
    add("Rollback plan", d.rollbackPlan);
    const state = approvals.some((a) => a.state === "rejected") ? "Rejected"
      : approvals.some((a) => a.state === "pending") ? "Pending"
      : approvals.some((a) => a.state === "approved") ? "Approved"
      : "Not requested";
    rows.push({ label: "Approval status", value: state });
  }
  return rows;
}

/**
 * The one entry point for a request's `type` and `typeDetails`: the type must be
 * creatable and the details complete for it. Returns the sanitized details (or
 * undefined when none are usable) or the message to answer with (HTTP 400).
 */
export function checkTypeDetails(
  type: unknown,
  rawDetails: unknown
): { error: string } | { type: CreatableTicketType; details: TicketTypeDetails | undefined } {
  const resolved = type === undefined ? "incident" : type;
  if (!isCreatableTicketType(resolved)) return { error: `type must be one of: ${CREATABLE_TICKET_TYPES.join(", ")}.` };
  const problem = typeDetailsProblem(resolved, rawDetails);
  if (problem) return { error: problem };
  return { type: resolved, details: sanitizeTypeDetails(resolved, rawDetails) ?? undefined };
}
