// =============================================================================
// Prisma seed — loads the same dataset the in-memory store uses into Postgres.
//
//   npm run db:push     # create the schema first
//   npm run db:seed
//
// Idempotent: if a tenant already exists, it does nothing.
// =============================================================================

import { PrismaClient } from "@prisma/client";
import { buildSeed } from "../src/server/data/seed";

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.tenant.count();
  if (existing > 0) {
    console.log("Seed skipped: tenant data already present.");
    return;
  }

  const seed = await buildSeed();

  // Insert in FK-safe order.
  await prisma.tenant.createMany({ data: seed.tenants as never[] });
  await prisma.department.createMany({ data: seed.departments as never[] });
  await prisma.user.createMany({ data: seed.users as never[] });
  await prisma.businessCalendar.createMany({ data: seed.calendars as never[] });
  await prisma.assignmentGroup.createMany({ data: seed.groups as never[] });
  await prisma.slaPolicy.createMany({ data: seed.slaPolicies as never[] });
  await prisma.kBArticle.createMany({ data: seed.articles as never[] });
  await prisma.serviceRequestCatalogItem.createMany({ data: seed.catalogItems as never[] });
  await prisma.change.createMany({ data: seed.changes as never[] });
  await prisma.problem.createMany({ data: seed.problems as never[] });
  await prisma.asset.createMany({ data: seed.assets as never[] });
  await prisma.configurationItem.createMany({ data: seed.cis as never[] });
  await prisma.cIRelationship.createMany({ data: seed.ciRelationships as never[] });
  await prisma.ticket.createMany({ data: seed.tickets as never[] });
  await prisma.ticketMessage.createMany({ data: seed.messages as never[] });
  await prisma.ticketEvent.createMany({ data: seed.events as never[] });
  await prisma.approval.createMany({ data: seed.approvals as never[] });
  await prisma.notification.createMany({ data: seed.notifications as never[] });
  await prisma.apiKey.createMany({ data: seed.apiKeys as never[] });
  await prisma.automationRule.createMany({ data: seed.automations as never[] });
  await prisma.macro.createMany({ data: seed.macros as never[] });
  await prisma.customFieldDef.createMany({ data: seed.customFieldDefs as never[] });

  console.log(
    `Seeded: ${seed.tenants.length} tenant, ${seed.users.length} users, ${seed.articles.length} articles, ${seed.tickets.length} tickets, ${seed.changes.length} changes.`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
