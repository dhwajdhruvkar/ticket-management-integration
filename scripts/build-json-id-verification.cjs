"use strict";

const fs = require("node:fs");
const path = require("node:path");

const COLLECTION_TO_TABLE = {
  tenants: "Tenant",
  departments: "Department",
  users: "User",
  calendars: "BusinessCalendar",
  groups: "AssignmentGroup",
  slaPolicies: "SlaPolicy",
  articles: "KBArticle",
  catalogItems: "ServiceRequestCatalogItem",
  changes: "Change",
  problems: "Problem",
  assets: "Asset",
  cis: "ConfigurationItem",
  ciRelationships: "CIRelationship",
  tickets: "Ticket",
  messages: "TicketMessage",
  events: "TicketEvent",
  resolutions: "Resolution",
  citations: "Citation",
  approvals: "Approval",
  notifications: "Notification",
  audit: "AuditRecord",
  apiKeys: "ApiKey",
  automations: "AutomationRule",
  macros: "Macro",
  customFieldDefs: "CustomFieldDef",
  attachments: "Attachment",
  emails: "EmailMessage",
};

function quoteLiteral(input) {
  return `'${String(input).replaceAll("'", "''")}'`;
}

function buildJsonIdVerification(data) {
  const statements = [
    "-- Generated read-only source-ID verification.",
    "DO $source_ids$",
    "DECLARE missing_count integer;",
    "BEGIN",
  ];
  let expectedIds = 0;

  for (const [collection, table] of Object.entries(COLLECTION_TO_TABLE)) {
    const rows = data[collection];
    if (!Array.isArray(rows)) {
      throw new Error(`Missing JSON collection: ${collection}`);
    }
    const ids = rows.map((row) => row?.id);
    if (ids.some((id) => typeof id !== "string" || id.length === 0)) {
      throw new Error(`Invalid id in JSON collection: ${collection}`);
    }
    if (new Set(ids).size !== ids.length) {
      throw new Error(`Duplicate id in JSON collection: ${collection}`);
    }
    expectedIds += ids.length;
    if (ids.length === 0) continue;

    const values = ids.map((id) => `(${quoteLiteral(id)})`).join(", ");
    statements.push(
      `  SELECT COUNT(*)::integer INTO missing_count`,
      `  FROM (VALUES ${values}) AS source(id)`,
      `  LEFT JOIN "${table}" AS target ON target.id = source.id`,
      `  WHERE target.id IS NULL;`,
      `  IF missing_count <> 0 THEN`,
      `    RAISE EXCEPTION '${table} is missing % source IDs', missing_count;`,
      `  END IF;`
    );
  }

  statements.push("END", "$source_ids$;");
  return { sql: statements.join("\n") + "\n", expectedIds };
}

function main() {
  const sourcePath = path.resolve(process.cwd(), ".data", "store.json");
  const data = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  const result = buildJsonIdVerification(data);
  process.stderr.write(
    `[source-ids] Verifying ${result.expectedIds} IDs without modifying data.\n`
  );
  process.stdout.write(result.sql);
}

if (require.main === module) main();

module.exports = { buildJsonIdVerification };
