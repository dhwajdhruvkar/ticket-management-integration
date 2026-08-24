// =============================================================================
// Prisma/Postgres data store (production driver).
//
// Implements the same DataStore port as the in-memory store by delegating to
// Prisma model delegates. Activated by DATA_DRIVER=prisma + DATABASE_URL. Dates
// are normalized to ISO strings on read so the row shape is identical to the
// in-memory driver; the service layer can't tell the two apart.
// =============================================================================

import { PrismaClient } from "@prisma/client";
import { config } from "../config";
import type { Collection, DataStore, ListOptions } from "./store";
import type { Entity } from "../domain/models";

/* eslint-disable @typescript-eslint/no-explicit-any */

function serialize<T>(row: any): T {
  if (!row) return row;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = v instanceof Date ? v.toISOString() : v;
  }
  return out as T;
}

/**
 * Drop keys whose value is `undefined` before handing a patch to Prisma.
 *
 * Callers routinely build patches with optional fields, so `{ strategy, categories: undefined }`
 * is a normal shape. The memory driver skips those keys; Prisma does too for
 * scalars, but not for every field type, and the two drivers must behave
 * identically — a partial patch once wiped a group's categories in memory,
 * which is exactly the class of divergence this prevents.
 */
function stripUndefined<T extends object>(patch: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<T>;
}

export class PrismaCollection<T extends Entity> implements Collection<T> {
  constructor(private readonly delegate: any) {}

  async list(where?: Partial<T>, options?: ListOptions<T>): Promise<T[]> {
    const args: any = { where: where ?? undefined };
    if (options?.skip !== undefined) args.skip = options.skip;
    if (options?.take !== undefined) args.take = options.take;
    if (options?.orderBy) {
      const primary = { [options.orderBy.field]: options.orderBy.dir };
      args.orderBy =
        options.orderBy.field === "id" ? primary : [primary, { id: "asc" }];
    }
    const rows = await this.delegate.findMany(args);
    return rows.map((r: unknown) => serialize<T>(r));
  }
  async get(id: string): Promise<T | null> {
    const row = await this.delegate.findUnique({ where: { id } });
    return row ? serialize<T>(row) : null;
  }
  async create(value: T): Promise<T> {
    const row = await this.delegate.create({ data: value });
    return serialize<T>(row);
  }
  async update(id: string, patch: Partial<T>): Promise<T | null> {
    try {
      const row = await this.delegate.update({ where: { id }, data: stripUndefined(patch) });
      return serialize<T>(row);
    } catch {
      return null;
    }
  }
  async remove(id: string): Promise<boolean> {
    try {
      await this.delegate.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }
  async count(where?: Partial<T>): Promise<number> {
    return this.delegate.count({ where: where ?? undefined });
  }
}

function prismaClient(): PrismaClient {
  const g = globalThis as unknown as { __netlinkPrisma?: PrismaClient };
  g.__netlinkPrisma ??= new PrismaClient(
    config.databaseUrl ? { datasources: { db: { url: config.databaseUrl } } } : undefined
  );
  return g.__netlinkPrisma;
}

export class PrismaStore implements DataStore {
  readonly driver = "prisma" as const;

  readonly tenants: PrismaCollection<any>;
  readonly departments: PrismaCollection<any>;
  readonly users: PrismaCollection<any>;
  readonly invitations: PrismaCollection<any>;
  readonly groups: PrismaCollection<any>;
  readonly tickets: PrismaCollection<any>;
  readonly messages: PrismaCollection<any>;
  readonly events: PrismaCollection<any>;
  readonly resolutions: PrismaCollection<any>;
  readonly citations: PrismaCollection<any>;
  readonly articles: PrismaCollection<any>;
  readonly problems: PrismaCollection<any>;
  readonly changes: PrismaCollection<any>;
  readonly approvals: PrismaCollection<any>;
  readonly assets: PrismaCollection<any>;
  readonly cis: PrismaCollection<any>;
  readonly ciRelationships: PrismaCollection<any>;
  readonly catalogItems: PrismaCollection<any>;
  readonly slaPolicies: PrismaCollection<any>;
  readonly automations: PrismaCollection<any>;
  readonly macros: PrismaCollection<any>;
  readonly customFieldDefs: PrismaCollection<any>;
  readonly attachments: PrismaCollection<any>;
  readonly notifications: PrismaCollection<any>;
  readonly audit: PrismaCollection<any>;
  readonly apiKeys: PrismaCollection<any>;
  readonly emails: PrismaCollection<any>;
  readonly calendars: PrismaCollection<any>;

  constructor(
    private readonly p: any = prismaClient(),
    private readonly transactionScoped = false
  ) {
    this.tenants = new PrismaCollection<any>(p.tenant);
    this.departments = new PrismaCollection<any>(p.department);
    this.users = new PrismaCollection<any>(p.user);
    this.invitations = new PrismaCollection<any>(p.userInvitation);
    this.groups = new PrismaCollection<any>(p.assignmentGroup);
    this.tickets = new PrismaCollection<any>(p.ticket);
    this.messages = new PrismaCollection<any>(p.ticketMessage);
    this.events = new PrismaCollection<any>(p.ticketEvent);
    this.resolutions = new PrismaCollection<any>(p.resolution);
    this.citations = new PrismaCollection<any>(p.citation);
    this.articles = new PrismaCollection<any>(p.kBArticle);
    this.problems = new PrismaCollection<any>(p.problem);
    this.changes = new PrismaCollection<any>(p.change);
    this.approvals = new PrismaCollection<any>(p.approval);
    this.assets = new PrismaCollection<any>(p.asset);
    this.cis = new PrismaCollection<any>(p.configurationItem);
    this.ciRelationships = new PrismaCollection<any>(p.cIRelationship);
    this.catalogItems = new PrismaCollection<any>(p.serviceRequestCatalogItem);
    this.slaPolicies = new PrismaCollection<any>(p.slaPolicy);
    this.automations = new PrismaCollection<any>(p.automationRule);
    this.macros = new PrismaCollection<any>(p.macro);
    this.customFieldDefs = new PrismaCollection<any>(p.customFieldDef);
    this.attachments = new PrismaCollection<any>(p.attachment);
    this.notifications = new PrismaCollection<any>(p.notification);
    this.audit = new PrismaCollection<any>(p.auditRecord);
    this.apiKeys = new PrismaCollection<any>(p.apiKey);
    this.emails = new PrismaCollection<any>(p.emailMessage);
    this.calendars = new PrismaCollection<any>(p.businessCalendar);
  }

  async ready(): Promise<void> {
    // Connection is lazy; seeding for Postgres is handled by prisma/seed.ts.
  }

  async transaction<T>(work: (store: DataStore) => Promise<T>): Promise<T> {
    if (this.transactionScoped) return work(this);
    return this.p.$transaction((tx: any) =>
      work(new PrismaStore(tx, true))
    );
  }
}
