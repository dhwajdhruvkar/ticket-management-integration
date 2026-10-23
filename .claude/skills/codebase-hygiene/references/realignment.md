# Phase 4 — Realignment

Goal: regroup code so the folder structure mirrors the dependency graph — tightly-coupled things live together, by feature/domain not by file-type. This is the most invasive phase; do it last, on a clean post-cleanup tree.

Target structure (Sairam's CLAUDE.md convention):
```
/loan_processing     # group by feature/domain  ✅
/user_auth
/core                # shared cross-cutting logic
/platforms/{web,mobile,api}   # platform adapters
# AVOID: /utils with 50 unrelated files  ❌
```

## Detect coupling clusters

Use the dependency graph to find what belongs together:
- JS/TS: `npx --yes dependency-cruiser src --output-type json` or `npx --yes madge --json src`. Build adjacency; files that import each other heavily and are imported together = a cluster = a feature folder.
- Python: `pydeps pkg --show-deps` / parse imports.

Signals a file is mis-placed:
- It lives in `utils/`/`helpers/`/`common/` but only one feature imports it → move into that feature.
- A feature folder imports a sibling feature's internals heavily → either the boundary is wrong or it's actually one feature.
- Type-based folders (`/services`, `/models`, `/controllers`) where each feature's slice is scattered → consider feature-folding.

## Plan the moves (review with user BEFORE executing)

Produce a move map: `current/path.ts → feature/auth/path.ts`. Group by destination. Get explicit approval — restructuring is high-churn and reviewers feel it. Keep moves minimal and justified by the graph; don't reorganize for aesthetics alone.

## Execute (history-preserving)

For each move:
```bash
git mv <old> <new>          # ALWAYS git mv — preserves blame/history; never cp+rm
```
Then fix imports:
- **TS with path aliases** (`@/`): update `tsconfig.json` paths if a top-level dir moved; most relative imports break and must be rewritten. Let `tsc --noEmit` enumerate every broken import, fix each, re-run until clean.
- **TS relative imports**: a codemod or careful find-replace of the old specifier → new. `tsc --noEmit` is your verifier.
- **Python**: update `from x.y import z` paths; `ruff`/`mypy`/import errors at test-collection time enumerate breaks. Update `__init__.py` re-exports. Watch for string-based imports (`importlib`) — grep the old dotted path.

Batch moves by feature, one feature per commit:
```bash
refactor: move auth modules into feature/auth — matches dependency cluster
```

## Verify green after EACH feature move
`tsc --noEmit` / `mypy` catches broken imports; tests catch broken runtime wiring. Red → the move map missed a reference; fix the import or revert the move. Never `npm run build`.

## Guardrails
- Don't move across package/published-API boundaries without checking external consumers.
- Don't move test files away from the convention your runner expects (some configs glob specific dirs) — update the runner config in the same commit if you do.
- Update any path-sensitive config: `tsconfig` paths, `jest`/`vitest` roots, `pyproject` packages, import-linter contracts, CI globs, Dockerfile COPY paths.
- Optionally codify the new boundaries so they don't erode: `dependency-cruiser` rules (JS) or `import-linter` contracts (Python).

## Output for the report
Move map table: old path → new path · feature · #imports rewritten. Note any config files touched. Before→after: dependency-edge count, cross-feature import count (lower = better isolation = smaller blast radius).
