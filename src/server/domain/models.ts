// =============================================================================
// Server domain model.
//
// Normalized, serializable "row" types that mirror the Prisma schema's scalar
// fields exactly (relations are referenced by scalar FK id). Dates are ISO
// strings so the same shape flows through the in-memory/JSON store, the Prisma
// store, the REST API, and the UI without conversion surprises.
// =============================================================================

export type Role = "super_admin" | "tenant_admin" | "manager" | "agent" | "requester";

export type TicketType = "incident" | "service_request" | "problem" | "change";

export type TicketStatus =
  | "new"
  | "open"
  | "in_progress"
  | "pending"
  | "auto_resolved"
  | "pending_agent"
  | "escalated"
  | "resolved"
  | "reopened"
  | "closed"
  | "cancelled";

/** P1 (critical) .. P5 (very_low), derived from impact x urgency. */
export type TicketPriority = "critical" | "high" | "medium" | "low" | "very_low";

export type TicketChannel = "email" | "portal" | "chat" | "api" | "phone" | "teams";

export type TicketCategory =
  | "IT"
  | "HR"
  | "Access"
  | "Software"
  | "Hardware"
  | "Network"
  | "Billing"
  | "Other";

export type ResolutionDecision = "auto_resolve" | "suggest" | "escalate";
export type MessageAuthorKind = "requester" | "agent" | "assistant" | "system";
export type MessageVisibility = "public" | "internal";
export type ArticleStatus = "draft" | "in_review" | "published" | "archived";
export type ProblemStatus = "open" | "investigating" | "known_error" | "resolved" | "closed";
export type ChangeType = "standard" | "normal" | "emergency";
export type ChangeStatus =
  | "draft"
  | "assessing"
  | "awaiting_approval"
  | "approved"
  | "rejected"
  | "scheduled"
  | "implementing"
  | "review"
  | "closed"
  | "cancelled";
export type ApprovalState = "pending" | "approved" | "rejected" | "cancelled";
export type AssetStatus = "in_stock" | "assigned" | "in_repair" | "retired";
export type CIType =
  | "application"
  | "server"
  | "database"
  | "network"
  | "service"
  | "endpoint"
  | "other";
export type NotificationChannel = "email" | "teams" | "slack" | "in_app";

export interface Entity {
  id: string;
}

