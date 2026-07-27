import { fail, ok, readJson } from "@/server/http";
import { isResponse, requirePermission } from "@/server/guards";
import { isAgentRole } from "@/server/auth/rbac";
import { deleteArticle, getArticle, updateArticle, type NewArticleInput } from "@/server/services/kbService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =============================================================================
// /api/v1/kb/[id] — single article: GET, PATCH (re-embeds), DELETE.
// Writes are gated by kb.write (agent+).
// =============================================================================

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermission(req, "kb.read");
  if (isResponse(ctx)) return ctx;

  const article = await getArticle(id, ctx.tenantId);
  if (!article) return fail("Article not found.", 404);
  // Unpublished drafts are internal working copy; requesters only see what has
  // been published and explicitly marked public.
  if (!isAgentRole(ctx.role) && (article.status !== "published" || !article.isPublic)) {
    return fail("Article not found.", 404);
  }
  return ok(article);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermission(req, "kb.write");
  if (isResponse(ctx)) return ctx;
  const patch = await readJson<Partial<NewArticleInput>>(req);
  if (!patch) return fail("Invalid body.");
  const updated = await updateArticle(id, patch, ctx.tenantId);
  return updated ? ok(updated) : fail("Article not found.", 404);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermission(req, "kb.write");
  if (isResponse(ctx)) return ctx;
  const removed = await deleteArticle(id, ctx.tenantId);
  return removed ? ok({ id }) : fail("Article not found.", 404);
}
