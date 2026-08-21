import { currentActor, currentTenantId } from "@/server/context";
import {
  fail,
  listOptionsFromPagination,
  ok,
  paginated,
  parsePagination,
} from "@/server/http";
import { can } from "@/server/auth/rbac";
import { getAudit, verifyChain } from "@/server/audit/auditChain";
import type { AuditRow, Role } from "@/server/domain/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const [tenantId, actor] = await Promise.all([currentTenantId(req), currentActor(req)]);
  if (!can(actor.role as Role, "audit.read")) return fail("Forbidden.", 403);
  const url = new URL(req.url);
  const ticketId = url.searchParams.get("ticketId") ?? undefined;

  if (url.searchParams.get("verify") === "1") {
    return ok(await verifyChain(tenantId));
  }

  const parsed = parsePagination(req, {
    defaultSortBy: "index",
    defaultSortDir: "desc",
    allowedSortBy: ["index", "timestamp", "actor", "action"] as const,
  });
  if (!parsed.ok) return parsed.response;
  const pagination = parsed.value;

  const { data, total } = await getAudit(
    tenantId,
    ticketId,
    listOptionsFromPagination<AuditRow>(pagination)
  );
  return paginated(data, total, pagination);
}
