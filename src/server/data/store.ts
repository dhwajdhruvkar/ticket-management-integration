// =============================================================================
// DataStore port (hexagonal architecture).
//
// A small, declarative collection interface that BOTH the in-memory/JSON store
// and the Prisma/Postgres store implement. Services depend only on this port,
// so swapping persistence is a one-line env change (DATA_DRIVER) with zero
// changes anywhere else.
//
// `where` is a shallow equality filter (field === value) — enough for tenant
// scoping and status/type/assignee filters. Anything richer is composed in the
// service layer from these primitives (fine at service-desk data volumes).
// =============================================================================

import type {
  ApiKeyRow,
  ApprovalRow,
  ArticleRow,
  AssetRow,
  AssignmentGroupRow,
  AttachmentRow,
  AuditRow,
  AutomationRow,
  BusinessCalendarRow,
  CIRelationshipRow,
  CIRow,
  CatalogItemRow,
  CitationRow,
  ChangeRow,
  CustomFieldDefRow,
  DepartmentRow,
  EmailMessageRow,
  Entity,
  MacroRow,
  NotificationRow,
  ProblemRow,
  ResolutionRow,
  SlaPolicyRow,
  TenantRow,
  TicketEventRow,
  TicketMessageRow,
  TicketRow,
  UserRow,
  UserInvitationRow,
  WebhookDeliveryRow,
  JobLeaseRow,
  PublicRateLimitRow,
  TicketAcknowledgementRow,
  NotificationDeliveryRow,
} from "../domain/models";
import type { TicketFilters } from "@/lib/ticketFilters";
import type { TicketViewId } from "@/lib/ticketViews";

export interface ListOptions<T> {
  /** Stable ID cursor; use with orderBy id ascending. */
  afterId?: string;
  skip?: number;
  take?: number;
  orderBy?: { field: keyof T; dir: "asc" | "desc" };
  includeDeleted?: boolean;
  /**
   * Column projection for read-heavy reports. Rows are still typed as T, so
   * callers must only read the listed fields. The memory driver returns full
   * rows (a superset), which is safe for the same callers.
   */
  select?: (keyof T)[];
}

/** Caller-supplied equality scope for the explorer query (record-level security lives here). */
export interface TicketSearchScope {
  status?: TicketRow["status"];
  type?: TicketRow["type"];
  assigneeId?: string | null;
  assignmentGroupId?: string;
  requesterEmail?: string;
}

export interface TicketSearchSpec {
  scope: TicketSearchScope;
  meId: string;
  view: TicketViewId;
  filters: TicketFilters;
  q?: string;
  skip: number;
  take: number;
}

export interface PageResult<T> {
  data: T[];
  total: number;
}

export interface Collection<T extends Entity> {
  list(where?: Partial<T>, options?: ListOptions<T>): Promise<T[]>;
  get(id: string): Promise<T | null>;
  create(value: T): Promise<T>;
  update(id: string, patch: Partial<T>): Promise<T | null>;
  /** Atomic compare-and-set; null means another writer changed the expected fields. */
  updateIf(id: string, expected: Partial<T>, patch: Partial<T>): Promise<T | null>;
  remove(id: string): Promise<boolean>;
  count(where?: Partial<T>): Promise<number>;
}

/**
 * Fetch one page and its unpaginated count from the same collection/filter.
 * Keeping this operation in the datastore port prevents services from
 * accidentally counting only the current page.
 */
export async function pageCollection<T extends Entity>(
  collection: Collection<T>,
  where?: Partial<T>,
  options?: ListOptions<T>
): Promise<PageResult<T>> {
  const [data, total] = await Promise.all([
    collection.list(where, options),
    collection.count(where),
  ]);
  return { data, total };
}

export interface DataStore {
  readonly driver: "memory" | "prisma";
  ready(): Promise<void>;
  /** Resolutions of this tenant's non-deleted tickets, filtered inside the query. */
  resolutionsForTenant(tenantId: string): Promise<Pick<ResolutionRow, "ticketId" | "decision" | "confidence">[]>;
  /** Events of one type on this tenant's non-deleted tickets, filtered inside the query. */
  eventsForTenant(tenantId: string, type: TicketEventRow["type"]): Promise<Pick<TicketEventRow, "ticketId" | "type" | "createdAt">[]>;
  /** One recipient's in-app feed page (email compared case-insensitively) with its total and unread counts. */
  notificationsFor(tenantId: string, email: string, page: { skip: number; take: number; dir: "asc" | "desc" }): Promise<{ items: NotificationRow[]; total: number; unread: number }>;
  /** Mark one recipient's unread notifications read (optionally just `id`); returns how many changed. */
  markNotificationsRead(tenantId: string, email: string, readAt: string, id?: string): Promise<number>;
  /**
   * Explorer query: saved view + filters + search + paging for one tenant's
   * non-deleted tickets, with the unfiltered per-view counts. Rows omit `body`
   * on the Prisma driver. The tenant is a required argument.
   */
  searchTickets(tenantId: string, spec: TicketSearchSpec): Promise<{ data: TicketRow[]; total: number; counts: Record<string, number> }>;
  /**
   * Tickets taking part in workflow monitoring (workflow present, not deleted,
   * not closed/cancelled), narrowed to `visibleTo` when given (assigned to the
   * user or in one of their groups), plus the count of ALL such tickets in the
   * tenant. Prisma rows carry only the columns bucketHealth() reads.
   */
  workflowAlertTickets(tenantId: string, visibleTo: { userId: string; groupIds: string[] } | null): Promise<{ tickets: TicketRow[]; workflowCount: number }>;
  transaction<T>(work: (store: DataStore) => Promise<T>): Promise<T>;

  tenants: Collection<TenantRow>;
  departments: Collection<DepartmentRow>;
  users: Collection<UserRow>;
  invitations: Collection<UserInvitationRow>;
  groups: Collection<AssignmentGroupRow>;
  tickets: Collection<TicketRow>;
  messages: Collection<TicketMessageRow>;
  events: Collection<TicketEventRow>;
  resolutions: Collection<ResolutionRow>;
  citations: Collection<CitationRow>;
  articles: Collection<ArticleRow>;
  problems: Collection<ProblemRow>;
  changes: Collection<ChangeRow>;
  approvals: Collection<ApprovalRow>;
  assets: Collection<AssetRow>;
  cis: Collection<CIRow>;
  ciRelationships: Collection<CIRelationshipRow>;
  catalogItems: Collection<CatalogItemRow>;
  slaPolicies: Collection<SlaPolicyRow>;
  automations: Collection<AutomationRow>;
  macros: Collection<MacroRow>;
  customFieldDefs: Collection<CustomFieldDefRow>;
  attachments: Collection<AttachmentRow>;
  notifications: Collection<NotificationRow>;
  audit: Collection<AuditRow>;
  apiKeys: Collection<ApiKeyRow>;
  emails: Collection<EmailMessageRow>;
  calendars: Collection<BusinessCalendarRow>;
  webhookDeliveries: Collection<WebhookDeliveryRow>;
  jobLeases: Collection<JobLeaseRow>;
  publicRateLimits: Collection<PublicRateLimitRow>;
  acknowledgements: Collection<TicketAcknowledgementRow>;
  notificationDeliveries: Collection<NotificationDeliveryRow>;
}

/** Shallow equality match used by both drivers' `list`/`count`. */
export function matchesWhere<T extends Entity>(row: T, where?: Partial<T>): boolean {
  if (!where) return true;
  for (const key of Object.keys(where) as (keyof T)[]) {
    if (row[key] !== where[key]) return false;
  }
  return true;
}
