import { describe, it, expect } from "vitest";
import { appendAudit, verifyChain } from "@/server/audit/auditChain";
import { getStore } from "@/server/data";

const TENANT = `t_audit_${Date.now()}`;

describe("audit chain", () => {
  it("verifies a valid hash-linked chain and detects tampering", async () => {
    await appendAudit({ tenantId: TENANT, actor: "system", action: "first", payload: { a: 1 } });
    await appendAudit({ tenantId: TENANT, actor: "system", action: "second", payload: { a: 2 } });
    await appendAudit({ tenantId: TENANT, actor: "system", action: "third", payload: { a: 3 } });

    let result = await verifyChain(TENANT);
    expect(result.valid).toBe(true);
    expect(result.length).toBe(3);

    // Tamper with the middle block's payload.
    const store = await getStore();
    const records = (await store.audit.list({ tenantId: TENANT })).sort((a, b) => a.index - b.index);
    await store.audit.update(records[1].id, { payload: { a: 999 } });

    result = await verifyChain(TENANT);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1);
  });
});
