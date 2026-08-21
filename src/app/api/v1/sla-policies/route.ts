import { paginated, parsePagination } from "@/server/http";
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
  const parsed = parsePagination(req, {
    defaultSortBy: "priority",
    defaultSortDir: "asc",
    allowedSortBy: ["priority"] as const,
  });
  if (!parsed.ok) return parsed.response;
  const pagination = parsed.value;
  const store = await getStore();
  const policies = await store.slaPolicies.list({ tenantId: ctx.tenantId });
  policies.sort((a, b) => {
    const primary = ORDER.indexOf(a.priority) - ORDER.indexOf(b.priority);
    if (primary !== 0) return pagination.sortDir === "asc" ? primary : -primary;
    return a.id.localeCompare(b.id);
  });
  return paginated(
    policies.slice(pagination.skip, pagination.skip + pagination.take),
    policies.length,
    pagination
  );
}
