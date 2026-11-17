import { afterAll, describe, expect, it, vi } from "vitest";

const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }));
vi.mock("@/auth", () => ({ auth: mockAuth }));

import { GET as getOpenApi } from "@/app/api/v1/openapi.json/route";
import { POST as createTicketRoute } from "@/app/api/v1/tickets/route";
import { getStore } from "@/server/data";
import {
  CREATABLE_TICKET_TYPES,
  readTypeDetails,
  sanitizeTypeDetails,
  typeDetailRows,
  typeDetailsProblem,
} from "@/shared/ticketTypes";

const session = { user: { id: "user_dana", name: "Dana Lee", email: "dana.lee@netlink.com", role: "requester", tenantId: "tenant_netlink" } };
const created: string[] = [];
const extraCatalog: string[] = [];

async function post(extra: Record<string, unknown>) {
  mockAuth.mockResolvedValue(session);
  return createTicketRoute(
    new Request("http://ticket-types.test/api/v1/tickets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject: "Type check", body: "Body text for the type check.", requesterEmail: "dana.lee@netlink.com", ...extra }),
    })
  );
}
async function create(extra: Record<string, unknown>) {
  const res = await post(extra);
  const json = (await res.json()) as { ok: boolean; data: { id?: string; ticket?: { id: string } } };
  expect(res.status, JSON.stringify(json)).toBeLessThan(300);
  const id = json.data.ticket?.id ?? json.data.id!;
  created.push(id);
  return (await (await getStore()).tickets.get(id))!;
}
const detailsOf = (t: { customFields?: unknown }) => (t.customFields as { typeDetails?: unknown } | null)?.typeDetails ?? null;

const CHANGE = {
  risk: "medium", impact: "low", implementationPlan: "Patch the switch stack.", rollbackPlan: "Restore the saved config.",
  maintenanceStart: "2026-12-01T22:00:00Z", maintenanceEnd: "2026-12-02T00:00:00Z",
};

afterAll(async () => {
  const store = await getStore();
  for (const id of created) await store.tickets.remove(id);
  for (const id of extraCatalog) await store.catalogItems.remove(id);
});

describe("creatable ticket types", () => {
  it("are exactly incident, service_request and change", () => {
    expect([...CREATABLE_TICKET_TYPES]).toEqual(["incident", "service_request", "change"]);
  });

  it("the API rejects problem and unknown types", async () => {
    for (const type of ["problem", "epic", 7, ""]) {
      const res = await post({ type });
      expect(res.status, String(type)).toBe(400);
    }
  });

  it("defaults to incident and keeps the type prefix", async () => {
    expect((await create({})).reference).toMatch(/^INC-/);
    expect((await create({ type: "service_request" })).reference).toMatch(/^REQ-/);
    const change = await create({ type: "change", typeDetails: CHANGE });
    expect(change.reference).toMatch(/^CHG-/);
    expect(change.type).toBe("change");
  });
});

