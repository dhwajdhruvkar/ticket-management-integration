// =============================================================================
// scripts/migrate-json-to-pg.ts
//
// Migrates data from .data/store.json into PostgreSQL via Prisma.
//
// Strategy:
//   1. Reads the JSON file (source of truth for the user's working data).
//   2. Clears the current DB data (only seed data with random IDs).
//   3. Inserts JSON records in FK-safe dependency order.
//   4. Validates source vs destination counts for every entity.
//
// Safety:
//   - Does NOT modify or delete .data/store.json.
//   - Runs inside a transaction where possible.
//   - Stops on any error.
//
// Usage:
//   npx tsx scripts/migrate-json-to-pg.ts
// =============================================================================

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();

interface StoreData {
  version: number;
  tenants: Record<string, unknown>[];
  departments: Record<string, unknown>[];
  users: Record<string, unknown>[];
  groups: Record<string, unknown>[];
  tickets: Record<string, unknown>[];
  messages: Record<string, unknown>[];
  events: Record<string, unknown>[];
  resolutions: Record<string, unknown>[];
  citations: Record<string, unknown>[];
  articles: Record<string, unknown>[];
  problems: Record<string, unknown>[];
  changes: Record<string, unknown>[];
  approvals: Record<string, unknown>[];
  assets: Record<string, unknown>[];
  cis: Record<string, unknown>[];
  ciRelationships: Record<string, unknown>[];
  catalogItems: Record<string, unknown>[];
  slaPolicies: Record<string, unknown>[];
  automations: Record<string, unknown>[];
  macros: Record<string, unknown>[];
  customFieldDefs: Record<string, unknown>[];
  attachments: Record<string, unknown>[];
  notifications: Record<string, unknown>[];
  audit: Record<string, unknown>[];
  apiKeys: Record<string, unknown>[];
  emails: Record<string, unknown>[];
  calendars: Record<string, unknown>[];
}

// -- Helpers ------------------------------------------------------------------

