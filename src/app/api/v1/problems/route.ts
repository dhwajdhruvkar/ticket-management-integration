import { fail, ok, readJson } from "@/server/http";
import { isResponse, requirePermission } from "@/server/guards";
// =============================================================================
// /api/v1/problems — problem management (agent+, gated by problem.write).
//
// GET lists problems, or returns metrics (?metrics=1) / AI-suggested incident
// clusters (?suggest=1). POST creates a problem, either from scratch or from a
// suggested cluster of recurring incidents.
// =============================================================================
import {
  createFromCluster,
  createProblem,
  listProblems,
  problemMetrics,
  suggestClusters,
  type NewProblemInput,
} from "@/server/services/problemService";
import type { ProblemStatus } from "@/server/domain/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ctx = await requirePermission(req, "problem.read");
  if (isResponse(ctx)) return ctx;
  const { tenantId } = ctx;
  const url = new URL(req.url);
  if (url.searchParams.get("suggest") === "1") return ok(await suggestClusters(tenantId));
  if (url.searchParams.get("metrics") === "1") return ok(await problemMetrics(tenantId));

  const filter: { status?: ProblemStatus; knownError?: boolean } = {};
  const status = url.searchParams.get("status");
  if (status) filter.status = status as ProblemStatus;
  if (url.searchParams.get("knownErrors") === "1") filter.knownError = true;
  return ok(await listProblems(tenantId, filter));
}

export async function POST(req: Request) {
  const ctx = await requirePermission(req, "problem.write");
  if (isResponse(ctx)) return ctx;
  const { tenantId, actor } = ctx;

  const body = await readJson<NewProblemInput & { cluster?: { theme: string; ticketIds: string[] } }>(req);
  if (body?.cluster) {
    return ok(await createFromCluster(tenantId, body.cluster, actor.name), { status: 201 });
  }
  if (!body?.title || !body?.description) return fail("title and description are required.");
  return ok(await createProblem(tenantId, body, actor.name), { status: 201 });
}
