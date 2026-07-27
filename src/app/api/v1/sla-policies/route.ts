import { ok } from "@/server/http";
import { isResponse, requirePermission } from "@/server/guards";
import { getStore } from "@/server/data";
import type { TicketPriority } from "@/server/domain/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/v1/sla-policies — list the tenant's SLA policies ordered P1..P5 (for
// the settings table). Per-policy edits (targets, calendar link) live on [id].
const ORDER: TicketPriority[] = ["critical", "high", "medium", "low", "very_low"];

export async function GET(req: Request) {
  const ctx = await requirePermission(req, "report.read");
  if (isResponse(ctx)) return ctx;
  const store = await getStore();
  const policies = await store.slaPolicies.list({ tenantId: ctx.tenantId });
  policies.sort((a, b) => ORDER.indexOf(a.priority) - ORDER.indexOf(b.priority));
  return ok(policies);
}
