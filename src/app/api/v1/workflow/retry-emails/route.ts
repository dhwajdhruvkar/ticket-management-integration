import { getStore } from "@/server/data";
import { requirePermission, isResponse } from "@/server/guards";
import { fail, ok } from "@/server/http";
import { appendAudit } from "@/server/audit/auditChain";

export const runtime = "nodejs";
export async function POST(req: Request) {
  const ctx = await requirePermission(req, "admin");
  if (isResponse(ctx)) return ctx;
  if (ctx.actor.apiKeyId) return fail("Use an administrator account.", 403);
  const store = await getStore();
  const retried = await store.transaction(async (tx) => {
    const rows = await tx.notificationDeliveries.list({ tenantId: ctx.tenantId, status: "failed" }, { take: 100, orderBy: { field: "updatedAt", dir: "asc" } });
    let count = 0;
    for (const row of rows) if (await tx.notificationDeliveries.updateIf(row.id, { tenantId: ctx.tenantId, status: "failed" }, { status: "pending", attempts: 0, owner: null, leaseUntil: null, lastError: null, nextAttemptAt: new Date().toISOString(), updatedAt: new Date().toISOString() })) count++;
    if (count) await appendAudit({ tenantId: ctx.tenantId, actor: ctx.actor.name, action: "workflow.email.retry", payload: { count } }, tx);
    return count;
  });
  return ok({ retried });
}
