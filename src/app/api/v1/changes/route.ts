import {
  fail,
  listOptionsFromPagination,
  ok,
  paginated,
  parsePagination,
  readJson,
} from "@/server/http";
import { isResponse, requirePermission } from "@/server/guards";
import { createChange, listChanges, type NewChangeInput } from "@/server/services/changeService";
import type { ChangeRow } from "@/server/domain/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =============================================================================
// /api/v1/changes — change management (agent+).
//
// GET lists changes; POST creates one with an automatic AI risk assessment.
// =============================================================================

export async function GET(req: Request) {
  const ctx = await requirePermission(req, "change.read");
  if (isResponse(ctx)) return ctx;
  const parsed = parsePagination(req, {
    defaultSortBy: "createdAt",
    defaultSortDir: "desc",
    allowedSortBy: [
      "createdAt",
      "updatedAt",
      "reference",
      "title",
      "status",
      "riskScore",
    ] as const,
  });
  if (!parsed.ok) return parsed.response;
  const pagination = parsed.value;
  const result = await listChanges(
    ctx.tenantId,
    listOptionsFromPagination<ChangeRow>(pagination)
  );
  return paginated(result.data, result.total, pagination);
}

export async function POST(req: Request) {
  const ctx = await requirePermission(req, "change.write");
  if (isResponse(ctx)) return ctx;
  const body = await readJson<NewChangeInput>(req);
  if (!body?.title || !body?.description) return fail("title and description are required.");
  return ok(await createChange(ctx.tenantId, body), { status: 201 });
}
