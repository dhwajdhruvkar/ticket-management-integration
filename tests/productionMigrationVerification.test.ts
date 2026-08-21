import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface VerificationResult {
  sql: string;
  expectedIds: number;
}

const require = createRequire(import.meta.url);
const { buildJsonIdVerification } = require(
  "../scripts/build-json-id-verification.cjs"
) as {
  buildJsonIdVerification: (
    data: Record<string, Array<{ id: string }>>
  ) => VerificationResult;
};

function sourceData() {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), ".data", "store.json"), "utf8")
  ) as Record<string, Array<{ id: string }>>;
}

describe("Phase 11 production migration verification", () => {
  it("builds a read-only assertion for every source JSON id", () => {
    const data = sourceData();
    const expected = Object.values(data)
      .filter(Array.isArray)
      .reduce((total, rows) => total + rows.length, 0);
    const result = buildJsonIdVerification(data);

    expect(result.expectedIds).toBe(expected);
    expect(result.sql).toContain('LEFT JOIN "Ticket"');
    expect(result.sql).toContain('LEFT JOIN "AuditRecord"');
    expect(result.sql).not.toMatch(
      /^\s*(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE)\b/im
    );
  });

  it("fails before querying when source collections or ids are invalid", () => {
    const missingCollection = sourceData();
    delete missingCollection.tickets;
    expect(() => buildJsonIdVerification(missingCollection)).toThrow(
      "Missing JSON collection: tickets"
    );

    const duplicateId = sourceData();
    const tenant = duplicateId.tenants[0];
    if (!tenant) throw new Error("Expected source tenant fixture.");
    duplicateId.tenants = [tenant, tenant];
    expect(() => buildJsonIdVerification(duplicateId)).toThrow(
      "Duplicate id in JSON collection: tenants"
    );
  });

  it("keeps the production schema verifier read-only and comprehensive", () => {
    const sql = readFileSync(
      resolve(process.cwd(), "scripts", "verify-production-schema.sql"),
      "utf8"
    );
    const requiredTables = [
      "Tenant",
      "User",
      "Department",
      "AssignmentGroup",
      "Ticket",
      "TicketMessage",
      "TicketEvent",
      "Resolution",
      "Citation",
      "KBArticle",
      "Problem",
      "Change",
      "Approval",
      "Asset",
      "ConfigurationItem",
      "CIRelationship",
      "ServiceRequestCatalogItem",
      "SlaPolicy",
      "BusinessCalendar",
      "AutomationRule",
      "Macro",
      "CustomFieldDef",
      "Attachment",
      "Notification",
      "ApiKey",
      "EmailMessage",
      "AuditRecord",
    ];

    for (const table of requiredTables) expect(sql).toContain(`'${table}'`);
    expect(sql).toContain("Ticket_tenantId_deletedAt_idx");
    expect(sql).toContain("Ticket_tenantId_fkey");
    expect(sql).toContain("20260821143000_ticket_soft_delete");
    expect(sql).not.toMatch(
      /^\s*(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE)\b/im
    );
  });
});
