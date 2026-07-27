import { fail, ok, readJson } from "@/server/http";
import { isResponse, requirePermission } from "@/server/guards";
import { isAgentRole } from "@/server/auth/rbac";
import { createArticle, listArticles, type NewArticleInput } from "@/server/services/kbService";
import type { ArticleRow } from "@/server/domain/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =============================================================================
// /api/v1/kb — knowledge base articles.
//
// GET lists articles (public subset for requesters via ?public=1); POST creates
// an article, embedding it for vector retrieval (gated by kb.write).
// =============================================================================

export async function GET(req: Request) {
  const ctx = await requirePermission(req, "kb.read");
  if (isResponse(ctx)) return ctx;

  const url = new URL(req.url);
  const where: Partial<ArticleRow> = {};
  const status = url.searchParams.get("status");
  if (status) where.status = status as ArticleRow["status"];
  if (url.searchParams.get("public") === "1") where.isPublic = true;

  // Requesters get the published, public subset regardless of what they asked
  // for: drafts and internal runbooks are not theirs to read.
  if (!isAgentRole(ctx.role)) {
    where.status = "published";
    where.isPublic = true;
  }
  return ok(await listArticles(ctx.tenantId, where));
}

export async function POST(req: Request) {
  const ctx = await requirePermission(req, "kb.write");
  if (isResponse(ctx)) return ctx;
  const body = await readJson<NewArticleInput>(req);
  if (!body?.title || !body?.content) return fail("title and content are required.");
  const article = await createArticle(ctx.tenantId, body);
  return ok(article, { status: 201 });
}
