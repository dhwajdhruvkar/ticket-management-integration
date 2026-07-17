import { currentActor, currentTenantId } from "@/server/context";
import { fail, ok } from "@/server/http";
import { can } from "@/server/auth/rbac";
import { getAudit, verifyChain } from "@/server/audit/auditChain";
import type { Role } from "@/server/domain/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =============================================================================
// GET /api/v1/audit — the tamper-evident audit trail (gated by audit.read).
//
// Returns the hash-chained records (optionally filtered to one ticket); with
// ?verify=1 it recomputes the chain and reports integrity + the first broken
// block, powering the "chain verified" badge.
// =============================================================================

export async function GET(req: Request) {
  const [tenantId, actor] = await Promise.all([currentTenantId(req), currentActor(req)]);
  if (!can(actor.role as Role, "audit.read")) return fail("Forbidden.", 403);
  const url = new URL(req.url);
  const ticketId = url.searchParams.get("ticketId") ?? undefined;

  if (url.searchParams.get("verify") === "1") {
    return ok(await verifyChain(tenantId));
  }
  return ok(await getAudit(tenantId, ticketId));
}
