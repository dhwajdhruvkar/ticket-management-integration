import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }));

vi.mock("@/auth", () => ({ auth: mockAuth }));

import {
  GET as listApiKeysRoute,
  POST as createApiKeyRoute,
} from "@/app/api/v1/api-keys/route";
import { DELETE as deleteApiKeyRoute } from "@/app/api/v1/api-keys/[id]/route";
import { POST as rotateApiKeyRoute } from "@/app/api/v1/api-keys/[id]/rotate/route";
import { PATCH as configureWebhookRoute } from "@/app/api/v1/api-keys/[id]/webhook/route";
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
    expect(body.data).not.toHaveProperty("webhookSecretSalt");
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

  it("uses an administrator key to mint a fixed-requester ticket submitter", async () => {
    mockAuth.mockResolvedValue(null);
    const store = await getStore();
    const requester = (await store.users.list({ tenantId: TENANT })).find(
      (user) => user.email === "dana.lee@netlink.com"
    )!;
    const response = await createApiKeyRoute(
      request("/api-keys", {
        method: "POST",
        key: adminKey,
        body: {
          name: "External ticket management system",
          role: "ticket_submitter",
          requesterId: requester.id,
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
    expect(body.data.role).toBe("ticket_submitter");
    expect(body.data.key).toMatch(/^nlk_[A-Za-z0-9_-]{43}$/);
    expect(body.data).not.toHaveProperty("keyHash");
    expect(body.data).not.toHaveProperty("webhookSecretSalt");
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

  it("rotates bearer credentials and configures a separately signed callback", async () => {
    mockAuth.mockResolvedValue(null);
    const previous = integrationKey;
    const rotated = await rotateApiKeyRoute(
      request(`/api-keys/${integrationKeyId}/rotate`, { method: "POST", key: adminKey }),
      params(integrationKeyId)
    );
    const rotatedBody = (await rotated.json()) as Envelope<{ key: string; webhookSecretSalt?: string }>;
    expect(rotated.status).toBe(200);
    expect(rotatedBody.data.key).toMatch(/^nlk_[A-Za-z0-9_-]{43}$/);
    expect(rotatedBody.data).not.toHaveProperty("webhookSecretSalt");
    integrationKey = rotatedBody.data.key;
    expect((await listTicketsRoute(request("/tickets", { key: previous }))).status).toBe(401);

    const privateTarget = await configureWebhookRoute(
      request(`/api-keys/${integrationKeyId}/webhook`, {
        method: "PATCH",
        key: adminKey,
        body: { url: "https://127.0.0.1/callback" },
      }),
      params(integrationKeyId)
    );
    expect(privateTarget.status).toBe(400);

    const configured = await configureWebhookRoute(
      request(`/api-keys/${integrationKeyId}/webhook`, {
        method: "PATCH",
        key: adminKey,
        body: {
          url: "https://partner.example.test/netlink",
          events: ["ticket.updated"],
          active: false,
        },
      }),
      params(integrationKeyId)
    );
    const configuredBody = (await configured.json()) as Envelope<{
      webhookSecret: string;
      webhookSecretSalt?: string;
    }>;
    expect(configured.status).toBe(200);
    expect(configuredBody.data.webhookSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(configuredBody.data).not.toHaveProperty("webhookSecretSalt");
  });

  it("prevents a ticket submitter integration key from managing credentials", async () => {
    mockAuth.mockResolvedValue(null);
    const response = await listApiKeysRoute(request("/api-keys", { key: integrationKey }));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: "Forbidden." });
  });

  it("deletes both credentials and immediately rejects their future use", async () => {
    mockAuth.mockResolvedValue(null);
    const deletedIntegration = await deleteApiKeyRoute(
      request(`/api-keys/${integrationKeyId}`, { method: "DELETE", key: adminKey }),
      params(integrationKeyId)
    );
    expect(deletedIntegration.status).toBe(200);
    await expect(deletedIntegration.json()).resolves.toMatchObject({ ok: true, data: { deleted: true } });

    const rejectedIntegration = await listTicketsRoute(
      request("/tickets", { key: integrationKey })
    );
    expect(rejectedIntegration.status).toBe(401);

    mockAuth.mockResolvedValue(adminSession);
    const deletedAdmin = await deleteApiKeyRoute(
      request(`/api-keys/${adminKeyId}`, { method: "DELETE" }),
      params(adminKeyId)
    );
    expect(deletedAdmin.status).toBe(200);
    await expect(deletedAdmin.json()).resolves.toMatchObject({ ok: true, data: { deleted: true } });

    mockAuth.mockResolvedValue(null);
    const rejectedAdmin = await listApiKeysRoute(request("/api-keys", { key: adminKey }));
    expect(rejectedAdmin.status).toBe(401);
  });
});
