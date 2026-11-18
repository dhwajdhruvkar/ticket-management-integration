import { afterAll, describe, expect, it, vi } from "vitest";

const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }));
vi.mock("@/auth", () => ({ auth: mockAuth }));

import { POST as intake } from "@/app/api/v1/intake/route";
import { GET as getOpenApi } from "@/app/api/v1/openapi.json/route";
import { getStore } from "@/server/data";
import { assertCreatableTicket, createTicket, getTicketView, TicketInputError } from "@/server/services/ticketService";
import { TICKET_TYPE_LABELS, typeDetailRows } from "@/shared/ticketTypes";
import type { TicketRow } from "@/server/domain/models";

// Rate limits key on the client IP (trusted on Vercel); give each call its own.
vi.stubEnv("VERCEL", "1");
let ip = 0;

const TENANT = "tenant_netlink";
const requester = { user: { id: "user_intake", name: "Intake Tester", email: "Intake.Tester@netlink.com", role: "requester", tenantId: TENANT } };
const created: string[] = [];

const CHANGE = {
  risk: "high", impact: "medium", implementationPlan: "Replace the core switch in the window.", rollbackPlan: "Re-seat the old switch.",
  maintenanceStart: "2026-12-05T22:00:00Z", maintenanceEnd: "2026-12-06T02:00:00Z",
};

