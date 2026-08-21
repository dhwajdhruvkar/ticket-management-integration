// =============================================================================
// Knowledge base service (server-side).
//
// Articles are embedded on write (Azure OpenAI or hashed fallback) so the
// vector search has nothing to do at query time. Supports the draft -> review
// -> published lifecycle and tenant scoping.
// =============================================================================

import { appendAudit } from "../audit/auditChain";
import { embed } from "../ai/embeddings";
import { getStore } from "../data";
import { pageCollection, type ListOptions, type PageResult } from "../data/store";
import { newId, now } from "../domain/ids";
import type { ArticleRow, ArticleStatus, TicketCategory } from "../domain/models";

export interface NewArticleInput {
  title: string;
  content: string;
  category: TicketCategory;
  tags?: string[];
  status?: ArticleStatus;
  isPublic?: boolean;
  authorId?: string;
}

export function articleEmbeddingText(a: { title: string; content: string; tags: string[] }): string {
  return `${a.title}. ${a.tags.join(" ")}. ${a.content}`;
}

export async function listArticles(
  tenantId: string,
  where: Partial<ArticleRow> = {},
  options: ListOptions<ArticleRow> = { orderBy: { field: "title", dir: "asc" } }
): Promise<PageResult<ArticleRow>> {
  const store = await getStore();
  return pageCollection(store.articles, { tenantId, ...where }, options);
}

export async function getArticle(id: string, tenantId?: string): Promise<ArticleRow | null> {
  const store = await getStore();
  const article = await store.articles.get(id);
  if (!article) return null;
  if (tenantId && article.tenantId !== tenantId) return null;
  return article;
}

export async function createArticle(tenantId: string, input: NewArticleInput): Promise<ArticleRow> {
  const store = await getStore();
  const tags = input.tags ?? [];
  const { vector, model } = await embed(
    articleEmbeddingText({ title: input.title, content: input.content, tags })
  );
  const article: ArticleRow = {
    id: newId("kb"),
    tenantId,
    title: input.title.trim(),
    content: input.content.trim(),
    category: input.category,
    tags,
    status: input.status ?? "published",
    version: 1,
    authorId: input.authorId ?? null,
    isPublic: input.isPublic ?? false,
    embedding: vector,
    embeddingModel: model,
    createdAt: now(),
    updatedAt: now(),
  };
  await store.articles.create(article);
  await appendAudit({
    tenantId,
    actor: "system",
    action: "kb.article.created",
    payload: { articleId: article.id, title: article.title, category: article.category },
  });
  return article;
}

export async function updateArticle(
  id: string,
  patch: Partial<NewArticleInput>,
  tenantId?: string
): Promise<ArticleRow | null> {
  const store = await getStore();
  const existing = await store.articles.get(id);
  if (!existing) return null;
  if (tenantId && existing.tenantId !== tenantId) return null;

  const title = patch.title ?? existing.title;
  const content = patch.content ?? existing.content;
  const tags = patch.tags ?? existing.tags;
  const { vector, model } = await embed(articleEmbeddingText({ title, content, tags }));

  const updated = await store.articles.update(id, {
    title,
    content,
    tags,
    category: patch.category ?? existing.category,
    status: patch.status ?? existing.status,
    isPublic: patch.isPublic ?? existing.isPublic,
    embedding: vector,
    embeddingModel: model,
    version: existing.version + 1,
    updatedAt: now(),
  });
  await appendAudit({
    tenantId: existing.tenantId,
    actor: "system",
    action: "kb.article.updated",
    payload: { articleId: id, version: (updated?.version ?? existing.version) },
  });
  return updated;
}

export async function deleteArticle(id: string, tenantId?: string): Promise<boolean> {
  const store = await getStore();
  const existing = await store.articles.get(id);
  if (!existing) return false;
  if (tenantId && existing.tenantId !== tenantId) return false;
  await store.articles.remove(id);
  await appendAudit({
    tenantId: existing.tenantId,
    actor: "system",
    action: "kb.article.deleted",
    payload: { articleId: id, title: existing.title },
  });
  return true;
}
