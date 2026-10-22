# Cleanup report (Phases 1–4: analysis and proposal only)

**Status: nothing has been deleted, moved, renamed, rewritten or installed.** This file is the only addition. Every item below needs your approval before Phase 6.

Repository: commit `c0d86aa`, Next.js 16.3.7 App Router, 235 tracked files in `src/`, 367 vendored files in `.agents/`. Analysis was run against a clean checkout of that commit.

## Verdict

**The structure is already good.** It follows App Router conventions, `src/` has **no orphan files** (every file is reachable from a page, layout, route, `proxy.ts`, `instrumentation.ts` or `auth.ts`, except one `.d.ts` that the compiler needs), there are no committed build artifacts, and `.gitignore` covers generated output. I recommend **no folder reorganisation**. The evidence supports a short list of small, behavior-preserving changes: about 300 lines of dead code, two unused dependencies, roughly 400 lines of duplicated helper and icon code, one misplaced data file, and some root-level clutter.

## How this was measured

| Step | Tool | Notes |
|---|---|---|
| Unused files, exports, types, dependencies | **Knip 6.42.1** (already installed in the sibling worktree `codebase-hygiene-setup-0a3b95`, same commit), run read-only with no config | Default run also scanned vendored `.agents/` (227 "unused" files, all vendored tooling), which is noise and was excluded from findings |
| Reachability | Own script over every `import`, `import()` and `require()` from the framework entry points, with and without tests | Catches files Knip counts as used because a test imports them |
| Exports | Own script: every Knip export searched by name across `src`, `tests`, `scripts`, `prisma` | Separates "dead" from "used only inside its own file" |
| Duplicates | Own 10-line normalised-window scan (jscpd was not installed, and the skill's `npx` step would download it) plus same-name function search | |
| CSS | Own scan of every class in `globals.css` against all `.ts`/`.tsx` | |
| References, history | `grep` for every script and root file; `git log` per file | |

Not done: the test suite, type-check, lint and build were **not run**. A green baseline is the first step of Phase 6. The skill's own scan script was not run because it calls `npx --yes` for depcheck, madge and jscpd, which downloads packages.

## Findings

Classes: **Safe** = safe candidate. **Confirm** = likely unnecessary, needs your confirmation. **Keep** = required by framework or project. **Unknown** = insufficient evidence.

### A. Dependencies

| # | Class | Item | Evidence | Risk | Action |
|---|---|---|---|---|---|
| A1 | **Safe** | devDependency `@vitejs/plugin-react` | Knip; `grep` finds it only in `package.json`. `vitest.config.ts` uses no plugin and tests are `.ts` | Very low | `npm uninstall` (needs approval; changes lockfile) |
| A2 | **Confirm** | dependency `@auth/core` | Knip; no import anywhere. `next-auth@5.0.0-beta.32` already depends on `@auth/core 0.41.3` (package-lock), so it installs regardless | Low: a direct pin might exist to force a version | Confirm with `npm ls @auth/core` that one copy results; then remove |
| A3 | **Keep** | `overrides.deepmerge-ts 8.0.0` | Intentional transitive pin | n/a | Leave |
| A4 | **Keep** | `dotenv`, `tsx`, `eslint-config-next`, `lucide-react`, `framer-motion`, `pdfkit`, `zod` | Used (Knip silent; `prisma.config.ts`, `db:seed`, eslint, UI, PDF route) | n/a | Leave |

### B. Dead code (exports and components with no use anywhere, tests included)

| # | Class | Path and symbol | Evidence | Lines |
|---|---|---|---|---|
| B1 | **Safe** | `src/components/ui.tsx`: `ConfidenceBar`, `StatCard`, `TrendChip`, `Sparkline`, `MeterBar`, `SectionHeader` | Declared once, referenced nowhere. `ProfileView.tsx` defines its **own** local `SectionHeader`, so the `ui.tsx` one is a dead near-duplicate. The file header comment (line 19) still mentions StatCard and ConfidenceBar | about 250 |
| B2 | **Safe** | `src/components/motion.tsx`: `fadeUp`, `scaleIn`, `listStagger`, `overlayFade`, `Reveal` | Only `motion`, `AnimatePresence`, `useReducedMotion`, `EASE_OUT` are imported (by `template.tsx`, `primitives.tsx`) | about 45 |
| B3 | **Safe** | `src/server/auth/rbac.ts`: `assertCan`, `ForbiddenError` | `assertCan` has no caller; `ForbiddenError` is used only by it | about 12 |
| B4 | **Safe** | `src/server/services/problemService.ts`: `getProblem`; the line `export { derivePriority }` | No importer; `derivePriority` is imported from `domain/priority` everywhere else | about 12 |
| B5 | **Safe** | `AppConfig` (`config.ts`), `HintKey` (`lib/hints.ts`) | Type declared once, never used | 2 |
| B6 | **Safe** | `.panel-flat` in `src/app/globals.css:317` | Only the definition exists; 74 of 75 classes are used. (The four `info-hint-*` classes look unused but are built dynamically in `InfoHint.tsx:187`: **Keep**) | 5 |

### C. Exports used only inside their own file (drop `export`, keep the code)

Low value; the `export` is harmless. **Confirm** whether you want these narrowed or left alone. I suggest leaving them unless you want a smaller public surface.

`createOrganization`, `OrganizationInput`, `OrganizationAdminInput`, `OrganizationDeletionSummary`, `assignableRoles`, `API_KEY_PREFIX`, `sanitizeFileName`, `DataDriver`, `EmailProvider`, `runAutomations`, `Condition`, `ConditionGroups`, `CAPACITY_STATUSES`, `AOAI_EMBED_MODEL`, `deliverWebhookDelivery`, `autoCloseStale`, `weeklyDigestSweep`, `monthlyReportSweep`, `ACK_LIFETIME_MS`, `Skel`, `canTransitionChange`, `LinkedIncident`, `PASSWORD_MIN_LENGTH`, `PASSWORD_MAX_LENGTH`, `DEFAULT_BRAND`, `renderTemplate`, `TEMPLATE_MODEL`, `EmailDirection`, `AgentStat`, `PrioritySlaStat`, `GroupBacklogStat`, `BucketConfig`, `SortDirection`, `PublicDemoTint`, `ToastVariant`.

Knip's other flags here are **false positives, Keep**: `signIn` and `signOut` (`src/auth.ts`, used by `SignInClient`, `Persona`, `ProfileView`), `DATABASE_ATTACHMENT_MAX_BYTES` (used by `databaseBlob.ts` and a build script), `UserAccessStatus`, `PageMeta`, `Persona` (used elsewhere, name collisions made Knip's cross-check unreliable), `buildJsonIdVerification` (a test imports it).

