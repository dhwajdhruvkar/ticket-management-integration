// =============================================================================
// Server-side embeddings.
//
// Primary: Azure OpenAI embeddings (dimensions pinned to 384 so they fit the
// pgvector(384) column and stay comparable to the fallback). Fallback: the
// deterministic hashed bag-of-words embedder (no infra, no network) — the same
// approach the browser build uses, ported to the server. `embed()` reports the
// model so the vector store never mixes incompatible spaces.
// =============================================================================

import { config } from "../config";
import { logger } from "../observability/logger";

export const EMBEDDING_DIM = 384;
export const BOW_MODEL = "helpdesk-hashed-bow-384";
export const AOAI_EMBED_MODEL = `azure:${config.azureOpenAI.embeddingDeployment}`;

export interface EmbedResult {
  vector: number[];
  model: string;
}

export async function embed(text: string): Promise<EmbedResult> {
  if (config.features.azureOpenAI) {
    try {
      const vector = await azureEmbed(text);
      return { vector, model: AOAI_EMBED_MODEL };
    } catch (err) {
      logger.error("Azure OpenAI embeddings failed; using hashed fallback", {
        error: err,
      });
    }
  }
  return { vector: bowEmbed(text), model: BOW_MODEL };
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return Math.max(-1, Math.min(1, dot));
}

// ---------------------------------------------------------------------------
// Azure OpenAI
// ---------------------------------------------------------------------------

async function azureEmbed(text: string): Promise<number[]> {
  const { endpoint, apiKey, embeddingDeployment, apiVersion } = config.azureOpenAI;
  const url = `${endpoint}/openai/deployments/${embeddingDeployment}/embeddings?api-version=${apiVersion}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": apiKey ?? "" },
    body: JSON.stringify({ input: text, dimensions: EMBEDDING_DIM }),
  });
  if (!res.ok) throw new Error(`Azure OpenAI embeddings ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data?: { embedding?: number[] }[] };
  const vector = json.data?.[0]?.embedding;
  if (!vector || vector.length === 0) throw new Error("Empty embedding response");
  return l2normalize(vector);
}

// ---------------------------------------------------------------------------
// Deterministic hashed bag-of-words fallback (ported from the browser build)
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "is", "are", "was",
  "were", "be", "been", "to", "of", "in", "on", "for", "with", "at", "by",
  "from", "as", "it", "this", "that", "these", "those", "i", "you", "we",
  "my", "our", "your", "me", "do", "does", "did", "can", "cannot", "cant",
  "how", "what", "when", "where", "why", "which", "please", "help", "need",
  "would", "could", "should", "have", "has", "had", "not", "no", "yes",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function stem(token: string): string {
  if (token.length <= 4) return token;
  return token.replace(/(ing|ed|ies|es|s)$/u, "");
}

function l2normalize(vec: number[]): number[] {
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}

export function bowEmbed(text: string): number[] {
  const tokens = tokenize(text);
  const counts = new Map<string, number>();
  for (const raw of tokens) {
    const t = stem(raw);
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const vec = new Array<number>(EMBEDDING_DIM).fill(0);
  for (const [token, count] of counts) {
    const h = fnv1a(token);
    const dimA = h % EMBEDDING_DIM;
    const dimB = (h >>> 7) % EMBEDDING_DIM;
    const weight = 1 + Math.log(count);
    vec[dimA] += weight;
    vec[dimB] += weight * 0.5;
  }
  return l2normalize(vec);
}
