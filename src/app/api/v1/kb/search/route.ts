import { currentTenantId } from "@/server/context";
import { ok } from "@/server/http";
import { search, snippetFor } from "@/server/ai/vectorSearch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/v1/kb/search?q= — vector search over KB articles; returns ranked
// hits with score + snippet (the same retrieval the AI resolver uses).
export async function GET(req: Request) {
  const tenantId = await currentTenantId(req);
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const k = Number(url.searchParams.get("k") ?? 5);
  if (!q) return ok({ query: q, model: null, hits: [] });

  const { hits, model } = await search(tenantId, q, k);
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
