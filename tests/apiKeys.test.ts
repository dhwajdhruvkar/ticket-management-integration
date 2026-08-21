import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getStore } from "@/server/data";
import { createApiKey, extractApiKey, revokeApiKey, verifyApiKey } from "@/server/auth/apiKeys";
import { can } from "@/server/auth/rbac";
import { verifyChain } from "@/server/audit/auditChain";

const TENANT = "tenant_netlink";

beforeAll(async () => {
  const file = path.join(process.cwd(), ".data-test", "store.json");
  fs.rmSync(file, { force: true });
  await getStore();
});

describe("API keys", () => {
  it("creates a key and verifies it", async () => {
    const { record, key } = await createApiKey(TENANT, { name: "Test integration", role: "agent" });
    expect(key.startsWith("nlk_")).toBe(true);
    expect(record.keyHash).not.toContain(key.slice(4)); // hash, not the key
    expect(record.keyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(record.prefix).toBe(key.slice(0, 10));

    const store = await getStore();
    const persisted = await store.apiKeys.get(record.id);
    expect(persisted?.keyHash).toBe(record.keyHash);
    expect(JSON.stringify(persisted)).not.toContain(key);

    const verified = await verifyApiKey(key);
    expect(verified).not.toBeNull();
    expect(verified!.tenantId).toBe(TENANT);
    expect(verified!.role).toBe("agent");
  });

  it("rejects unknown and revoked keys", async () => {
    expect(await verifyApiKey("nlk_definitely-not-a-real-key")).toBeNull();

    const { record, key } = await createApiKey(TENANT, { name: "Short lived" });
    expect(await verifyApiKey(key)).not.toBeNull();
    await revokeApiKey(TENANT, record.id);
    expect(await verifyApiKey(key)).toBeNull();
  });

  it("rejects expired keys", async () => {
    const { key } = await createApiKey(TENANT, {
      name: "Expired",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(await verifyApiKey(key)).toBeNull();
  });

  it("does not allow one tenant to revoke another tenant's key", async () => {
    const { record, key } = await createApiKey(TENANT, {
      name: "Tenant boundary",
      role: "requester",
    });

    expect(await revokeApiKey("tenant_other", record.id)).toBe(false);
    await expect(verifyApiKey(key)).resolves.toMatchObject({
      tenantId: TENANT,
      role: "requester",
    });
  });

  it("restricts API-key management to admin roles", () => {
    expect(can("requester", "admin")).toBe(false);
    expect(can("agent", "admin")).toBe(false);
    expect(can("manager", "admin")).toBe(false);
    expect(can("tenant_admin", "admin")).toBe(true);
    expect(can("super_admin", "admin")).toBe(true);
  });

  it("audits creation and revocation without recording the full key", async () => {
    const { record, key } = await createApiKey(
      TENANT,
      { name: "Audited integration", role: "agent" },
      "security-test"
    );
    expect(await revokeApiKey(TENANT, record.id, "security-test")).toBe(true);

    const store = await getStore();
    const audits = await store.audit.list({ tenantId: TENANT });
    expect(audits.some((row) => row.action === "auth.key_created")).toBe(true);
    expect(audits.some((row) => row.action === "auth.key_revoked")).toBe(true);
    expect(JSON.stringify(audits)).not.toContain(key);
    await expect(verifyChain(TENANT)).resolves.toMatchObject({ valid: true });
  });

  it("extracts keys from Authorization: Bearer and x-api-key", () => {
    const bearer = new Request("http://x", { headers: { authorization: "Bearer nlk_abc123" } });
    const headerReq = new Request("http://x", { headers: { "x-api-key": "nlk_xyz" } });
    const other = new Request("http://x", { headers: { authorization: "Bearer jwt-token" } });
    expect(extractApiKey(bearer)).toBe("nlk_abc123");
    expect(extractApiKey(headerReq)).toBe("nlk_xyz");
    expect(extractApiKey(other)).toBeNull();
  });
});
