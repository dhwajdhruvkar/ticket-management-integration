import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getStore } from "@/server/data";
import { createApiKey, extractApiKey, revokeApiKey, verifyApiKey } from "@/server/auth/apiKeys";

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
    expect(record.prefix).toBe(key.slice(0, 10));

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

  it("extracts keys from Authorization: Bearer and x-api-key", () => {
    const bearer = new Request("http://x", { headers: { authorization: "Bearer nlk_abc123" } });
    const headerReq = new Request("http://x", { headers: { "x-api-key": "nlk_xyz" } });
    const other = new Request("http://x", { headers: { authorization: "Bearer jwt-token" } });
    expect(extractApiKey(bearer)).toBe("nlk_abc123");
    expect(extractApiKey(headerReq)).toBe("nlk_xyz");
    expect(extractApiKey(other)).toBeNull();
  });
});
