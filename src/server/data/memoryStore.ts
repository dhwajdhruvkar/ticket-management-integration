// =============================================================================
// In-memory data store with JSON-file persistence.
//
// The zero-infrastructure default. Holds all collections in memory, persists
// the whole dataset to .data/store.json on every mutation, and seeds itself on
// first run. Reads/writes are deep-cloned so callers can't mutate internal
// state by reference (mirrors how the Prisma store returns fresh objects).
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import { config } from "../config";
import { buildSeed } from "./seed";
import { matchesWhere, type Collection, type DataStore } from "./store";
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

// Bump when the row shapes change incompatibly (e.g. the P1-P5 priority
// migration): an on-disk store with a different version is discarded and
// reseeded so stale demo data can't crash the new code.
// v4: notification deep links + expanded user roster / People Operations group.
// v5: macros, custom field definitions, ticket link/merge fields.
// v6: agent availability + specialist/generalist assignment-group profiles.
// v7: first-class departments + user.departmentId.
// v8: full-workflow demo data (changes/CAB, approvals, CI graph, notifications,
//     integrations, business calendar, SLA due dates, all ticket statuses).
// v9: admin-authored help text on custom field definitions.
// v10: SLA deadlines recomputed with the fixed business-hours walker, so seeded
//      due dates from v9 are wrong for business-hours policies.
const SCHEMA_VERSION = 10;

interface MemDb {
  version?: number;
  tenants: TenantRow[];
  departments: DepartmentRow[];
  users: UserRow[];
  groups: AssignmentGroupRow[];
  tickets: TicketRow[];
  messages: TicketMessageRow[];
  events: TicketEventRow[];
  resolutions: ResolutionRow[];
  citations: CitationRow[];
  articles: ArticleRow[];
  problems: ProblemRow[];
  changes: ChangeRow[];
  approvals: ApprovalRow[];
  assets: AssetRow[];
  cis: CIRow[];
  ciRelationships: CIRelationshipRow[];
  catalogItems: CatalogItemRow[];
  slaPolicies: SlaPolicyRow[];
  automations: AutomationRow[];
  macros: MacroRow[];
  customFieldDefs: CustomFieldDefRow[];
  attachments: AttachmentRow[];
  notifications: NotificationRow[];
  audit: AuditRow[];
  apiKeys: ApiKeyRow[];
  emails: EmailMessageRow[];
  calendars: BusinessCalendarRow[];
}

