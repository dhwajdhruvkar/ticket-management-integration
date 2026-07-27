// =============================================================================
// Vector search over the knowledge base.
//
// Embeds the query and ranks tenant articles by cosine similarity. Articles
// indexed with a different embedding model than the current one are lazily
// re-embedded (and persisted) so spaces never get mixed. When Postgres +
// pgvector is configured, prisma/sql/001_pgvector.sql provides an ANN index;
// this in-process path remains the portable fallback.
// =============================================================================

import { cosineSimilarity, embed } from "./embeddings";
import { getStore } from "../data";
import { articleEmbeddingText } from "../services/kbService";
import type { ArticleRow } from "../domain/models";

export interface SearchHit {
  article: ArticleRow;
  score: number;
}

export interface SearchResult {
  hits: SearchHit[];
  model: string;
}

export interface SearchOptions {
  /** Restrict to articles marked public, for requester-facing search. */
  publicOnly?: boolean;
}

export async function search(
  tenantId: string,
  query: string,
  k = 4,
  options: SearchOptions = {}
): Promise<SearchResult> {
  const store = await getStore();
  const { vector, model } = await embed(query);
  const articles = (await store.articles.list({ tenantId })).filter(
    (a) => a.status === "published" && (!options.publicOnly || a.isPublic)
  );
  if (articles.length === 0) return { hits: [], model };

  for (const a of articles) {
    if (a.embeddingModel !== model || a.embedding.length !== vector.length) {
      const { vector: v } = await embed(articleEmbeddingText(a));
      a.embedding = v;
      a.embeddingModel = model;
      await store.articles.update(a.id, { embedding: v, embeddingModel: model });
    }
  }

  const scored: SearchHit[] = articles.map((article) => ({
    article,
    score: cosineSimilarity(vector, article.embedding),
  }));
  scored.sort((a, b) => b.score - a.score);
  return { hits: scored.slice(0, k), model };
}

export function snippetFor(article: ArticleRow, maxLen = 240): string {
  const clean = article.content.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen).trimEnd()}…`;
}