export interface TenantRow extends Entity {
  name: string;
  slug: string;
  brand?: string | null;
  isInternal: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A department within an organization (tenant) that users can belong to. */
export interface DepartmentRow extends Entity {
  tenantId: string;
  name: string;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserPreferences {
  emailNotifications: boolean;
  desktopNotifications: boolean;
  weeklyDigest: boolean;
  mentionAlerts: boolean;
  /** Managers/admins: receive the monthly service-desk report by email. */
  monthlyReport?: boolean;
}

export interface UserRow extends Entity {
  tenantId: string;
  email: string;
  name: string;
  role: Role;
  title?: string | null;
  department?: string | null;
  /** FK to a DepartmentRow; `department` holds the display name (kept in sync). */
  departmentId?: string | null;
  initials?: string | null;
  active: boolean;
  externalId?: string | null;
  phone?: string | null;
  location?: string | null;
  timezone?: string | null;
  bio?: string | null;
  preferences?: UserPreferences | null;
  /** VIP requesters get an urgency floor + "vip" tag on intake. */
  vip?: boolean;
  /** Agent availability for dispatch: false = "Away", not accepting new tickets. */
  available?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TicketRow extends Entity {
  reference: string;
  tenantId: string;
  type: TicketType;
  subject: string;
  body: string;
  status: TicketStatus;
  priority: TicketPriority;
  impact?: ImpactLevel | null;
  urgency?: ImpactLevel | null;
  category: TicketCategory;
  subcategory?: string | null;
  channel: TicketChannel;
  source?: string | null;
  tags: string[];
  customFields?: Record<string, unknown> | null;
  requesterEmail: string;
  requesterId?: string | null;
  assigneeId?: string | null;
  assignmentGroupId?: string | null;
  problemId?: string | null;
  changeId?: string | null;
  catalogItemId?: string | null;
  /** Linked CMDB configuration items (by CI id). */
  ciIds: string[];
  /** Related tickets (symmetric ticket-to-ticket links, by ticket id). */
  linkedTicketIds: string[];
  /** Set when this ticket was merged into another; the target's id. */
  mergedIntoId?: string | null;
  satisfaction?: string | null;
  resolutionNotes?: string | null;
  /** Why the assigned agent could not resolve it, captured on manual escalation. */
  escalationReason?: string | null;
  escalatedById?: string | null;
  escalatedAt?: string | null;
  firstRespondedAt?: string | null;
  resolvedAt?: string | null;
  closedAt?: string | null;
  dueResponseAt?: string | null;
  dueResolveAt?: string | null;
  slaPolicyId?: string | null;
  /** SLA clock pause while the ticket sits in `pending`. */
  slaPausedAt?: string | null;
  slaPausedMins: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type AssignmentStrategy = "manual" | "round_robin" | "least_loaded";

export interface AssignmentGroupRow extends Entity {
  tenantId: string;
  name: string;
  description?: string | null;
  memberIds: string[];
  /** Categories auto-routed to this group on intake. */
  categories: TicketCategory[];
  leadId?: string | null;
  /** Auto-assignment strategy for routed tickets (default manual). */
  strategy?: AssignmentStrategy;
  /** Round-robin cursor (index of the last assigned member). */
  lastAssignedIndex?: number;
  createdAt: string;
  updatedAt: string;
}

export interface TicketMessageRow extends Entity {
  ticketId: string;
  authorKind: MessageAuthorKind;
  authorName: string;
  visibility: MessageVisibility;
  body: string;
  createdAt: string;
}

export interface TicketEventRow extends Entity {
  ticketId: string;
  type: string;
  message: string;
  meta?: Record<string, unknown> | null;
  createdAt: string;
}

export interface ResolutionRow extends Entity {
  ticketId: string;
  answer: string;
  confidence: number;
  decision: ResolutionDecision;
  reasoning: string;
  model: string;
  embeddingModel: string;
  latencyMs: number;
  createdAt: string;
}

export interface CitationRow extends Entity {
  resolutionId: string;
  articleId: string;
  title: string;
  score: number;
  snippet: string;
}

export interface ArticleRow extends Entity {
  tenantId: string;
  title: string;
  content: string;
  category: TicketCategory;
  tags: string[];
  status: ArticleStatus;
  version: number;
  authorId?: string | null;
  isPublic: boolean;
  embedding: number[];
  embeddingModel: string;
  createdAt: string;
  updatedAt: string;
}

export type ImpactLevel = "low" | "medium" | "high";
export type RcaMethod = "five_whys" | "ishikawa" | "timeline" | "other";

export interface ProblemNote {
  id: string;
  author: string;
  body: string;
  at: string;
}

export interface ProblemRow extends Entity {
  reference: string;
  tenantId: string;
  title: string;
  description: string;
  status: ProblemStatus;
  priority: TicketPriority;
  impact?: ImpactLevel | null;
  urgency?: ImpactLevel | null;
  category: TicketCategory;
  rootCause?: string | null;
  rcaMethod?: RcaMethod | null;
  workaround?: string | null;
  knownError: boolean;
  publishedArticleId?: string | null;
  changeId?: string | null;
  reviewNotes?: string | null;
  notes?: ProblemNote[] | null;
  assigneeId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChangeRow extends Entity {
  reference: string;
  tenantId: string;
  title: string;
  description: string;
  type: ChangeType;
  status: ChangeStatus;
  riskScore?: number | null;
  riskRationale?: string | null;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  implementer?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalRow extends Entity {
  changeId?: string | null;
  ticketId?: string | null;
  approverId?: string | null;
  approverName: string;
  state: ApprovalState;
  comment?: string | null;
  decidedAt?: string | null;
  createdAt: string;
}

export interface AssetRow extends Entity {
  tenantId: string;
  tag: string;
  name: string;
  type: string;
  status: AssetStatus;
  owner?: string | null;
  purchasedAt?: string | null;
  warrantyEnd?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CIRow extends Entity {
  tenantId: string;
  name: string;
  type: CIType;
  status: string;
  assetId?: string | null;
  attributes?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface CIRelationshipRow extends Entity {
  sourceId: string;
  targetId: string;
  kind: string;
}

export interface CatalogItemRow extends Entity {
  tenantId: string;
  name: string;
  description: string;
  category: TicketCategory;
  requiresApproval: boolean;
  formSchema?: Record<string, unknown> | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SlaPolicyRow extends Entity {
  tenantId: string;
  name: string;
  priority: TicketPriority;
  responseMins: number;
  resolveMins: number;
  businessHoursOnly: boolean;
  /** Optional business calendar; overrides the built-in window when set. */
  calendarId?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Named business-hours calendar (timezone, working window, holidays). */
export interface BusinessCalendarRow extends Entity {
  tenantId: string;
  name: string;
  /** IANA timezone, e.g. "Asia/Kolkata". */
  timezone: string;
  /** Working weekdays, 0=Sunday .. 6=Saturday. */
  workDays: number[];
  startHour: number;
  endHour: number;
  /** Holiday dates as YYYY-MM-DD in the calendar's timezone. */
  holidays: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRow extends Entity {
  tenantId: string;
  name: string;
  enabled: boolean;
  trigger: string;
  conditions: unknown;
  actions: unknown;
  runCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Reusable canned response an agent can insert into a reply or note. */
export interface MacroRow extends Entity {
  tenantId: string;
  name: string;
  body: string;
  /** Which composer tab the macro is meant for (internal notes vs public replies). */
  visibility: MessageVisibility;
  category?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CustomFieldType = "text" | "number" | "select" | "date" | "checkbox";

/** Per-tenant custom field definition; values live in TicketRow.customFields. */
export interface CustomFieldDefRow extends Entity {
  tenantId: string;
  /** Stable key used inside TicketRow.customFields. */
  key: string;
  label: string;
  /** Admin-authored help text shown as the field's "i" tooltip. */
  description: string | null;
  type: CustomFieldType;
  /** Options for `select` type. */
  options: string[];
  required: boolean;
  /** Display order in the properties panel. */
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface AttachmentRow extends Entity {
  ticketId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  blobUrl: string;
  createdAt: string;
}

export interface NotificationRow extends Entity {
  tenantId: string;
  channel: NotificationChannel;
  toAddress: string;
  subject: string;
  body: string;
  /** App-relative destination the in-app feed navigates to (e.g. "/tickets/tkt_1"). */
  link?: string | null;
  sent: boolean;
  sentAt?: string | null;
  readAt?: string | null;
  createdAt: string;
}

export interface AuditRow extends Entity {
  tenantId: string;
  index: number;
  timestamp: string;
  actor: string;
  action: string;
  ticketId?: string | null;
  payload: Record<string, unknown>;
  payloadHash: string;
  prevHash: string;
  hash: string;
}

/** Machine-to-machine API key. Only the SHA-256 hash of the key is stored. */
export interface ApiKeyRow extends Entity {
  tenantId: string;
  name: string;
  prefix: string;
  keyHash: string;
  role: Role;
  /** Agents this integration key acts on behalf of (attribution/scoping). */
  agentIds?: string[];
  /** Optional description of the integration/application. */
  description?: string | null;
  active: boolean;
  lastUsedAt?: string | null;
  expiresAt?: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type EmailDirection = "inbound" | "outbound";
export type EmailStatus =
  | "processed"
  | "skipped_duplicate"
  | "skipped_loop"
  | "skipped_spam"
  | "failed";

/** Mailbox ledger row — dedupe (internetMessageId) + threading (conversationId / inReplyTo). */
export interface EmailMessageRow extends Entity {
  tenantId: string;
  direction: EmailDirection;
  providerId?: string | null;
  internetMessageId?: string | null;
  conversationId?: string | null;
  inReplyTo?: string | null;
  referencesHeader?: string | null;
  fromAddress: string;
  toAddress?: string | null;
  subject: string;
  bodyText: string;
  hasAttachments: boolean;
  status: EmailStatus;
  ticketId?: string | null;
  receivedAt?: string | null;
  createdAt: string;
}
