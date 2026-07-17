-- Production-scale vector search for the knowledge base.
--
-- Prisma stores embeddings as float8[] (KBArticle.embedding) so the client can
-- read/write them directly. This migration adds a real pgvector column kept in
-- sync from that array, plus an IVFFlat index for fast approximate kNN. The
-- vector-search adapter (src/server/ai/vectorSearch.ts) uses this when present
-- and otherwise falls back to in-process cosine similarity.
--
-- Apply after `prisma db push` / `prisma migrate`:
--   psql "$DATABASE_URL" -f prisma/sql/001_pgvector.sql

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "KBArticle"
  ADD COLUMN IF NOT EXISTS embedding_vec vector(384);

-- Backfill the typed vector column from the float array.
UPDATE "KBArticle"
  SET embedding_vec = embedding::vector
  WHERE embedding IS NOT NULL
    AND array_length(embedding, 1) = 384
    AND embedding_vec IS NULL;

-- Keep embedding_vec in sync on insert/update.
CREATE OR REPLACE FUNCTION sync_kbarticle_embedding_vec()
RETURNS trigger AS $$
BEGIN
  IF NEW.embedding IS NOT NULL AND array_length(NEW.embedding, 1) = 384 THEN
    NEW.embedding_vec := NEW.embedding::vector;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kbarticle_embedding_vec ON "KBArticle";
CREATE TRIGGER trg_kbarticle_embedding_vec
  BEFORE INSERT OR UPDATE OF embedding ON "KBArticle"
  FOR EACH ROW EXECUTE FUNCTION sync_kbarticle_embedding_vec();

-- Cosine-distance ANN index. Tune `lists` to ~sqrt(rows) at scale.
CREATE INDEX IF NOT EXISTS kbarticle_embedding_vec_idx
  ON "KBArticle" USING ivfflat (embedding_vec vector_cosine_ops)
  WITH (lists = 100);
