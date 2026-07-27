import { ok } from "@/server/http";
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
  const parsedK = Number(url.searchParams.get("k") ?? 5);
  const k = Number.isFinite(parsedK) ? Math.min(Math.max(Math.trunc(parsedK), 1), 25) : 5;
  if (!q) return ok({ query: q, model: null, hits: [] });

  const { hits, model } = await search(ctx.tenantId, q, k, {
    publicOnly: !isAgentRole(ctx.role),
  });
  return ok({
    query: q,
    model,
    hits: hits.map((h) => ({
      id: h.article.id,
      title: h.article.title,
      category: h.article.category,
      score: Number(h.score.toFixed(4)),
      snippet: snippetFor(h.article),
    })),
  });
}
