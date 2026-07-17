import { currentActor, currentTenantId } from "@/server/context";
import { fail, ok, readJson } from "@/server/http";
import { can } from "@/server/auth/rbac";
import { createGroup, listGroups } from "@/server/services/groupService";
import type { Role, TicketCategory } from "@/server/domain/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =============================================================================
// /api/v1/groups — assignment groups (support teams / queues).
//
// GET lists groups; POST creates one (admin). Groups own categories for auto-
// routing and an assignment strategy; membership/strategy edits are on [id].
// =============================================================================

export async function GET(req: Request) {
  const tenantId = await currentTenantId(req);
  return ok(await listGroups(tenantId));
}

interface NewGroupBody {
  name: string;
  description?: string;
  memberIds?: string[];
  categories?: TicketCategory[];
  leadId?: string;
}

export async function POST(req: Request) {
  const [tenantId, actor] = await Promise.all([currentTenantId(req), currentActor(req)]);
  if (!can(actor.role as Role, "admin")) return fail("Forbidden.", 403);

  const body = await readJson<NewGroupBody>(req);
  if (!body?.name?.trim()) return fail("name is required.");
  return ok(await createGroup(tenantId, body, actor.name), { status: 201 });
}
