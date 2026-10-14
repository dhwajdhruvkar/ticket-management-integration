# Phase E1 — Attachment storage without Azure (database-backed) + schema (the ONLY migration in this plan)

Context: today production attachments are disabled unless `AZURE_STORAGE_CONNECTION_STRING` is set (`resolveAttachmentStorage` in `src/server/config.ts`).
There is no Azure, so add a Postgres-backed `BlobStore` selected by `ATTACHMENT_STORAGE=database`. Vercel functions accept request bodies of about 4.5 MB,
so database mode is capped at 4 MB per file. Neon's free tier has limited storage — document it. The `BlobStore` port (`src/server/storage/blobPort.ts`) stays
the swap point if a different provider is chosen later.

Do NOT run `prisma migrate` / `db push`. Only create the migration SQL file and run `npx prisma validate` and `npm run db:generate`.

## Files
1. `prisma/schema.prisma` — `model Attachment` (line ~770): add field and index; add `model AttachmentBlob` after it.
2. NEW `prisma/migrations/20261014090000_attachment_message_and_blob/migration.sql` (look at `prisma/migrations/20260930150000_service_desk_workflow/migration.sql` for style).
3. `scripts/verify-production-schema.sql` — lines ~16 and ~32 list expected tables (read the first ~60 lines, mirror how `'Attachment'` appears, add `'AttachmentBlob'`; if columns are listed, add `Attachment.messageId`). Then run `npx vitest run tests/productionMigrationVerification.test.ts` and fix the assertion style if it encodes the table list.
4. `src/server/domain/models.ts` — `AttachmentRow` (line ~467): add `messageId?: string | null;`.
5. `src/server/data/prismaStore.ts` — line 94: `export function prismaClient()` (add `export`, nothing else).
6. NEW `src/server/storage/databaseBlob.ts`.
7. `src/server/storage/blobStore.ts` — `getBlobStore()` (line ~70).
8. `src/server/config.ts` — `AttachmentStorageMode` (line 33), `resolveAttachmentStorage` (39-44), `attachmentMaxBytes` (line 95), `attachmentStorage` (line 119), `dataDriver` (find it; it exists because `features.postgres: dataDriver === "prisma"`).
9. `src/app/api/v1/openapi.json/route.ts` — line ~463 enum `["local","azure","disabled"]` → add `"database"`. (`src/app/api/v1/health/route.ts` just echoes the mode; no change.)
10. `scripts/check-production-environment.cjs` — `validateAzureStorage` (line ~135) and the final summary (line ~230).
11. `tests/productionEnvironment.test.ts` (lines ~60-90 show how `resolveAttachmentStorage` and the check script are tested).
12. `.env.example` (line ~125-135 storage section), `.env.production.example` (line ~37), `docs/SERVICE_DESK_WORKFLOW.md` (new short section "Attachments without Azure").
13. NEW `tests/databaseBlob.test.ts`.

## Steps
### Schema + migration
```prisma
model Attachment {  // existing fields …
  messageId String?
  // existing relation …
  @@index([ticketId])
  @@index([messageId])
}
model AttachmentBlob {
  id        String   @id
  data      Bytes
  createdAt DateTime @default(now())
}
```
Migration SQL:
```sql
-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN "messageId" TEXT;
-- CreateIndex
CREATE INDEX "Attachment_messageId_idx" ON "Attachment"("messageId");
-- CreateTable
CREATE TABLE "AttachmentBlob" (
    "id" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AttachmentBlob_pkey" PRIMARY KEY ("id")
);
```
The change is additive and nullable, so the old binary keeps working during rollout.

### Config
- `AttachmentStorageMode = "local" | "azure" | "database" | "disabled"`.
- `resolveAttachmentStorage(demoMode, blobConfigured, requested?: string, postgres = false)`: `blobConfigured → "azure"`; else `requested === "database" && postgres → "database"`; else `demoMode ? "local" : "disabled"`. Existing 2-argument callers/tests must keep their results.
- Read `const attachmentStorageRequested = val("ATTACHMENT_STORAGE");` and pass `(demoMode, !!blobConnString, attachmentStorageRequested, dataDriver === "prisma")`.
- `attachmentMaxBytes`: default `10 MB`, but when the mode is `database` the effective value is `Math.min(configured, 4 * 1024 * 1024)` and the default is 4 MB. (Compute mode before `attachmentMaxBytes` or clamp after both are known.)

### Store
`databaseBlob.ts`: `export class DatabaseBlobStore implements BlobStore` with constructor `(private readonly table = () => prismaClient().attachmentBlob)`.
`put(key, bytes)`: `validateBlobKey(key)`; `upsert({ where:{id:key}, create:{id:key,data:bytes}, update:{data:bytes} })`; return `` `db://${key}` ``.
`get(key)`: `findUnique`; return `Buffer.from(row.data)` or `null`. `delete(key)`: `deleteMany({ where:{id:key} })` → `count > 0`.
In `getBlobStore()` add: `if (!instance && config.attachmentStorage === "database") { instance = new DatabaseBlobStore(); logger.info("attachments storage: database"); }` (place before the `local` branch; keep Azure first).

### Env check script
- If `ATTACHMENT_STORAGE` is set and is not `database` → error "ATTACHMENT_STORAGE must be 'database' when provided."
- If it is `database` and `ATTACHMENT_MAX_BYTES` is set above `4194304` → error (database storage is capped at 4 MB on Vercel).
- If it is `database` and `DATA_DRIVER`/`DATABASE_URL` indicate no Postgres, error (find how other validators detect Postgres in this script; reuse).
- Summary prints `attachments=azure` if Azure set, else `database` if requested, else `disabled`.

### Env examples + docs
`ATTACHMENT_STORAGE=database` and `ATTACHMENT_MAX_BYTES=4194304` with a comment: stored in Postgres, 4 MB cap, watch Neon storage quota, no virus scanning (documented seam in `attachmentService.ts`), run the migration before deploying.

## Tests
- `tests/databaseBlob.test.ts` with a fake `table` object (Map-backed `upsert/findUnique/deleteMany`): put/get round trip returns identical bytes, missing key → null, delete true then false, invalid key throws.
- Extend `tests/productionEnvironment.test.ts`: `resolveAttachmentStorage(false,false,"database",true) === "database"`; `(false,false,"database",false) === "disabled"`; azure still wins; check-script cases for invalid value and oversize limit.
- `npx vitest run tests/databaseBlob.test.ts tests/productionEnvironment.test.ts tests/productionMigrationVerification.test.ts tests/attachments.test.ts tests/openapi.test.ts`.

## Done when
Those tests, `npx prisma validate`, `npm run db:generate`, `npm run typecheck`, `npm run lint` pass. In the final answer remind the owner: apply the migration to an isolated Neon branch first, then production, before deploying (see `docs/SERVICE_DESK_WORKFLOW.md` rollout), and set `ATTACHMENT_STORAGE=database` in Vercel.
