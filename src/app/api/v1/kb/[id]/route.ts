import { currentActor } from "@/server/context";
import { fail, ok, readJson } from "@/server/http";
import { can } from "@/server/auth/rbac";
import { deleteArticle, getArticle, updateArticle, type NewArticleInput } from "@/server/services/kbService";
import type { Role } from "@/server/domain/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =============================================================================
// /api/v1/kb/[id] — single article: GET, PATCH (re-embeds), DELETE.
// Writes are gated by kb.write (agent+).
// =============================================================================

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const article = await getArticle(id);
  return article ? ok(article) : fail("Article not found.", 404);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await currentActor(req);
  if (!can(actor.role as Role, "kb.write")) return fail("Forbidden.", 403);
  const patch = await readJson<Partial<NewArticleInput>>(req);
  if (!patch) return fail("Invalid body.");
  const updated = await updateArticle(id, patch);
  return updated ? ok(updated) : fail("Article not found.", 404);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await currentActor(req);
  if (!can(actor.role as Role, "kb.write")) return fail("Forbidden.", 403);
  const removed = await deleteArticle(id);
  return removed ? ok({ id }) : fail("Article not found.", 404);
}
