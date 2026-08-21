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
} from "../domain/models";

export interface ListOptions<T> {
  skip?: number;
  take?: number;
  orderBy?: { field: keyof T; dir: "asc" | "desc" };
  includeDeleted?: boolean;
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

  tenants: Collection<TenantRow>;
  departments: Collection<DepartmentRow>;
  users: Collection<UserRow>;
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
}

/** Shallow equality match used by both drivers' `list`/`count`. */
export function matchesWhere<T extends Entity>(row: T, where?: Partial<T>): boolean {
  if (!where) return true;
  for (const key of Object.keys(where) as (keyof T)[]) {
    if (row[key] !== where[key]) return false;
  }
  return true;
}