### D. Duplicate or near-duplicate implementations

| # | Class | What | Evidence | Proposed action | Risk |
|---|---|---|---|---|---|
| D1 | **Confirm** | About 25 SVG icon functions defined separately in several files (`ShieldIcon` ×4, `CheckIcon` ×4, `SearchIcon`, `PlusIcon`, `GaugeIcon`, `FolderIcon`, `ClockIcon`, `BoltIcon` ×3, and 15 more ×2). Same paths; only the shared `svg` props object differs per file (`s`, `svgProps`, `ic`) | Same-name function scan; `ShieldIcon` path identical in all four | One `src/components/icons.tsx` for icons defined in two or more files. Visual check needed because stroke width and size props differ | Low to medium: visual regressions |
| D2 | **Confirm** | `LegendDot`, `PanelHeader`, and ~12 icons identical between `src/app/page.tsx` (1,718 lines) and `src/app/analytics/page.tsx` (955); a ~100-line stacked-bar block is repeated in both | 10-line window scan: 38 shared windows, plus same-name functions | Move `LegendDot`, `PanelHeader` and the stacked bar into one shared file; fold icons in with D1 | Low to medium |
| D3 | **Safe** | `formatBytes` in `AttachmentPicker.tsx` and `AttachmentsPanel.tsx` | Identical output except `Math.round` vs `toFixed(0)` | Keep one, in `src/shared/attachments.ts` (already client-safe, holds attachment limits) | Very low |
| D4 | **Safe** | `initialsOf` in `Persona.tsx` and `triageService.ts` (identical); `SignInClient.tsx` has a slightly different one | | Share the identical pair. Leave the sign-in one unless you want identical behavior | Very low |
| D5 | **Confirm** | Graph client-credentials token request ×3 (`graphEmail.ts:41`, `notifier.ts:137`, `teamsPresence.ts:28`); client-IP from `x-forwarded-for` ×3 (`proxy.ts` twice, `rateLimit.ts`) | grep | One `graphToken()` and one `clientIp()` helper. Both touch security-relevant paths, so tests first | Medium |
| D6 | **Safe** | `sha256` helper in `auditChain.ts` and `idempotencyService.ts` | | Leave. Two five-line helpers do not justify a module | n/a |
| D7 | **Keep** | `src/shared/priority.ts` and `src/server/domain/priority.ts` | Not a duplicate: the server file re-exports the client-safe constants from `shared`, by design | Leave | n/a |
| D8 | **Unknown** | Near-duplicate code across `KBManager.tsx`, `TicketsExplorer.tsx` (1,889 lines), `portal/page.tsx` (1,391), `SettingsView.tsx` (2,656), `ProfileView.tsx` (1,675) | 10-line windows shared (37 KBManager↔TicketsExplorer, 24 portal↔KBManager, 17 portal↔TicketsExplorer), but these are inline-styled JSX blocks that I did not read closely | **Not proposed.** Extracting them is a refactor of the largest UI files, not cleanup. Needs a design decision and visual verification | n/a |