describe("type-specific details", () => {
  it("stores incident details and drops anything not valid for the type", async () => {
    const ticket = await create({ type: "incident", typeDetails: { affectedService: " VPN ", risk: "high", approvalRequired: true } });
    expect(detailsOf(ticket)).toEqual({ affectedService: "VPN" });
  });

  it("stores service request details; approvalRequired comes from the catalog item, never the caller", async () => {
    const store = await getStore();
    const item = (await store.catalogItems.list({ tenantId: "tenant_netlink" })).find((c) => c.requiresApproval);
    expect(item, "seed has an approval-gated catalog item").toBeTruthy();
    const gated = await create({ type: "service_request", catalogItemId: item!.id, typeDetails: { requestedItem: "Laptop", fulfilmentDetails: "Pune, by Friday", approvalRequired: false } });
    expect(detailsOf(gated)).toEqual({ requestedItem: "Laptop", fulfilmentDetails: "Pune, by Friday", approvalRequired: true });
    expect(gated.catalogItemId).toBe(item!.id);

    const free = await create({ type: "service_request", typeDetails: { requestedItem: "Mouse", approvalRequired: true } });
    expect(detailsOf(free)).toEqual({ requestedItem: "Mouse" }); // no catalog item: the claim is ignored
  });

  it("ignores a catalog item from another tenant", async () => {
    const store = await getStore();
    const foreign = await store.catalogItems.create({
      id: "cat_foreign_test", tenantId: "tenant_other", name: "Foreign", description: "x", category: "IT", requiresApproval: true, active: true,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    extraCatalog.push(foreign.id);
    const ticket = await create({ type: "service_request", catalogItemId: foreign.id, typeDetails: { requestedItem: "X" } });
    expect(ticket.catalogItemId).toBeNull();
    expect(detailsOf(ticket)).toEqual({ requestedItem: "X" });
  });

  it("stores a complete change request and displays it with its approval status", async () => {
    const ticket = await create({ type: "change", typeDetails: { ...CHANGE, approvalStatus: "approved" } });
    expect(detailsOf(ticket)).toEqual(CHANGE);
    const rows = typeDetailRows("change", ticket.customFields, []);
    expect(rows.map((r) => r.label)).toEqual(["Risk", "Change impact", "Implementation plan", "Maintenance window", "Rollback plan", "Approval status"]);
    expect(rows.at(-1)?.value).toBe("Not requested");
    expect(typeDetailRows("change", ticket.customFields, [{ state: "pending" }]).at(-1)?.value).toBe("Pending");
    expect(typeDetailRows("change", ticket.customFields, [{ state: "pending" }, { state: "rejected" }]).at(-1)?.value).toBe("Rejected");
    expect(typeDetailRows("change", ticket.customFields, [{ state: "approved" }]).at(-1)?.value).toBe("Approved");
  });

  it("rejects a change request that is incomplete or has a backwards window", async () => {
    for (const bad of [
      undefined,
      { ...CHANGE, risk: undefined },
      { ...CHANGE, risk: "extreme" },
      { ...CHANGE, impact: undefined },
      { ...CHANGE, implementationPlan: "  " },
      { ...CHANGE, rollbackPlan: undefined },
      { ...CHANGE, maintenanceEnd: CHANGE.maintenanceStart },
      { ...CHANGE, maintenanceStart: CHANGE.maintenanceEnd, maintenanceEnd: CHANGE.maintenanceStart },
      { ...CHANGE, maintenanceStart: "soon" },
    ]) {
      expect((await post({ type: "change", typeDetails: bad })).status, JSON.stringify(bad)).toBe(400);
    }
  });

  it("never lets typeDetails smuggle other customFields", async () => {
    const ticket = await create({ type: "incident", customFields: { isAdmin: true }, typeDetails: { affectedService: "Mail", __proto__: { polluted: 1 }, customFields: { isAdmin: true } } });
    expect(Object.keys(ticket.customFields as object).filter((k) => !["typeDetails", "requesterLocation"].includes(k))).toEqual([]);
    expect(detailsOf(ticket)).toEqual({ affectedService: "Mail" });
  });
});

describe("sanitizeTypeDetails / readTypeDetails", () => {
  it("drops over-long values and non-object input", () => {
    expect(sanitizeTypeDetails("incident", { affectedService: "x".repeat(201) })).toBeNull();
    for (const raw of [null, undefined, "x", ["a"], 4]) expect(sanitizeTypeDetails("change", raw)).toBeNull();
    expect(sanitizeTypeDetails("problem", { affectedService: "VPN" })).toBeNull();
  });

  it("legacy problem tickets and tickets without details read as empty, not as errors", () => {
    expect(readTypeDetails("problem", { typeDetails: { risk: "high" } })).toBeNull();
    expect(readTypeDetails("incident", null)).toBeNull();
    expect(readTypeDetails("incident", { requesterLocation: "Pune" })).toBeNull();
    expect(typeDetailRows("problem", { typeDetails: { risk: "high" } })).toEqual([]);
    expect(typeDetailsProblem("incident", undefined)).toBeNull();
    expect(typeDetailsProblem("service_request", undefined)).toBeNull();
  });
});

describe("OpenAPI agrees with the ticket-type model", () => {
  it("documents exactly the creatable types for creation and all stored types for reads", async () => {
    const res = await getOpenApi(new Request("http://ticket-types.test/api/v1/openapi.json", { headers: { "x-actor": "dana.lee@netlink.com" } }));
    const spec = (await res.json()) as { components: { schemas: Record<string, { properties: Record<string, { enum?: string[]; properties?: Record<string, unknown> }> }> } };
    const create = spec.components.schemas.CreateTicketRequest ?? spec.components.schemas.NewTicketRequest;
    expect(create, "new-ticket request schema").toBeTruthy();
    expect(create.properties.type.enum).toEqual([...CREATABLE_TICKET_TYPES]);
    expect(Object.keys(create.properties.typeDetails.properties!).sort()).toEqual(
      ["affectedService", "fulfilmentDetails", "implementationPlan", "impact", "maintenanceEnd", "maintenanceStart", "requestedItem", "risk", "rollbackPlan"].sort()
    );
    expect(spec.components.schemas.Ticket.properties.type.enum).toEqual(["incident", "service_request", "problem", "change"]);
  });
});
