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
  private readonly p = prismaClient();

  tenants = new PrismaCollection<any>(this.p.tenant);
  departments = new PrismaCollection<any>(this.p.department);
  users = new PrismaCollection<any>(this.p.user);
  groups = new PrismaCollection<any>(this.p.assignmentGroup);
  tickets = new PrismaCollection<any>(this.p.ticket);
  messages = new PrismaCollection<any>(this.p.ticketMessage);
  events = new PrismaCollection<any>(this.p.ticketEvent);
  resolutions = new PrismaCollection<any>(this.p.resolution);
  citations = new PrismaCollection<any>(this.p.citation);
  articles = new PrismaCollection<any>(this.p.kBArticle);
  problems = new PrismaCollection<any>(this.p.problem);
  changes = new PrismaCollection<any>(this.p.change);
  approvals = new PrismaCollection<any>(this.p.approval);
  assets = new PrismaCollection<any>(this.p.asset);
  cis = new PrismaCollection<any>(this.p.configurationItem);
  ciRelationships = new PrismaCollection<any>(this.p.cIRelationship);
  catalogItems = new PrismaCollection<any>(this.p.serviceRequestCatalogItem);
  slaPolicies = new PrismaCollection<any>(this.p.slaPolicy);
  automations = new PrismaCollection<any>(this.p.automationRule);
  macros = new PrismaCollection<any>(this.p.macro);
  customFieldDefs = new PrismaCollection<any>(this.p.customFieldDef);
  attachments = new PrismaCollection<any>(this.p.attachment);
  notifications = new PrismaCollection<any>(this.p.notification);
  audit = new PrismaCollection<any>(this.p.auditRecord);
  apiKeys = new PrismaCollection<any>(this.p.apiKey);
  emails = new PrismaCollection<any>(this.p.emailMessage);
  calendars = new PrismaCollection<any>(this.p.businessCalendar);

  async ready(): Promise<void> {
    // Connection is lazy; seeding for Postgres is handled by prisma/seed.ts.
  }
}