async function post(body: Record<string, unknown>) {
  mockAuth.mockResolvedValue(requester);
  const res = await intake(new Request("http://intake-types.test/api/v1/intake", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${(ip++ % 250) + 1}` },
    body: JSON.stringify({ channel: "portal", subject: "Help Center request", body: "Created through the Help Center.", ...body }),
  }));
  const json = (await res.json()) as { ok: boolean; data?: TicketRow; error?: string };
  if (json.data?.id) created.push(json.data.id);
  return { status: res.status, ticket: json.data, error: json.error };
}
const detailsOf = (t?: TicketRow) => (t?.customFields as { typeDetails?: unknown } | null)?.typeDetails ?? null;

afterAll(async () => {
  const store = await getStore();
  for (const id of created) await store.tickets.remove(id);
});

describe("Help Center / intake creates all three ticket types", () => {
  it("incident with an affected service", async () => {
    const r = await post({ type: "incident", typeDetails: { affectedService: "VPN", risk: "high" } });
    expect(r.status).toBe(201);
    expect(r.ticket?.type).toBe("incident");
    expect(detailsOf(r.ticket)).toEqual({ affectedService: "VPN" });
  });

  it("service request with requested item and fulfilment details", async () => {
    const r = await post({ type: "service_request", typeDetails: { requestedItem: "Monitor", fulfilmentDetails: "Pune, Friday" } });
    expect(r.status).toBe(201);
    expect(r.ticket?.type).toBe("service_request");
    expect(r.ticket?.reference).toMatch(/^REQ-/);
    expect(detailsOf(r.ticket)).toEqual({ requestedItem: "Monitor", fulfilmentDetails: "Pune, Friday" });
  });

  it("change request, with the requester forced to the signed-in user and the address normalized", async () => {
    const r = await post({ type: "change", typeDetails: CHANGE, requesterEmail: "someone.else@netlink.com" });
    expect(r.status).toBe(201);
    expect(r.ticket?.type).toBe("change");
    expect(r.ticket?.reference).toMatch(/^CHG-/);
    expect(r.ticket?.requesterEmail).toBe("intake.tester@netlink.com");
    expect(detailsOf(r.ticket)).toEqual(CHANGE);
    expect(typeDetailRows("change", r.ticket?.customFields, []).map((row) => row.label)).toContain("Rollback plan");
  });

  it("rejects an incomplete change request, and a backwards maintenance window", async () => {
    for (const typeDetails of [undefined, {}, { ...CHANGE, risk: undefined }, { ...CHANGE, rollbackPlan: "" }, { ...CHANGE, maintenanceEnd: CHANGE.maintenanceStart }, { ...CHANGE, maintenanceStart: "soon" }]) {
      const r = await post({ type: "change", typeDetails });
      expect(r.status, JSON.stringify(typeDetails)).toBe(400);
      expect(r.error).toMatch(/change request needs/i);
    }
  });

  it("rejects the legacy problem type and unknown types", async () => {
    for (const type of ["problem", "epic", "", 7, null]) {
      const r = await post({ type });
      expect(r.status, String(type)).toBe(400);
    }
  });
});

describe("Help Center / intake: backwards compatibility and catalog behaviour", () => {
  it("a call without a type still creates an incident (the old default)", async () => {
    const r = await post({});
    expect(r.status).toBe(201);
    expect(r.ticket?.type).toBe("incident");
    expect(detailsOf(r.ticket)).toBeNull();
  });

  it("a catalog request is a service request, keeps its approval, and approvalRequired comes from the item", async () => {
    const store = await getStore();
    const items = await store.catalogItems.list({ tenantId: TENANT });
    const gated = items.find((c) => c.requiresApproval)!;
    const open = items.find((c) => !c.requiresApproval)!;
    expect(gated && open).toBeTruthy();

    const needsApproval = await post({ catalogItemId: gated.id, typeDetails: { requestedItem: gated.name, approvalRequired: false } });
    expect(needsApproval.status).toBe(201);
    expect(needsApproval.ticket?.type).toBe("service_request");
    expect(needsApproval.ticket?.catalogItemId).toBe(gated.id);
    expect((await store.approvals.list({ ticketId: needsApproval.ticket!.id })).length).toBeGreaterThan(0); // approval flow still starts
    expect(needsApproval.ticket?.status).toBe("pending");
    expect(detailsOf(needsApproval.ticket)).toMatchObject({ requestedItem: gated.name, approvalRequired: true }); // the client's `false` was ignored

    const noApproval = await post({ catalogItemId: open.id, type: "service_request", typeDetails: { approvalRequired: true } });
    expect(noApproval.status).toBe(201);
    expect(detailsOf(noApproval.ticket)).toMatchObject({ approvalRequired: false }); // the client's `true` was ignored
    expect((await store.approvals.list({ ticketId: noApproval.ticket!.id }))).toHaveLength(0);
  });

  it("a catalog item with another ticket type is refused, and a foreign-tenant item is ignored", async () => {
    const store = await getStore();
    const item = (await store.catalogItems.list({ tenantId: TENANT }))[0];
    expect((await post({ catalogItemId: item.id, type: "incident" })).status).toBe(400);
    expect((await post({ catalogItemId: item.id, type: "change", typeDetails: CHANGE })).status).toBe(400);
    const foreign = await store.catalogItems.create({
      id: "cat_intake_foreign", tenantId: "tenant_other_intake", name: "Foreign", description: "x", category: "IT", requiresApproval: true, active: true,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    try {
      const r = await post({ catalogItemId: foreign.id });
      expect(r.status).toBe(201);
      expect(r.ticket?.catalogItemId).toBeNull();
      expect((r.ticket?.customFields as { typeDetails?: { approvalRequired?: boolean } } | null)?.typeDetails?.approvalRequired).toBeUndefined();
      expect(r.ticket?.status).not.toBe("pending");
    } finally {
      await store.catalogItems.remove(foreign.id);
    }
  });
});

describe("service-level enforcement (not only the routes)", () => {
  it("createTicket refuses legacy and unknown types and incomplete changes", async () => {
    const base = { subject: "direct", body: "direct call", requesterEmail: "direct@netlink.com" };
    await expect(createTicket(TENANT, { ...base, type: "problem" })).rejects.toBeInstanceOf(TicketInputError);
    await expect(createTicket(TENANT, { ...base, type: "epic" as never })).rejects.toThrow(/type must be one of/);
    await expect(createTicket(TENANT, { ...base, type: "change" })).rejects.toThrow(/change request needs/i);
    expect(() => assertCreatableTicket({ type: "service_request" })).not.toThrow();
    expect(() => assertCreatableTicket({})).not.toThrow();
    const ok = await createTicket(TENANT, { ...base, type: "change", typeDetails: CHANGE as never });
    created.push(ok.id);
    expect(ok.type).toBe("change");
  });
});

describe("historical problem tickets", () => {
  it("still read, display and list their legacy type without being rewritten", async () => {
    const store = await getStore();
    const stamp = new Date().toISOString();
    const legacy = {
      id: "tkt_legacy_problem", reference: "PRB-LEGACY", tenantId: TENANT, type: "problem", subject: "Old problem ticket", body: "historical", status: "open", priority: "medium",
      category: "IT", channel: "portal", tags: [], customFields: { typeDetails: { risk: "high", affectedService: "ignored for legacy" } }, requesterEmail: "dana.lee@netlink.com",
      ciIds: [], linkedTicketIds: [], slaPausedMins: 0, createdAt: stamp, updatedAt: stamp, deletedAt: null, workflowVersion: 0, assigneeId: null,
    } as unknown as TicketRow;
    await store.tickets.create(legacy);
    created.push(legacy.id);
    const view = await getTicketView(legacy.id, { includeInternal: true });
    expect(view?.type).toBe("problem");
    expect(view?.reference).toBe("PRB-LEGACY");
    expect(TICKET_TYPE_LABELS[view!.type]).toBe("Problem (legacy)");
    expect(typeDetailRows(view!.type, view!.customFields, view!.approvals)).toEqual([]); // stray details are not shown for a legacy type
    expect((await store.tickets.get(legacy.id))?.type).toBe("problem"); // not converted
  });
});

describe("OpenAPI describes the intake contract", () => {
  it("documents type, typeDetails and the 400 for invalid types", async () => {
    const res = await getOpenApi(new Request("http://intake-types.test/api/v1/openapi.json", { headers: { "x-actor": "dana.lee@netlink.com" } }));
    const spec = (await res.json()) as { paths: Record<string, { post: { requestBody: { content: { "application/json": { schema: { properties: Record<string, { enum?: string[]; properties?: object }> } } } }; responses: Record<string, unknown> } }> };
    const schema = spec.paths["/intake"].post.requestBody.content["application/json"].schema;
    expect(schema.properties.type.enum).toEqual(["incident", "service_request", "change"]);
    expect(Object.keys(schema.properties.typeDetails.properties ?? {}).sort()).toEqual(
      ["affectedService", "fulfilmentDetails", "implementationPlan", "impact", "maintenanceEnd", "maintenanceStart", "requestedItem", "risk", "rollbackPlan"].sort()
    );
    expect(Object.keys(spec.paths["/intake"].post.responses)).toContain("400");
  });
});
