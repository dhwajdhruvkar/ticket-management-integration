import { fail, ok, readJson } from "@/server/http";
import { isResponse, loadTicket, requirePermission } from "@/server/guards";
import { mergeTicket } from "@/server/services/agentActions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/v1/tickets/:id/merge — merge THIS ticket (source) into a target.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermission(req, "ticket.write");
  if (isResponse(ctx)) return ctx;

  const body = await readJson<{ targetId: string }>(req);
  if (!body?.targetId) return fail("targetId is required.");
  if (body.targetId === id) return fail("A ticket cannot be merged into itself.");

  // Merging moves the conversation across, so both ends must be ours.
  const source = await loadTicket(ctx, id);
  if (isResponse(source)) return source;
  const target = await loadTicket(ctx, body.targetId);
  if (isResponse(target)) return target;

  const { actor } = ctx;
  const updated = await mergeTicket(id, body.targetId, { name: actor.name, role: actor.role });
  return updated
    ? ok(updated)
    : fail("Merge failed — check both tickets exist and the source is not already merged.", 400);
}
