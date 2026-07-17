import { currentActor } from "@/server/context";
import { fail, ok, readJson } from "@/server/http";
import { can } from "@/server/auth/rbac";
import { mergeTicket } from "@/server/services/agentActions";
import type { Role } from "@/server/domain/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/v1/tickets/:id/merge — merge THIS ticket (source) into a target.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await currentActor(req);
  if (!can(actor.role as Role, "ticket.write")) return fail("Forbidden.", 403);

  const body = await readJson<{ targetId: string }>(req);
  if (!body?.targetId) return fail("targetId is required.");
  if (body.targetId === id) return fail("A ticket cannot be merged into itself.");

  const updated = await mergeTicket(id, body.targetId, { name: actor.name, role: actor.role });
  return updated
    ? ok(updated)
    : fail("Merge failed — check both tickets exist and the source is not already merged.", 400);
}
