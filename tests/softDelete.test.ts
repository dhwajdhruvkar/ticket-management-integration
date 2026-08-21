import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { getAudit } from "@/server/audit/auditChain";
import { can } from "@/server/auth/rbac";
import { resolveThreadTicket } from "@/server/channels/emailThreading";
import { getStore } from "@/server/data";
import { PrismaCollection } from "@/server/data/prismaStore";
import type { TicketRow } from "@/server/domain/models";
import { linkTickets } from "@/server/services/agentActions";
import { reportRows } from "@/server/services/metricsService";
import {
  addMessage,
  createTicket,
  deleteTicket,
  getTicket,
  getTicketView,
  listActiveTickets,
  listTickets,
  listTicketsForReporting,
  mutateTicket,
} from "@/server/services/ticketService";
import { getTriageBoard } from "@/server/services/triageService";

const TENANT = "tenant_netlink";

beforeAll(async () => {
  await getStore();
});

describe("ticket soft delete", () => {
  it("hides a deleted ticket while preserving its history, links, audit, and reports", async () => {
    const marker = Date.now().toString(36);
    const deleted = await createTicket(TENANT, {
      subject: "Soft delete target " + marker,
      body: "Preserve this ticket history.",
      requesterEmail: "soft-delete-" + marker + "@example.test",
    });
    const related = await createTicket(TENANT, {
      subject: "Soft delete relation " + marker,
      body: "Keep the relationship after deletion.",
      requesterEmail: "soft-delete-related-" + marker + "@example.test",
    });
    await addMessage(deleted.id, {
      authorKind: "agent",
      authorName: "Phase 6 test",
      visibility: "internal",
      body: "This message must survive.",
    });
    await linkTickets(deleted.id, related.id, { name: "Phase 6 test", role: "manager" });

    expect(await deleteTicket(deleted.id, "phase6@example.test")).toBe(true);
    expect(await deleteTicket(deleted.id, "phase6@example.test")).toBe(false);
    expect(await getTicket(deleted.id, TENANT)).toBeNull();
    expect(await getTicketView(deleted.id, { tenantId: TENANT, includeInternal: true })).toBeNull();
    expect(await mutateTicket(deleted.id, { subject: "must not change" })).toBeNull();

    const active = await listActiveTickets(TENANT);
    const defaultPage = await listTickets(TENANT);
    const inclusivePage = await listTickets(TENANT, {}, { includeDeleted: true });
    const historical = await listTicketsForReporting(TENANT);
    expect(active.some((ticket) => ticket.id === deleted.id)).toBe(false);
    expect(defaultPage.data.some((ticket) => ticket.id === deleted.id)).toBe(false);
    expect(inclusivePage.data.find((ticket) => ticket.id === deleted.id)?.deletedAt).toBeTruthy();
    expect(historical.find((ticket) => ticket.id === deleted.id)?.deletedAt).toBeTruthy();

    const store = await getStore();
    const raw = await store.tickets.get(deleted.id);
    const relatedRaw = await store.tickets.get(related.id);
    expect(raw?.deletedAt).toBeTruthy();
    expect(raw?.subject).toBe(deleted.subject);
    expect(await store.messages.list({ ticketId: deleted.id })).not.toHaveLength(0);
    expect((await store.events.list({ ticketId: deleted.id })).some((event) => event.type === "deleted")).toBe(true);
    expect(relatedRaw?.linkedTicketIds).toContain(deleted.id);

    const audit = await getAudit(TENANT, deleted.id);
    expect(audit.data.some((entry) => entry.action === "ticket.deleted")).toBe(true);
    const exported = await reportRows(TENANT);
    expect(exported.find((row) => row.reference === deleted.reference)?.deletedAt).toBeTruthy();
  });

  it("removes deleted tickets from triage and email-thread resolution", async () => {
    const marker = Date.now().toString(36) + "-flow";
    const ticket = await createTicket(TENANT, {
      subject: "Thread target " + marker,
      body: "Operational flows must ignore this after deletion.",
      requesterEmail: "thread-" + marker + "@example.test",
    });
    expect((await getTriageBoard(TENANT)).queue.some((row) => row.id === ticket.id)).toBe(true);
    expect(
      await resolveThreadTicket(TENANT, { subject: "[" + ticket.reference + "] Reply" })
    ).toEqual({ ticketId: ticket.id, via: "subject_reference" });

    await deleteTicket(ticket.id, "phase6@example.test");

    expect((await getTriageBoard(TENANT)).queue.some((row) => row.id === ticket.id)).toBe(false);
    expect(
      await resolveThreadTicket(TENANT, { subject: "[" + ticket.reference + "] Reply" })
    ).toBeNull();
  });

  it("allows only manager-or-higher roles to delete tickets", () => {
    expect(can("agent", "ticket.delete")).toBe(false);
    expect(can("manager", "ticket.delete")).toBe(true);
    expect(can("tenant_admin", "ticket.delete")).toBe(true);
    expect(can("super_admin", "ticket.delete")).toBe(true);
  });
});

describe("soft-delete datastore and migration parity", () => {
  it("passes the active deletedAt=null predicate to Prisma", async () => {
    const delegate = {
      findMany: vi.fn().mockResolvedValue([]),
    };
    const collection = new PrismaCollection<TicketRow>(delegate);
    await collection.list(
      { tenantId: TENANT, deletedAt: null },
      { orderBy: { field: "createdAt", dir: "desc" } }
    );
    expect(delegate.findMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT, deletedAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
  });

  it("has an additive migration and no ticket hard-delete callers", () => {
    const migration = fs.readFileSync(
      path.join(
        process.cwd(),
        "prisma",
        "migrations",
        "20260821143000_ticket_soft_delete",
        "migration.sql"
      ),
      "utf8"
    );
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "deletedAt"');
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS "Ticket_tenantId_deletedAt_idx"');
    expect(migration).not.toMatch(/\b(?:DROP|DELETE FROM)\b/i);

    const serverRoot = path.join(process.cwd(), "src", "server");
    const files: string[] = [];
    const visit = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) visit(full);
        else if (entry.name.endsWith(".ts")) files.push(full);
      }
    };
    visit(serverRoot);
    const hardDeleteCallers = files.filter((file) =>
      /\.tickets\.remove\s*\(/.test(fs.readFileSync(file, "utf8"))
    );
    expect(hardDeleteCallers).toEqual([]);
  });
});
