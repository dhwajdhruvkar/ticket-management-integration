import { fail, paginated, parsePagination } from "@/server/http";
import { isResponse, requirePermission } from "@/server/guards";
import { isAgentRole } from "@/server/auth/rbac";
import { search, snippetFor } from "@/server/ai/vectorSearch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/v1/kb/search?q= — vector search over KB articles; returns ranked
// hits with score + snippet (the same retrieval the AI resolver uses).
export async function GET(req: Request) {
  const ctx = await requirePermission(req, "kb.read");
  if (isResponse(ctx)) return ctx;

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const legacyKRaw = url.searchParams.get("k");
  let defaultPageSize = 5;
  if (legacyKRaw !== null && url.searchParams.get("pageSize") === null && url.searchParams.get("limit") === null) {
    if (!/^[1-9]\d*$/.test(legacyKRaw) || Number(legacyKRaw) > 25) {
      return fail("k must be a positive integer no greater than 25.");
    }
    defaultPageSize = Number(legacyKRaw);
  }
  const parsed = parsePagination(req, {
    defaultSortBy: "score",
    defaultSortDir: "desc",
    allowedSortBy: ["score"] as const,
    allowedSortDirs: ["desc"] as const,
    defaultPageSize,
  });
  if (!parsed.ok) return parsed.response;
  const pagination = parsed.value;
  if (!q) {
    return paginated({ query: q, model: null, hits: [] }, 0, pagination);
  }

  const { hits, model, total } = await search(
    ctx.tenantId,
    q,
    pagination.skip + pagination.take,
    {
    publicOnly: !isAgentRole(ctx.role),
    }
  );
  return paginated(
    {
      query: q,
      model,
      hits: hits.slice(pagination.skip).map((h) => ({
        id: h.article.id,
        title: h.article.title,
        category: h.article.category,
        score: Number(h.score.toFixed(4)),
        snippet: snippetFor(h.article),
      })),
    },
    total,
    pagination
  );
}
