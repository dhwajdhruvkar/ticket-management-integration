import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }));

vi.mock("@/auth", () => ({ auth: mockAuth }));

import {
  GET as listApiKeysRoute,
  POST as createApiKeyRoute,
} from "@/app/api/v1/api-keys/route";
import { DELETE as revokeApiKeyRoute } from "@/app/api/v1/api-keys/[id]/route";
import {
  GET as listTicketsRoute,
  POST as createTicketRoute,
} from "@/app/api/v1/tickets/route";
import { getStore } from "@/server/data";

const BASE = "http://api-key-routes.test/api/v1";
const TENANT = "tenant_netlink";

interface Envelope<T> {
  ok: boolean;
  data: T;
  error?: string;
}

function request(
  path: string,
  options: { method?: string; key?: string; body?: unknown } = {}
): Request {
  const headers = new Headers();
  if (options.key) headers.set("authorization", `Bearer ${options.key}`);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  return new Request(`${BASE}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

const adminSession = {
  user: {
    id: "user_priya",
    name: "Priya Sharma",
    email: "priya.sharma@netlink.com",
    role: "tenant_admin",
    tenantId: TENANT,
  },
};

const managerSession = {
  user: {
    id: "user_meera",
    name: "Meera Nair",
    email: "meera.nair@netlink.com",
    role: "manager",
    tenantId: TENANT,
  },
};

describe.sequential("API-key management routes and external integration lifecycle", () => {
  let adminKeyId = "";
  let adminKey = "";
  let integrationKeyId = "";
  let integrationKey = "";
  let ticketId = "";

  beforeAll(async () => {
    await getStore();
  });

  afterAll(async () => {
    const store = await getStore();
    if (ticketId) await store.tickets.remove(ticketId);
    if (integrationKeyId) await store.apiKeys.remove(integrationKeyId);
    if (adminKeyId) await store.apiKeys.remove(adminKeyId);
    mockAuth.mockReset();
  });

  it("allows only an administrator to create an integration credential", async () => {
    mockAuth.mockResolvedValue(managerSession);
    const response = await createApiKeyRoute(
      request("/api-keys", {
        method: "POST",
        body: { name: "Forbidden manager key", role: "agent" },
      })
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: "Forbidden." });

    mockAuth.mockResolvedValue(adminSession);
    const created = await createApiKeyRoute(
      request("/api-keys", {
        method: "POST",
        body: {
          name: "Route bootstrap credential",
          role: "tenant_admin",
          description: "Creates least-privileged external integration keys",
        },
      })
    );
    const body = (await created.json()) as Envelope<{
      id: string;
      key: string;
      keyHash?: string;
      tenantId: string;
      role: string;
      prefix: string;
    }>;

    expect(created.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.data).toMatchObject({ tenantId: TENANT, role: "tenant_admin" });
    expect(body.data.key).toMatch(/^nlk_[A-Za-z0-9_-]{43}$/);
    expect(body.data.prefix).toBe(body.data.key.slice(0, 10));
    expect(body.data).not.toHaveProperty("keyHash");
    adminKeyId = body.data.id;
    adminKey = body.data.key;
  });

  it("lists only non-secret metadata and never returns the one-time key again", async () => {
    mockAuth.mockResolvedValue(null);
    const response = await listApiKeysRoute(
      request("/api-keys?page=1&pageSize=100", { key: adminKey })
    );
    const raw = await response.text();
    const body = JSON.parse(raw) as Envelope<Array<Record<string, unknown>>>;
    const listed = body.data.find((row) => row.id === adminKeyId);

    expect(response.status).toBe(200);
    expect(listed).toMatchObject({ id: adminKeyId, active: true, role: "tenant_admin" });
    expect(listed).not.toHaveProperty("keyHash");
    expect(raw).not.toContain(adminKey);
  });

  it("uses an administrator key to mint a least-privileged integration key", async () => {
    mockAuth.mockResolvedValue(null);
    const response = await createApiKeyRoute(
      request("/api-keys", {
        method: "POST",
        key: adminKey,
        body: {
          name: "External ticket management system",
          role: "agent",
          description: "Route-level integration verification",
        },
      })
    );
    const body = (await response.json()) as Envelope<{
      id: string;
      key: string;
      role: string;
      keyHash?: string;
    }>;

    expect(response.status).toBe(201);
    expect(body.data.role).toBe("agent");
    expect(body.data.key).toMatch(/^nlk_[A-Za-z0-9_-]{43}$/);
    expect(body.data).not.toHaveProperty("keyHash");
    integrationKeyId = body.data.id;
    integrationKey = body.data.key;
  });

  it("creates a support ticket through the external API with the generated key", async () => {
    mockAuth.mockResolvedValue(null);
    const response = await createTicketRoute(
      request("/tickets", {
        method: "POST",
        key: integrationKey,
        body: {
          subject: "Generated API key integration verification",
          body: "Created by a simulated external support ticket management system.",
          requesterEmail: "integration.verification@netlink.example",
          channel: "api",
          source: "api-key-route-test",
          autoResolve: false,
        },
      })
    );
    const body = (await response.json()) as Envelope<{ id: string; reference: string }>;

    expect(response.status).toBe(201);
    expect(body.data.reference).toMatch(/^INC-/);
    ticketId = body.data.id;
  });

  it("prevents an agent integration key from managing credentials", async () => {
    mockAuth.mockResolvedValue(null);
    const response = await listApiKeysRoute(request("/api-keys", { key: integrationKey }));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: "Forbidden." });
  });

  it("revokes both credentials and immediately rejects their future use", async () => {
    mockAuth.mockResolvedValue(null);
    const revokedIntegration = await revokeApiKeyRoute(
      request(`/api-keys/${integrationKeyId}`, { method: "DELETE", key: adminKey }),
      params(integrationKeyId)
    );
    expect(revokedIntegration.status).toBe(200);

    const rejectedIntegration = await listTicketsRoute(
      request("/tickets", { key: integrationKey })
    );
    expect(rejectedIntegration.status).toBe(401);

    mockAuth.mockResolvedValue(adminSession);
    const revokedAdmin = await revokeApiKeyRoute(
      request(`/api-keys/${adminKeyId}`, { method: "DELETE" }),
      params(adminKeyId)
    );
    expect(revokedAdmin.status).toBe(200);

    mockAuth.mockResolvedValue(null);
    const rejectedAdmin = await listApiKeysRoute(request("/api-keys", { key: adminKey }));
    expect(rejectedAdmin.status).toBe(401);
  });
});
