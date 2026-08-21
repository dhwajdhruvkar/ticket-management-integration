// =============================================================================
// Priority derivation (ITIL impact x urgency matrix).
//
// Shared by tickets and problems. Priorities run P1 (critical) .. P5
// (very_low):
//
//   Impact \ Urgency |  high     medium    low
//   -----------------+---------------------------------
//   high             |  critical high      medium
//   medium           |  high     medium    low
//   low              |  medium   low       very_low
// =============================================================================

import type { ImpactLevel, TicketPriority } from "./models";
export { PRIORITY_ORDER, priorityCode } from "../../shared/priority";

const MATRIX: Record<ImpactLevel, Record<ImpactLevel, TicketPriority>> = {
  high: { high: "critical", medium: "high", low: "medium" },
  medium: { high: "high", medium: "medium", low: "low" },
  low: { high: "medium", medium: "low", low: "very_low" },
};

/** ITIL impact x urgency -> priority. Defaults to medium when either is unset. */
export function derivePriority(
  impact?: ImpactLevel | null,
  urgency?: ImpactLevel | null
): TicketPriority {
  if (!impact || !urgency) return "medium";
  return MATRIX[impact][urgency];
}
