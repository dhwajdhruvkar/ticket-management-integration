/** Client-safe priority display helpers; contains no server dependencies. */
export const PRIORITY_ORDER = [
  "critical",
  "high",
  "medium",
  "low",
  "very_low",
] as const;

export type SharedTicketPriority = (typeof PRIORITY_ORDER)[number];

/** P-code label for a priority, e.g. "P1". */
export function priorityCode(priority: SharedTicketPriority): string {
  return `P${PRIORITY_ORDER.indexOf(priority) + 1}`;
}
