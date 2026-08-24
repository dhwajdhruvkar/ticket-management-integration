import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Route handlers resolve Auth.js before they inspect an API key. The production
// behavior for this M2M suite is a null browser session; mock that boundary so
// Vitest does not load Auth.js's Next.js runtime adapter.
vi.mock("@/auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));
import { decideApiV1Access } from "@/server/auth/apiGateway";
import { createApiKey, revokeApiKey } from "@/server/auth/apiKeys";
import { getStore } from "@/server/data";
import {
  GET as listTicketsRoute,
  POST as createTicketRoute,
} from "@/app/api/v1/tickets/route";
import {
  GET as getTicketRoute,
  PATCH as updateTicketRoute,
} from "@/app/api/v1/tickets/[id]/route";
import { POST as addMessageRoute } from "@/app/api/v1/tickets/[id]/messages/route";

const TENANT = "tenant_netlink";

interface Envelope<T> {
  ok: boolean;
  data: T;
  error?: string;
  meta?: {
    total: number;
    page: number;
    pageSize: number;
    limit: number;
    totalPages: number;
  };
}

function request(
  pathname: string,
  options: { method?: string; key?: string; body?: unknown } = {}
): Request {
  const headers = new Headers();
  if (options.key) headers.set("authorization", `Bearer ${options.key}`);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  return new Request(`http://phase13.test/api/v1${pathname}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe.sequential("Phase 13 external ticket integration contract", () => {
  let managerKeyId = "";
  let managerKey = "";
  let requesterKeyId = "";
  let requesterKey = "";
  let ticketId = "";
  let ticketReference = "";
  const subject = `Phase 13 route integration ${Date.now()}`;
  const messageBody = "Phase 13 external-system message";

  beforeAll(async () => {
    const file = path.join(process.cwd(), ".data-test", "store.json");
    fs.rmSync(file, { force: true });
    await getStore();

    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    const manager = await createApiKey(TENANT, {
      name: "Phase 13 manager integration",
      role: "manager",
      expiresAt,
    });
    managerKeyId = manager.record.id;
    managerKey = manager.key;

    const requester = await createApiKey(TENANT, {
      name: "Phase 13 insufficient-permission integration",
      role: "requester",
      expiresAt,
    });
    requesterKeyId = requester.record.id;
    requesterKey = requester.key;
  });

  afterAll(async () => {
    if (managerKeyId) await revokeApiKey(TENANT, managerKeyId, "phase13-test-cleanup");
    if (requesterKeyId) await revokeApiKey(TENANT, requesterKeyId, "phase13-test-cleanup");
  });

  it("returns 200 for a valid key, 401 for no key at the production gateway, and 401 for an invalid key", async () => {
    const valid = await listTicketsRoute(request("/tickets", { key: managerKey }));
    expect(valid.status).toBe(200);

    const noKey = decideApiV1Access({
      pathname: "/api/v1/tickets",
      method: "GET",
      headers: new Headers(),
      hasSession: false,
      demoMode: false,
    });
    expect(noKey).toMatchObject({ allowed: false, status: 401 });

    const invalid = await listTicketsRoute(
      request("/tickets", { key: "nlk_invalid-phase13-key" })
    );
    expect(invalid.status).toBe(401);
    await expect(invalid.json()).resolves.toMatchObject({
      ok: false,
      error: "Invalid, expired, or revoked API key.",
    });
  });

  it("creates a ticket through the same intake pipeline used in production", async () => {
    const response = await createTicketRoute(
      request("/tickets", {
        method: "POST",
        key: managerKey,
        body: {
          subject,
          body: "Ticket created by the Phase 13 external integration test.",
          requesterEmail: "phase13.integration@netlink.example",
          channel: "api",
          source: "phase13-route-test",
          category: "IT",
          impact: "low",
          urgency: "medium",
          tags: ["phase13", "external-integration"],
          autoResolve: false,
        },
      })
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as Envelope<{ id: string; reference: string }>;
    expect(body.ok).toBe(true);
    expect(body.data.reference).toMatch(/^INC-/);
    ticketId = body.data.id;
    ticketReference = body.data.reference;
  });

  it("gets the created ticket and rejects an authenticated underprivileged key with 403", async () => {
    const fetched = await getTicketRoute(request(`/tickets/${ticketId}`, { key: managerKey }), params(ticketId));
    expect(fetched.status).toBe(200);
    await expect(fetched.json()).resolves.toMatchObject({
      ok: true,
      data: { id: ticketId, reference: ticketReference, subject },
    });

    const forbidden = await updateTicketRoute(
      request(`/tickets/${ticketId}`, {
        method: "PATCH",
        key: requesterKey,
        body: { status: "in_progress" },
      }),
      params(ticketId)
    );
    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toMatchObject({ ok: false, error: "Forbidden." });
  });

  it("updates the ticket, adds a message, and retrieves that message in the ticket view", async () => {
    const updated = await updateTicketRoute(
      request(`/tickets/${ticketId}`, {
        method: "PATCH",
        key: managerKey,
        body: {
          status: "in_progress",
          subcategory: "External integration",
          tags: ["phase13", "external-integration", "updated"],
        },
      }),
      params(ticketId)
    );
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      ok: true,
      data: { id: ticketId, status: "in_progress", subcategory: "External integration" },
    });

    const added = await addMessageRoute(
      request(`/tickets/${ticketId}/messages`, {
        method: "POST",
        key: managerKey,
        body: { body: messageBody, visibility: "internal" },
      }),
      params(ticketId)
    );
    expect(added.status).toBe(200);

    const fetched = await getTicketRoute(request(`/tickets/${ticketId}`, { key: managerKey }), params(ticketId));
    const body = (await fetched.json()) as Envelope<{ messages: Array<{ body: string; visibility: string }> }>;
    expect(body.data.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ body: messageBody, visibility: "internal" }),
      ])
    );
  });

  it("lists the ticket with stable pagination and persists it plus its message in the datastore", async () => {
    const firstResponse = await listTicketsRoute(
      request("/tickets?page=1&pageSize=1&sortBy=createdAt&sortDir=desc", { key: managerKey })
    );
    const first = (await firstResponse.json()) as Envelope<Array<{ id: string }>>;
    expect(firstResponse.status).toBe(200);
    expect(first.meta).toMatchObject({ page: 1, pageSize: 1, limit: 1 });
    expect(first.meta!.total).toBeGreaterThan(1);
    expect(first.data).toHaveLength(1);

    const secondResponse = await listTicketsRoute(
      request("/tickets?page=2&pageSize=1&sortBy=createdAt&sortDir=desc", { key: managerKey })
    );
    const second = (await secondResponse.json()) as Envelope<Array<{ id: string }>>;
    expect(secondResponse.status).toBe(200);
    expect(second.meta).toMatchObject({ page: 2, pageSize: 1, limit: 1 });
    expect(second.data).toHaveLength(1);
    expect(second.data[0].id).not.toBe(first.data[0].id);

    const store = await getStore();
    await expect(store.tickets.get(ticketId)).resolves.toMatchObject({
      id: ticketId,
      reference: ticketReference,
      subject,
      status: "in_progress",
    });
    await expect(store.messages.list({ ticketId })).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ body: messageBody })])
    );
  });
});
