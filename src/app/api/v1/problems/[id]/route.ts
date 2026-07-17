import { currentActor } from "@/server/context";
import { fail, ok, readJson } from "@/server/http";
import { can } from "@/server/auth/rbac";
import { getProblemView, updateProblem, type ProblemPatch } from "@/server/services/problemService";
import type { Role } from "@/server/domain/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// /api/v1/problems/[id] — single problem: GET the full view, PATCH status/RCA/
// workaround/known-error fields (agent+).

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const view = await getProblemView(id);
  return view ? ok(view) : fail("Problem not found.", 404);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await currentActor(req);
  if (!can(actor.role as Role, "problem.write")) return fail("Forbidden.", 403);
  const patch = await readJson<ProblemPatch>(req);
  if (!patch) return fail("Invalid body.");
  const updated = await updateProblem(id, patch, actor.name);
  return updated ? ok(updated) : fail("Problem not found.", 404);
}