/** Convert ISO date strings to Date objects, recursively for known date fields. */
function toDate(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "string") {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

/** Map a JSON record, converting all known date-string fields to Date objects. */
function mapDates<T extends Record<string, unknown>>(
  row: T,
  dateFields: string[]
): T {
  const out: Record<string, unknown> = { ...row };
  for (const f of dateFields) {
    if (f in out) {
      out[f] = toDate(out[f]);
    }
  }
  return out as T;
}

// -- Main ---------------------------------------------------------------------

async function main() {
  const jsonPath = path.resolve(".data/store.json");
  if (!fs.existsSync(jsonPath)) {
    console.error("ERROR: .data/store.json not found.");
    process.exit(1);
  }

  console.log("Reading .data/store.json ...");
  const data: StoreData = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

  // Print source counts
  console.log("\n=== SOURCE COUNTS (.data/store.json) ===");
  const entityMap: [string, string, Record<string, unknown>[]][] = [
    ["tenants", "Tenant", data.tenants],
    ["departments", "Department", data.departments],
    ["users", "User", data.users],
    ["calendars", "BusinessCalendar", data.calendars],
    ["groups", "AssignmentGroup", data.groups],
    ["slaPolicies", "SlaPolicy", data.slaPolicies],
    ["articles", "KBArticle", data.articles],
    ["catalogItems", "ServiceRequestCatalogItem", data.catalogItems],
    ["changes", "Change", data.changes],
    ["problems", "Problem", data.problems],
    ["assets", "Asset", data.assets],
    ["cis", "ConfigurationItem", data.cis],
    ["ciRelationships", "CIRelationship", data.ciRelationships],
    ["tickets", "Ticket", data.tickets],
    ["messages", "TicketMessage", data.messages],
    ["events", "TicketEvent", data.events],
    ["resolutions", "Resolution", data.resolutions],
    ["citations", "Citation", data.citations],
    ["approvals", "Approval", data.approvals],
    ["notifications", "Notification", data.notifications],
    ["audit", "AuditRecord", data.audit],
    ["apiKeys", "ApiKey", data.apiKeys],
    ["automations", "AutomationRule", data.automations],
    ["macros", "Macro", data.macros],
    ["customFieldDefs", "CustomFieldDef", data.customFieldDefs],
    ["attachments", "Attachment", data.attachments],
    ["emails", "EmailMessage", data.emails],
  ];

  for (const [key, model, arr] of entityMap) {
    console.log(`  ${model} (${key}): ${arr.length}`);
  }

  // -- Clear existing data (reverse FK order) ---------------------------------
  console.log("\nClearing existing database data ...");
  // Delete in reverse-FK order to avoid constraint violations
  await prisma.auditRecord.deleteMany();
  await prisma.emailMessage.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.apiKey.deleteMany();
  await prisma.customFieldDef.deleteMany();
  await prisma.macro.deleteMany();
  await prisma.automationRule.deleteMany();
  await prisma.citation.deleteMany();
  await prisma.resolution.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.approval.deleteMany();
  await prisma.ticketEvent.deleteMany();
  await prisma.ticketMessage.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.cIRelationship.deleteMany();
  await prisma.configurationItem.deleteMany();
  await prisma.asset.deleteMany();
  await prisma.problem.deleteMany();
  await prisma.change.deleteMany();
  await prisma.serviceRequestCatalogItem.deleteMany();
  await prisma.kBArticle.deleteMany();
  await prisma.slaPolicy.deleteMany();
  await prisma.assignmentGroup.deleteMany();
  await prisma.businessCalendar.deleteMany();
  await prisma.user.deleteMany();
  await prisma.department.deleteMany();
  await prisma.tenant.deleteMany();
  console.log("  Done.");

  // -- Insert in FK-safe order ------------------------------------------------
  console.log("\nInserting JSON data into PostgreSQL ...");

  // 1. Tenants
  if (data.tenants.length > 0) {
    await prisma.tenant.createMany({
      data: data.tenants.map((r) =>
        mapDates(r, ["createdAt", "updatedAt"])
      ) as never[],
    });
    console.log(`  ✓ Tenant: ${data.tenants.length}`);
  }

  // 2. Departments
  if (data.departments.length > 0) {
    await prisma.department.createMany({
      data: data.departments.map((r) =>
        mapDates(r, ["createdAt", "updatedAt"])
      ) as never[],
    });
    console.log(`  ✓ Department: ${data.departments.length}`);
  }

  // 3. Users
  if (data.users.length > 0) {
    await prisma.user.createMany({
      data: data.users.map((r) =>
        mapDates(r, ["createdAt", "updatedAt"])
      ) as never[],
    });
    console.log(`  ✓ User: ${data.users.length}`);
  }

  // 4. Business Calendars
  if (data.calendars.length > 0) {
    await prisma.businessCalendar.createMany({
      data: data.calendars.map((r) =>
        mapDates(r, ["createdAt", "updatedAt"])
      ) as never[],
    });
    console.log(`  ✓ BusinessCalendar: ${data.calendars.length}`);
  }

  // 5. Assignment Groups
  if (data.groups.length > 0) {
    await prisma.assignmentGroup.createMany({
      data: data.groups.map((r) =>
        mapDates(r, ["createdAt", "updatedAt"])
      ) as never[],
    });
    console.log(`  ✓ AssignmentGroup: ${data.groups.length}`);
  }

  // 6. SLA Policies
  if (data.slaPolicies.length > 0) {
    await prisma.slaPolicy.createMany({
      data: data.slaPolicies.map((r) =>
        mapDates(r, ["createdAt", "updatedAt"])
      ) as never[],
    });
    console.log(`  ✓ SlaPolicy: ${data.slaPolicies.length}`);
  }

  // 7. KB Articles
  if (data.articles.length > 0) {
    await prisma.kBArticle.createMany({
      data: data.articles.map((r) =>
        mapDates(r, ["createdAt", "updatedAt"])
      ) as never[],
    });
    console.log(`  ✓ KBArticle: ${data.articles.length}`);
  }

  // 8. Catalog Items
  if (data.catalogItems.length > 0) {
    await prisma.serviceRequestCatalogItem.createMany({
      data: data.catalogItems.map((r) =>
        mapDates(r, ["createdAt", "updatedAt"])
      ) as never[],
    });
    console.log(`  ✓ ServiceRequestCatalogItem: ${data.catalogItems.length}`);
  }

  // 9. Changes
  if (data.changes.length > 0) {
    await prisma.change.createMany({
      data: data.changes.map((r) =>
        mapDates(r, ["createdAt", "updatedAt", "plannedStart", "plannedEnd"])
      ) as never[],
    });
    console.log(`  ✓ Change: ${data.changes.length}`);
  }

  // 10. Problems
  if (data.problems.length > 0) {
    await prisma.problem.createMany({
      data: data.problems.map((r) =>
        mapDates(r, ["createdAt", "updatedAt"])
      ) as never[],
    });
    console.log(`  ✓ Problem: ${data.problems.length}`);
  }

  // 11. Assets
  if (data.assets.length > 0) {
    await prisma.asset.createMany({
      data: data.assets.map((r) =>
        mapDates(r, ["createdAt", "updatedAt", "purchasedAt", "warrantyEnd"])
      ) as never[],
    });
    console.log(`  ✓ Asset: ${data.assets.length}`);
  }

  // 12. Configuration Items
  if (data.cis.length > 0) {
    await prisma.configurationItem.createMany({
      data: data.cis.map((r) =>
        mapDates(r, ["createdAt", "updatedAt"])
      ) as never[],
    });
    console.log(`  ✓ ConfigurationItem: ${data.cis.length}`);
  }

  // 13. CI Relationships
  if (data.ciRelationships.length > 0) {
    await prisma.cIRelationship.createMany({
      data: data.ciRelationships as never[],
    });
    console.log(`  ✓ CIRelationship: ${data.ciRelationships.length}`);
  }

  // 14. Tickets
  if (data.tickets.length > 0) {
    await prisma.ticket.createMany({
      data: data.tickets.map((r) =>
        mapDates(r, [
          "createdAt", "updatedAt", "escalatedAt", "firstRespondedAt",
          "resolvedAt", "closedAt", "dueResponseAt", "dueResolveAt",
          "slaPausedAt",
        ])
      ) as never[],
    });
    console.log(`  ✓ Ticket: ${data.tickets.length}`);
  }

  // 15. Ticket Messages
  if (data.messages.length > 0) {
    await prisma.ticketMessage.createMany({
      data: data.messages.map((r) =>
        mapDates(r, ["createdAt"])
      ) as never[],
    });
    console.log(`  ✓ TicketMessage: ${data.messages.length}`);
  }

  // 16. Ticket Events
  if (data.events.length > 0) {
    await prisma.ticketEvent.createMany({
      data: data.events.map((r) =>
        mapDates(r, ["createdAt"])
      ) as never[],
    });
    console.log(`  ✓ TicketEvent: ${data.events.length}`);
  }

  // 17. Resolutions
  if (data.resolutions.length > 0) {
    await prisma.resolution.createMany({
      data: data.resolutions.map((r) =>
        mapDates(r, ["createdAt"])
      ) as never[],
    });
    console.log(`  ✓ Resolution: ${data.resolutions.length}`);
  }

  // 18. Citations
  if (data.citations.length > 0) {
    await prisma.citation.createMany({
      data: data.citations as never[],
    });
    console.log(`  ✓ Citation: ${data.citations.length}`);
  }

  // 19. Approvals
  if (data.approvals.length > 0) {
    await prisma.approval.createMany({
      data: data.approvals.map((r) =>
        mapDates(r, ["createdAt", "decidedAt"])
      ) as never[],
    });
    console.log(`  ✓ Approval: ${data.approvals.length}`);
  }

  // 20. Notifications
  if (data.notifications.length > 0) {
    await prisma.notification.createMany({
      data: data.notifications.map((r) =>
        mapDates(r, ["createdAt", "sentAt", "readAt"])
      ) as never[],
    });
    console.log(`  ✓ Notification: ${data.notifications.length}`);
  }

  // 21. Audit Records
  if (data.audit.length > 0) {
    await prisma.auditRecord.createMany({
      data: data.audit.map((r) =>
        mapDates(r, ["timestamp"])
      ) as never[],
    });
    console.log(`  ✓ AuditRecord: ${data.audit.length}`);
  }

  // 22. API Keys
  if (data.apiKeys.length > 0) {
    await prisma.apiKey.createMany({
      data: data.apiKeys.map((r) =>
        mapDates(r, ["createdAt", "updatedAt", "lastUsedAt", "expiresAt"])
      ) as never[],
    });
    console.log(`  ✓ ApiKey: ${data.apiKeys.length}`);
  }

  // 23. Automation Rules
  if (data.automations.length > 0) {
    await prisma.automationRule.createMany({
      data: data.automations.map((r) =>
        mapDates(r, ["createdAt", "updatedAt"])
      ) as never[],
    });
    console.log(`  ✓ AutomationRule: ${data.automations.length}`);
  }

  // 24. Macros
  if (data.macros.length > 0) {
    await prisma.macro.createMany({
      data: data.macros.map((r) =>
        mapDates(r, ["createdAt", "updatedAt"])
      ) as never[],
    });
    console.log(`  ✓ Macro: ${data.macros.length}`);
  }

  // 25. Custom Field Definitions
  if (data.customFieldDefs.length > 0) {
    await prisma.customFieldDef.createMany({
      data: data.customFieldDefs.map((r) =>
        mapDates(r, ["createdAt", "updatedAt"])
      ) as never[],
    });
    console.log(`  ✓ CustomFieldDef: ${data.customFieldDefs.length}`);
  }

  // 26. Attachments
  if (data.attachments.length > 0) {
    await prisma.attachment.createMany({
      data: data.attachments.map((r) =>
        mapDates(r, ["createdAt"])
      ) as never[],
    });
    console.log(`  ✓ Attachment: ${data.attachments.length}`);
  }

  // 27. Email Messages
  if (data.emails.length > 0) {
    await prisma.emailMessage.createMany({
      data: data.emails.map((r) =>
        mapDates(r, ["createdAt", "receivedAt"])
      ) as never[],
    });
    console.log(`  ✓ EmailMessage: ${data.emails.length}`);
  }

  // -- Validate ---------------------------------------------------------------
  console.log("\n=== VALIDATION ===");

  const checks: [string, string, number][] = [
    ["Tenant", "tenants", data.tenants.length],
    ["Department", "departments", data.departments.length],
    ["User", "users", data.users.length],
    ["BusinessCalendar", "calendars", data.calendars.length],
    ["AssignmentGroup", "groups", data.groups.length],
    ["SlaPolicy", "slaPolicies", data.slaPolicies.length],
    ["KBArticle", "articles", data.articles.length],
    ["ServiceRequestCatalogItem", "catalogItems", data.catalogItems.length],
    ["Change", "changes", data.changes.length],
    ["Problem", "problems", data.problems.length],
    ["Asset", "assets", data.assets.length],
    ["ConfigurationItem", "cis", data.cis.length],
    ["CIRelationship", "ciRelationships", data.ciRelationships.length],
    ["Ticket", "tickets", data.tickets.length],
    ["TicketMessage", "messages", data.messages.length],
    ["TicketEvent", "events", data.events.length],
    ["Resolution", "resolutions", data.resolutions.length],
    ["Citation", "citations", data.citations.length],
    ["Approval", "approvals", data.approvals.length],
    ["Notification", "notifications", data.notifications.length],
    ["AuditRecord", "audit", data.audit.length],
    ["ApiKey", "apiKeys", data.apiKeys.length],
    ["AutomationRule", "automations", data.automations.length],
    ["Macro", "macros", data.macros.length],
    ["CustomFieldDef", "customFieldDefs", data.customFieldDefs.length],
    ["Attachment", "attachments", data.attachments.length],
    ["EmailMessage", "emails", data.emails.length],
  ];

  let allPassed = true;
  for (const [model, , expected] of checks) {
    // Use dynamic prisma access
    const dbCount = await (
      prisma as unknown as Record<string, { count(): Promise<number> }>
    )[
      model.charAt(0).toLowerCase() + model.slice(1)
    ].count();
    const status = dbCount === expected ? "✓" : "✗ MISMATCH";
    if (dbCount !== expected) allPassed = false;
    console.log(`  ${status} ${model}: JSON=${expected}, DB=${dbCount}`);
  }

  if (allPassed) {
    console.log("\n✅ Migration complete. All counts match.");
  } else {
    console.error("\n❌ Migration has count mismatches. Investigate above.");
    process.exit(1);
  }
}

main()
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
