import type { TicketPriority } from "@/server/domain/models";

export interface BucketConfig {
  groupId: string;
  kind: "service_desk" | "department";
  departmentId?: string;
  managerId: string;
  seniorRmId: string;
}
export interface WorkflowSettings {
  enabled: boolean;
  serviceDeskGroupId: string;
  timezone: string;
  availabilityMode: "automatic" | "in_app";
  stages: Record<TicketPriority, { pickupMins: number; managerMins: number }>;
  buckets: BucketConfig[];
}
export interface TicketWorkflow {
  phase: "service_desk" | "department" | "awaiting_acceptance" | "in_progress" | "resolved" | "closed";
  visitId: string;
  queuedAt: string;
  /** Total ticket pause credit on entry, so prior bucket holds are not counted twice. */
  queuedPauseMins?: number;
  /** Working minutes paused within this visit; excludes nights/weekends/holidays. */
  queueWorkingPauseMins?: number;
  reviewerId?: string;
  reviewedAt?: string;
  acceptedById?: string;
  acceptedAt?: string;
  warningAt?: string;
  managerEscalatedAt?: string;
  rmEscalatedAt?: string;
  resolutionEscalatedAt?: string;
  resolutionRmEscalatedAt?: string;
  resolvedById?: string;
  confirmedAt?: string;
  closureReason?: "requester_confirmed" | "no_response" | "staff_closed";
  reminderAt?: string;
}
export function defaultWorkflowSettings(): WorkflowSettings {
  return { enabled: false, serviceDeskGroupId: "", timezone: "UTC", availabilityMode: "automatic", buckets: [], stages: {
    critical: { pickupMins: 5, managerMins: 5 }, high: { pickupMins: 15, managerMins: 15 },
    medium: { pickupMins: 30, managerMins: 30 }, low: { pickupMins: 60, managerMins: 60 }, very_low: { pickupMins: 120, managerMins: 120 },
  } };
}
export const WORKFLOW_LABELS: Record<TicketWorkflow["phase"], string> = {
  service_desk: "Service-desk review", department: "Department queue", awaiting_acceptance: "Assigned · awaiting acceptance",
  in_progress: "Accepted · in progress", resolved: "Resolved · awaiting confirmation", closed: "Closed",
};