### E. Misplaced files and unnecessary layers

| # | Class | Item | Evidence | Proposed action | Risk |
|---|---|---|---|---|---|
| E1 | **Safe** | `src/lib/kbArticles.data.ts` (726 lines of seed content) | Imported only by `src/server/data/seed.ts`. `src/lib` is otherwise browser helpers | `git mv` to `src/server/data/kbArticles.data.ts`, fix the one import | Very low |
| E2 | **Confirm** | Root clutter: `comparison.html`, `gaps.html`, `overview.html`, `workflow-design.html`, `workflow-guide.html`, `workflow.html`, `EXPLANATION.md`, `instruction.md` (about 230 KB, 8 files in the repo root) | They link only to each other, to `.dockerignore` and a mention of `scripts/e2e-smoke.ps1`. Nothing in code, CI or `README.md` links them. Last touched July | **Option 1:** move all eight together to `docs/explainers/`, so their relative links keep working; update `.dockerignore` names. **Option 2:** leave. **Option 3:** delete (history keeps them). Your call, since they are your design notes | Low (docs only) |
| E3 | **Confirm** | `qa/` (`generate-test-plan.mjs` 64 KB, `Netlink-Support-Manual-Test-Plan.xlsx`, July) next to `docs/manual-testing/Netlink_ITSM_Master_Test_Record_Complete_v2.xlsx` (October) | The generator is referenced by nothing; the v2 record looks like its successor. Two locations for test plans | If v2 supersedes it, remove `qa/`; otherwise move it under `docs/manual-testing/` | Low |
| E4 | **Confirm** | `scripts/migrate-json-to-pg.ts` (one-off JSON-to-Postgres migration, August, one commit) | Referenced only by itself | Delete if the migration is done on every environment you care about | Low |
| E5 | **Keep** | `scripts/manual-verification/*.mjs`, `scripts/verify-workflow-postgres.ts`, `scripts/e2e-smoke.ps1`, `scripts/verify-production-schema.sql`, `scripts/build-json-id-verification.cjs` | Knip flags several as unused, but they are manual or live-environment tools (added with the October test record; one is cited by `docs/SERVICE_DESK_WORKFLOW.md`; one is imported by a test) | Leave; add a one-line `scripts/README` only if you want it | n/a |
| E6 | **Keep** | `tasks/` | Convention used by the vendored planning skills (`tasks/plan.md`, `todo.md`) | Leave | n/a |
| E7 | **Keep** | `.agents/` (367 files, about 11.6 MB), `agent-tools.lock.json`, `requirements-agent-tools.txt`, `scripts/{check-agent-tools,run-graphify,render-architecture}.cjs`, `docs/AGENT_TOOLING.md` | `AGENTS.md`, CI (`agent-tools:check`) and `tests/agentTooling.test.ts` require them; vendored content must not be edited | Leave. It is the largest single block in the repo, but it is deliberate | n/a |
| E8 | **Keep** | `src/shared/`, `src/server/domain/`, `src/server/data/` port and adapters, `src/types/next-auth.d.ts` | `shared` holds code both sides import; the DataStore port has two real adapters; the `.d.ts` is a type augmentation (the one "unreachable" file) | Leave | n/a |
| E9 | **Keep** | `src/proxy.ts`, `src/instrumentation.ts`, `src/app/template.tsx`, `prisma/`, `next.config.mjs`, `vercel.json`, `Dockerfile` | Framework entry points and configuration | Do not move | n/a |

### F. Build artifacts, generated files, clutter