function emptyDb(): MemDb {
  return {
    version: SCHEMA_VERSION,
    tenants: [], departments: [], users: [], groups: [], tickets: [], messages: [], events: [],
    resolutions: [], citations: [], articles: [], problems: [], changes: [],
    approvals: [], assets: [], cis: [], ciRelationships: [], catalogItems: [],
    slaPolicies: [], automations: [], macros: [], customFieldDefs: [], attachments: [], notifications: [], audit: [],
    apiKeys: [], emails: [], calendars: [],
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * One collection backed by an in-memory array. `rows` returns the live array
 * from the parent DB object and `persist` flushes the whole DB to disk after a
 * mutation. Values are deep-cloned in and out so callers can never mutate
 * internal state by reference (mirroring how the Prisma store returns fresh
 * objects).
 */
class MemoryCollection<T extends Entity> implements Collection<T> {
  constructor(
    private readonly rows: () => T[],
    private readonly persist: () => void,
    /**
     * Mirrors `onDelete: Cascade` in the Prisma schema. Without it the memory
     * driver leaves orphaned children (a deleted ticket keeps its messages and
     * attachments), so the two drivers disagree about what "deleted" means.
     */
    private readonly cascade?: (id: string) => void,
    /**
     * Mirrors an `@unique` column in the Prisma schema. Creating a row that
     * collides throws, exactly as the database would, instead of quietly
     * accumulating duplicates only this driver can hold.
     */
    private readonly uniqueBy?: keyof T
  ) {}

  async list(where?: Partial<T>): Promise<T[]> {
    return this.rows()
      .filter((r) => matchesWhere(r, where))
      .map(clone);
  }
  async get(id: string): Promise<T | null> {
    const found = this.rows().find((r) => r.id === id);
    return found ? clone(found) : null;
  }
  async create(value: T): Promise<T> {
    if (this.uniqueBy) {
      const key = this.uniqueBy;
      if (this.rows().some((r) => r[key] === value[key])) {
        throw new Error(`Unique constraint failed on ${String(key)}.`);
      }
    }
    this.rows().push(clone(value));
    this.persist();
    return clone(value);
  }
  async update(id: string, patch: Partial<T>): Promise<T | null> {
    const arr = this.rows();
    const idx = arr.findIndex((r) => r.id === id);
    if (idx < 0) return null;
    // Prisma semantics: undefined means "leave unchanged" — strip those keys
    // so a partial patch can never blank out existing fields.
    const cleaned = Object.fromEntries(
      Object.entries(clone(patch)).filter(([, v]) => v !== undefined)
    ) as Partial<T>;
    arr[idx] = { ...arr[idx], ...cleaned };
    this.persist();
    return clone(arr[idx]);
  }
  async remove(id: string): Promise<boolean> {
    const arr = this.rows();
    const idx = arr.findIndex((r) => r.id === id);
    if (idx < 0) return false;
    arr.splice(idx, 1);
    this.cascade?.(id);
    this.persist();
    return true;
  }
  async count(where?: Partial<T>): Promise<number> {
    return this.rows().filter((r) => matchesWhere(r, where)).length;
  }
}

export class MemoryStore implements DataStore {
  readonly driver = "memory" as const;

  private db: MemDb = emptyDb();
  private initPromise: Promise<void> | null = null;
  private readonly filePath = path.join(process.cwd(), config.dataDir, "store.json");

  tenants = new MemoryCollection<TenantRow>(() => this.db.tenants, () => this.persist(), (id) =>
    this.cascadeTenant(id)
  );
  departments = new MemoryCollection<DepartmentRow>(() => this.db.departments, () => this.persist());
  users = new MemoryCollection<UserRow>(() => this.db.users, () => this.persist());
  groups = new MemoryCollection<AssignmentGroupRow>(() => this.db.groups, () => this.persist());
  tickets = new MemoryCollection<TicketRow>(() => this.db.tickets, () => this.persist(), (id) =>
    this.cascadeTicket(id)
  );
  messages = new MemoryCollection<TicketMessageRow>(() => this.db.messages, () => this.persist());
  events = new MemoryCollection<TicketEventRow>(() => this.db.events, () => this.persist());
  // A ticket has at most one resolution (Resolution.ticketId is @unique).
  resolutions = new MemoryCollection<ResolutionRow>(
    () => this.db.resolutions,
    () => this.persist(),
    (id) => {
      this.db.citations = this.db.citations.filter((c) => c.resolutionId !== id);
    },
    "ticketId"
  );
  citations = new MemoryCollection<CitationRow>(() => this.db.citations, () => this.persist());
  articles = new MemoryCollection<ArticleRow>(() => this.db.articles, () => this.persist());
  problems = new MemoryCollection<ProblemRow>(() => this.db.problems, () => this.persist(), (id) => {
    // Prisma nulls the FK rather than deleting the incidents.
    for (const t of this.db.tickets) if (t.problemId === id) t.problemId = null;
  });
  changes = new MemoryCollection<ChangeRow>(() => this.db.changes, () => this.persist(), (id) => {
    this.db.approvals = this.db.approvals.filter((a) => a.changeId !== id);
  });
  approvals = new MemoryCollection<ApprovalRow>(() => this.db.approvals, () => this.persist());
  assets = new MemoryCollection<AssetRow>(() => this.db.assets, () => this.persist());
  cis = new MemoryCollection<CIRow>(() => this.db.cis, () => this.persist(), (id) => {
    this.db.ciRelationships = this.db.ciRelationships.filter(
      (r) => r.sourceId !== id && r.targetId !== id
    );
  });
  ciRelationships = new MemoryCollection<CIRelationshipRow>(() => this.db.ciRelationships, () => this.persist());
  catalogItems = new MemoryCollection<CatalogItemRow>(() => this.db.catalogItems, () => this.persist());
  slaPolicies = new MemoryCollection<SlaPolicyRow>(() => this.db.slaPolicies, () => this.persist());
  automations = new MemoryCollection<AutomationRow>(() => this.db.automations, () => this.persist());
  macros = new MemoryCollection<MacroRow>(() => this.db.macros, () => this.persist());
  customFieldDefs = new MemoryCollection<CustomFieldDefRow>(() => this.db.customFieldDefs, () => this.persist());
  attachments = new MemoryCollection<AttachmentRow>(() => this.db.attachments, () => this.persist());
  notifications = new MemoryCollection<NotificationRow>(() => this.db.notifications, () => this.persist());
  audit = new MemoryCollection<AuditRow>(() => this.db.audit, () => this.persist());
  apiKeys = new MemoryCollection<ApiKeyRow>(() => this.db.apiKeys, () => this.persist());
  emails = new MemoryCollection<EmailMessageRow>(() => this.db.emails, () => this.persist());
  calendars = new MemoryCollection<BusinessCalendarRow>(() => this.db.calendars, () => this.persist());

  ready(): Promise<void> {
    this.initPromise ??= this.init();
    return this.initPromise;
  }

  /** Children of a ticket, matching the ticket relations marked Cascade. */
  private cascadeTicket(ticketId: string): void {
    const resolutionIds = new Set(
      this.db.resolutions.filter((r) => r.ticketId === ticketId).map((r) => r.id)
    );
    this.db.messages = this.db.messages.filter((m) => m.ticketId !== ticketId);
    this.db.events = this.db.events.filter((e) => e.ticketId !== ticketId);
    this.db.resolutions = this.db.resolutions.filter((r) => r.ticketId !== ticketId);
    this.db.citations = this.db.citations.filter((c) => !resolutionIds.has(c.resolutionId));
    this.db.approvals = this.db.approvals.filter((a) => a.ticketId !== ticketId);
    this.db.attachments = this.db.attachments.filter((a) => a.ticketId !== ticketId);
    for (const t of this.db.tickets) {
      if (t.mergedIntoId === ticketId) t.mergedIntoId = null;
      if (t.linkedTicketIds?.includes(ticketId)) {
        t.linkedTicketIds = t.linkedTicketIds.filter((x) => x !== ticketId);
      }
    }
  }

  /** Everything a tenant owns, matching the Cascade relations on Tenant. */
  private cascadeTenant(tenantId: string): void {
    for (const ticket of this.db.tickets.filter((t) => t.tenantId === tenantId)) {
      this.cascadeTicket(ticket.id);
    }
    const changeIds = new Set(
      this.db.changes.filter((c) => c.tenantId === tenantId).map((c) => c.id)
    );
    const ciIds = new Set(this.db.cis.filter((c) => c.tenantId === tenantId).map((c) => c.id));
    this.db.approvals = this.db.approvals.filter(
      (a) => !(a.changeId && changeIds.has(a.changeId))
    );
    this.db.ciRelationships = this.db.ciRelationships.filter(
      (r) => !ciIds.has(r.sourceId) && !ciIds.has(r.targetId)
    );

    const owned = <R extends { tenantId: string }>(rows: R[]) =>
      rows.filter((r) => r.tenantId !== tenantId);
    this.db.tickets = owned(this.db.tickets);
    this.db.departments = owned(this.db.departments);
    this.db.users = owned(this.db.users);
    this.db.groups = owned(this.db.groups);
    this.db.articles = owned(this.db.articles);
    this.db.problems = owned(this.db.problems);
    this.db.changes = owned(this.db.changes);
    this.db.assets = owned(this.db.assets);
    this.db.cis = owned(this.db.cis);
    this.db.catalogItems = owned(this.db.catalogItems);
    this.db.slaPolicies = owned(this.db.slaPolicies);
    this.db.automations = owned(this.db.automations);
    this.db.macros = owned(this.db.macros);
    this.db.customFieldDefs = owned(this.db.customFieldDefs);
    this.db.notifications = owned(this.db.notifications);
    this.db.audit = owned(this.db.audit);
    this.db.apiKeys = owned(this.db.apiKeys);
    this.db.calendars = owned(this.db.calendars);
  }

  // Load persisted data if present and version-compatible; otherwise seed fresh.
  private async init(): Promise<void> {
    if (this.loadFromDisk()) return;
    const seed = await buildSeed();
    this.db = { ...emptyDb(), ...seed };
    this.persist();
  }

  // Read store.json; reseed (return false) when it's absent, corrupt, or from
  // an incompatible SCHEMA_VERSION. Missing collections are backfilled empty.
  private loadFromDisk(): boolean {
    try {
      if (!fs.existsSync(this.filePath)) return false;
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<MemDb>;
      if (parsed.version !== SCHEMA_VERSION) {
        console.log("[memoryStore] store.json schema changed — reseeding.");
        return false;
      }
      this.db = { ...emptyDb(), ...parsed };
      return this.db.tenants.length > 0;
    } catch (err) {
      console.error("[memoryStore] failed to load store.json, reseeding:", err);
      return false;
    }
  }

  // Flush the entire DB to store.json. Best-effort: a read-only FS (e.g.
  // serverless) is tolerated and the app keeps running in memory only.
  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.db, null, 2), "utf8");
    } catch {
      // Read-only FS (e.g. serverless) — keep running in memory only.
    }
  }
}
