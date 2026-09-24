import fs from "node:fs";
import path from "node:path";
import { createHmac } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));

import { createApiKey, deleteApiKey, rotateApiKey, verifyApiKey } from "@/server/auth/apiKeys";
import { getStore } from "@/server/data";
import { POST as createTicketRoute, GET as listTicketsRoute } from "@/app/api/v1/tickets/route";
import { POST as addMessageRoute } from "@/app/api/v1/tickets/[id]/messages/route";
import { GET as getMeRoute } from "@/app/api/v1/me/route";
import {
  normalizeWebhookUrl,
  retryPendingWebhookDeliveries,
  webhookSigningSecret,
} from "@/server/services/integrationWebhookService";

const TENANT = "tenant_netlink";
const params = (id: string) => ({ params: Promise.resolve({ id }) });

function request(
  pathname: string,
  options: { method?: string; key?: string; body?: unknown; idempotencyKey?: string } = {}
): Request {
  const headers = new Headers();
  if (options.key) headers.set("authorization", `Bearer ${options.key}`);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.idempotencyKey) headers.set("idempotency-key", options.idempotencyKey);
  return new Request(`http://integration-hardening.test/api/v1${pathname}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

describe.sequential("tenant integration hardening", () => {
  beforeAll(async () => {
    fs.rmSync(path.join(process.cwd(), ".data-test", "store.json"), { force: true });
    await getStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requires and enforces a fixed requester for least-privilege submitter keys", async () => {
    await expect(
      createApiKey(TENANT, { name: "Unbound submitter", role: "ticket_submitter" })
    ).rejects.toThrow(/requires an active requester identity/i);

    const store = await getStore();
    const requester = (await store.users.list({ tenantId: TENANT })).find(
      (user) => user.email === "dana.lee@netlink.com"
    )!;
    const created = await createApiKey(TENANT, {
      name: "Bound submitter",
      role: "ticket_submitter",
      requesterId: requester.id,
    });

    await expect(verifyApiKey(created.key)).resolves.toMatchObject({
      tenantId: TENANT,
      role: "ticket_submitter",
      requesterId: requester.id,
      requesterEmail: requester.email,
    });

    const me = await getMeRoute(request("/me", { key: created.key }));
    expect(me.status).toBe(200);
    await expect(me.json()).resolves.toMatchObject({
      ok: true,
      data: {
        role: "ticket_submitter",
        tenantId: TENANT,
        organization: {
          id: TENANT,
          name: "Netlink Software Group America",
          code: "netlink",
        },
        permissions: expect.arrayContaining(["ticket.create", "ticket.read"]),
      },
    });

    const body = {
      subject: "Idempotent partner ticket",
      body: "The partner must not be able to spoof the requester.",
      requesterEmail: "spoofed@outside.test",
      externalTicketId: `partner-${Date.now()}`,
      channel: "api",
      source: "partner-test",
      autoResolve: false,
    };
    const first = await createTicketRoute(
      request("/tickets", { method: "POST", key: created.key, body, idempotencyKey: "partner-request-1" })
    );
    expect(first.status).toBe(201);
    expect(first.headers.get("idempotency-replayed")).toBe("false");
    const firstJson = await first.json();
    expect(firstJson.data.requesterEmail).toBe(requester.email);
    expect(firstJson.data.requesterId).toBe(requester.id);

    const replay = await createTicketRoute(
      request("/tickets", { method: "POST", key: created.key, body, idempotencyKey: "partner-request-1" })
    );
    expect(replay.status).toBe(200);
    expect(replay.headers.get("idempotency-replayed")).toBe("true");
    await expect(replay.json()).resolves.toMatchObject({ data: { id: firstJson.data.id } });

    const conflict = await createTicketRoute(
      request("/tickets", {
        method: "POST",
        key: created.key,
        body: { ...body, subject: "Different payload" },
        idempotencyKey: "partner-request-1",
      })
    );
    expect(conflict.status).toBe(409);

    const externalOnlyBody = {
      ...body,
      subject: "External-id fallback ticket",
      externalTicketId: "e".repeat(128),
    };
    const externalOnlyFirst = await createTicketRoute(
      request("/tickets", { method: "POST", key: created.key, body: externalOnlyBody })
    );
    const externalOnlyReplay = await createTicketRoute(
      request("/tickets", { method: "POST", key: created.key, body: externalOnlyBody })
    );
    expect(externalOnlyFirst.status).toBe(201);
    expect(externalOnlyReplay.status).toBe(200);
    expect(externalOnlyReplay.headers.get("idempotency-replayed")).toBe("true");

    const own = await listTicketsRoute(request("/tickets?pageSize=100", { key: created.key }));
    const ownJson = await own.json();
    expect(ownJson.data.every((ticket: { requesterEmail: string }) => ticket.requesterEmail === requester.email)).toBe(true);

    const message = await addMessageRoute(
      request(`/tickets/${firstJson.data.id}/messages`, {
        method: "POST",
        key: created.key,
        body: { body: "This must be blocked." },
      }),
      params(firstJson.data.id)
    );
    expect(message.status).toBe(403);

    await expect(store.apiKeys.get(created.record.id)).resolves.toMatchObject({
      lastTestStatus: "success",
    });
    await store.users.update(requester.id, { active: false });
    await expect(verifyApiKey(created.key)).resolves.toBeNull();
    await store.users.update(requester.id, { active: true });
    await deleteApiKey(TENANT, created.record.id, "test-cleanup");
  });

  it("rotates a bearer token in-place and immediately invalidates the old token", async () => {
    const created = await createApiKey(TENANT, { name: "Rotation test", role: "agent" });
    const rotated = await rotateApiKey(TENANT, created.record.id, "rotation-test");
    expect(rotated).not.toBeNull();
    expect(rotated!.record.id).toBe(created.record.id);
    expect(rotated!.key).not.toBe(created.key);
    await expect(verifyApiKey(created.key)).resolves.toBeNull();
    await expect(verifyApiKey(rotated!.key)).resolves.toMatchObject({ keyId: created.record.id });
    await deleteApiKey(TENANT, created.record.id, "test-cleanup");
  });

  it("delivers scoped callbacks only for tickets created by that exact integration", async () => {
    const callback = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", callback);
    const store = await getStore();
    const requester = (await store.users.list({ tenantId: TENANT })).find(
      (user) => user.email === "dana.lee@netlink.com"
    )!;
    const first = await createApiKey(TENANT, {
      name: "Scoped callback A",
      role: "ticket_submitter",
      requesterId: requester.id,
      webhookUrl: "https://partner-a.example.test/netlink",
      webhookEvents: ["ticket.created"],
    });
    const second = await createApiKey(TENANT, {
      name: "Scoped callback B",
      role: "ticket_submitter",
      requesterId: requester.id,
      webhookUrl: "https://partner-b.example.test/netlink",
      webhookEvents: ["ticket.created"],
    });

    const response = await createTicketRoute(
      request("/tickets", {
        method: "POST",
        key: first.key,
        body: {
          subject: "Scoped callback ticket",
          body: "Only integration A may receive this callback.",
          channel: "api",
          source: "scoped-webhook-test",
          autoResolve: false,
        },
      })
    );
    expect(response.status).toBe(201);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(String(callback.mock.calls[0][0])).toContain("partner-a.example.test");
    await expect(store.webhookDeliveries.list({ apiKeyId: second.record.id })).resolves.toHaveLength(0);

    await deleteApiKey(TENANT, first.record.id, "test-cleanup");
    await deleteApiKey(TENANT, second.record.id, "test-cleanup");
  });

  it("signs outbound ticket callbacks, removes successes, and retries failures", async () => {
    const callback = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", callback);
    const created = await createApiKey(TENANT, {
      name: "Webhook integration",
      role: "agent",
      webhookUrl: "https://partner.example.test/netlink",
      webhookEvents: ["ticket.created"],
    });
    const secret = webhookSigningSecret(created.record)!;

    const response = await createTicketRoute(
      request("/tickets", {
        method: "POST",
        key: created.key,
        idempotencyKey: `webhook-success-${Date.now()}`,
        body: {
          subject: "Webhook success",
          body: "Callback should be signed.",
          requesterEmail: "webhook@example.test",
          channel: "api",
          source: "webhook-test",
          autoResolve: false,
        },
      })
    );
    expect(response.status).toBe(201);
    expect(callback).toHaveBeenCalled();
    const [, init] = callback.mock.calls[0] as [URL, RequestInit];
    const headers = init.headers as Record<string, string>;
    const expected = createHmac("sha256", secret)
      .update(`${headers["X-Netlink-Timestamp"]}.${String(init.body)}`)
      .digest("hex");
    expect(headers["X-Netlink-Signature"]).toBe(`sha256=${expected}`);

    const store = await getStore();
    await expect(store.webhookDeliveries.list({ apiKeyId: created.record.id })).resolves.toHaveLength(0);
    await expect(store.apiKeys.get(created.record.id)).resolves.toMatchObject({
      webhookLastStatus: 204,
      webhookLastError: null,
    });

    callback.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await createTicketRoute(
      request("/tickets", {
        method: "POST",
        key: created.key,
        idempotencyKey: `webhook-retry-${Date.now()}`,
        body: {
          subject: "Webhook retry",
          body: "First callback fails.",
          requesterEmail: "webhook@example.test",
          channel: "api",
          source: "webhook-test",
          autoResolve: false,
        },
      })
    );
    const pending = await store.webhookDeliveries.list({ apiKeyId: created.record.id });
    expect(pending).toHaveLength(1);
    expect(pending[0].attempts).toBe(1);
    await store.webhookDeliveries.update(pending[0].id, {
      nextAttemptAt: new Date(Date.now() - 1000).toISOString(),
    });
    callback.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await retryPendingWebhookDeliveries();
    await expect(store.webhookDeliveries.list({ apiKeyId: created.record.id })).resolves.toHaveLength(0);
    await deleteApiKey(TENANT, created.record.id, "test-cleanup");
  });

  it("rejects callback URLs that target local or private networks", () => {
    expect(() => normalizeWebhookUrl("http://localhost:3000/callback")).toThrow(/local or private/i);
    expect(() => normalizeWebhookUrl("https://127.0.0.1/callback")).toThrow(/local or private/i);
    expect(() => normalizeWebhookUrl("https://[::1]/callback")).toThrow(/local or private/i);
    expect(() => normalizeWebhookUrl("https://[::ffff:127.0.0.1]/callback")).toThrow(/local or private/i);
    expect(() => normalizeWebhookUrl("https://169.254.169.254/latest/meta-data")).toThrow(/local or private/i);
  });
});
