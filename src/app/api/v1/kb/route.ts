import { currentActor, currentTenantId } from "@/server/context";
import { fail, ok, readJson } from "@/server/http";
import { can } from "@/server/auth/rbac";
import { createArticle, listArticles, type NewArticleInput } from "@/server/services/kbService";
import type { ArticleRow, Role } from "@/server/domain/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =============================================================================
// /api/v1/kb — knowledge base articles.
//
// GET lists articles (public subset for requesters via ?public=1); POST creates
// an article, embedding it for vector retrieval (gated by kb.write).
// =============================================================================

export async function GET(req: Request) {
  const tenantId = await currentTenantId(req);
  const url = new URL(req.url);
  const where: Partial<ArticleRow> = {};
  const status = url.searchParams.get("status");
  if (status) where.status = status as ArticleRow["status"];
  if (url.searchParams.get("public") === "1") where.isPublic = true;
  return ok(await listArticles(tenantId, where));
}

export async function POST(req: Request) {
  const [tenantId, actor] = await Promise.all([currentTenantId(req), currentActor(req)]);
  if (!can(actor.role as Role, "kb.write")) return fail("Forbidden.", 403);
  const body = await readJson<NewArticleInput>(req);
  if (!body?.title || !body?.content) return fail("title and content are required.");
  const article = await createArticle(tenantId, body);
  return ok(article, { status: 201 });
}
