import { fail, ok, readJson } from "@/server/http";
import { isResponse, requirePermission } from "@/server/guards";
import {
  getProblemView,
  ProblemStateError,
  updateProblem,
  type ProblemPatch,
} from "@/server/services/problemService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// /api/v1/problems/[id] — single problem: GET the full view, PATCH status/RCA/
// workaround/known-error fields (agent+).

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermission(req, "problem.read");
  if (isResponse(ctx)) return ctx;
  const view = await getProblemView(id, ctx.tenantId);
  return view ? ok(view) : fail("Problem not found.", 404);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermission(req, "problem.write");
  if (isResponse(ctx)) return ctx;
  const patch = await readJson<ProblemPatch>(req);
  if (!patch) return fail("Invalid body.");
  try {
    const updated = await updateProblem(id, patch, ctx.actor.name, ctx.tenantId);
    return updated ? ok(updated) : fail("Problem not found.", 404);
  } catch (err) {
    if (err instanceof ProblemStateError) return fail(err.message, 409);
    throw err;
  }
}