- **Tracked cruft: none.** No `.next`, `.data`, `*.tsbuildinfo`, logs, `coverage`, `.DS_Store` or `node_modules` is tracked. `.gitignore` already covers them and the tool output folders (`.archify`, `graphify-out`, `.tools`).
- **Missing from `.gitignore`:** `.hygiene/` (written by the skill's scan script) and `.claude/` if you do not intend to commit skill folders. Suggest adding `.hygiene/`. **Confirm** the `.claude/` decision.
- **Two files I created in this session are untracked and should be a decision, not an accident:** `docs/architecture/` (the architecture audit). Its 12 generated HTML diagrams total about 9 MB. I suggest committing the markdown, the analysis JSON and the diagram specs, and either ignoring or deliberately committing the HTML. This report is also new.

### G. Found while analysing (defects, not cleanup)

| # | Class | Item | Evidence | Suggested action |
|---|---|---|---|---|
| G1 | **Confirm** | `Dockerfile` line 22 copies `/app/public`, but the repo has **no `public/` directory** (no tracked file) | `git ls-files public` is empty. A `COPY --from` of a missing path normally fails the image build; I did not run Docker | Remove the line, or add an empty `public/` with a `.gitkeep`. Not part of cleanup; flagged because it is a cheap fix |

## Current versus proposed tree

Only the differences are shown. Everything else stays as it is.

```
Current                                          Proposed (if all Confirm items accepted)
.                                                .
├─ comparison.html, gaps.html, overview.html,    ├─ docs/
│  workflow-design.html, workflow-guide.html,    │  ├─ explainers/            ← the 6 HTML files + EXPLANATION.md
│  workflow.html, EXPLANATION.md, instruction.md │  │                         + instruction.md (moved together)
├─ qa/                                           │  └─ manual-testing/        ← absorbs qa/ only if v2 does not supersede it
│  ├─ generate-test-plan.mjs                     │
│  └─ Netlink-Support-Manual-Test-Plan.xlsx      ├─ (qa/ removed if superseded)
├─ scripts/migrate-json-to-pg.ts                 ├─ (deleted if migration is finished)
├─ src/lib/kbArticles.data.ts                    ├─ src/server/data/kbArticles.data.ts   ← next to its only importer
├─ src/components/ui.tsx   (≈250 dead lines)     ├─ src/components/ui.tsx   (dead components removed)
├─ src/components/motion.tsx (dead variants)     ├─ src/components/motion.tsx (trimmed)
└─ (icons repeated in ~10 files)                 └─ src/components/icons.tsx             ← only the icons defined in 2+ files
```

Why each is worth doing: removals shrink what a reader must understand (B), the dependency removals shrink the install and audit surface (A), the one file move puts seed data beside its only consumer (E1), the root moves empty the repo root of eight unrelated files (E2), and the shared helpers mean "change once" for code that already exists twice (D). No new layer, service, provider or interface is proposed. `icons.tsx` is the only new file, and it replaces existing copies, not new abstraction.

**Deliberately not proposed:** moving to feature folders; splitting the 1,700–2,700-line components; touching the `src/server/services` layout (32 files, flat, coherent); renaming test files; changing routes, auth, database or business logic.

## Suggested execution (Phase 6, only after approval)

1. Use branch `claude/codebase-hygiene-setup-0a3b95`'s worktree (it has `node_modules` and Knip) on a new branch `chore/codebase-hygiene-<date>` cut from `c0d86aa`. Its two uncommitted changes (`knip` added to `package.json` and the lockfile, and the untracked skill folder) are yours; tell me whether the Knip devDependency should be part of the cleanup or stay separate.
2. Baseline: `npm run typecheck`, `npm run lint`, `npm test` (and `npm run build` if you want it; the skill's rule says not to when a dev server is running). Record results.
3. One commit per group, verifying after each: **(1)** dependencies A1 (and A2 if confirmed); **(2)** dead code B1–B5 and CSS B6; **(3)** file move E1; **(4)** small helpers D3, D4; **(5)** icon and dashboard consolidation D1, D2 with a visual check (needs a running dev server and a look at the dashboard and analytics pages); **(6)** D5 helpers after adding tests; **(7)** root and `qa/` moves E2, E3, E4; **(8)** `.gitignore` and Dockerfile G1.
4. Use `git mv` for moves, and use a backup-and-diff before any bulk delete, as the skill requires.
5. Final report: files and lines before and after, Knip before and after.

## Decisions I need from you

1. Approve **A1, B1–B6, E1, D3, D4** as is? (the safe group)
2. **A2** `@auth/core`: remove after `npm ls` confirms?
3. **C**: narrow the self-only exports, or leave them?
4. **D1/D2** icon and dashboard consolidation: do it, with a visual check from you?
5. **D5** Graph token and client-IP helpers: do it with tests, or leave for a security pass?
6. **E2** root explainers: move to `docs/explainers/`, leave, or delete?
7. **E3** `qa/`: does v2 in `docs/manual-testing/` replace it?
8. **E4** `migrate-json-to-pg.ts`: still needed?
9. **G1** Dockerfile `public/` line: fix in this change?
10. Add `.hygiene/` to `.gitignore`, and should `.claude/` be committed?
11. Keep or drop the `docs/architecture/` HTML diagrams from commits?
