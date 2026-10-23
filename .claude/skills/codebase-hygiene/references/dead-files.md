# Phase 2 — Dead Files

Goal: remove files that contribute nothing — orphaned modules, tests for code that no longer exists, committed build/cache artifacts, stale test results, dead snapshots.

## Categories (each handled differently)

### A. Orphan modules (code files nobody imports)
- JS/TS: `js-orphans.txt` (madge) + knip "unused files".
- Python: a `.py` not imported anywhere and not an entry point.
- **False positives** = same magic list as dead-code (entry points, dynamic import, framework-discovered files, conftest.py, migrations). Verify before delete.
- Delete with `git rm` (tracked) so it stays in history.

### B. Stale tests (tests for deleted source)
A test file is stale when the module it tests no longer exists.
- Map test→source by convention: `foo.test.ts`↔`foo.ts`, `test_foo.py`↔`foo.py`, `__tests__/Foo.tsx`↔`Foo.tsx`, `tests/test_bar.py`↔`src/bar.py`.
- For each test file, check whether its subject still exists and whether the test still references live symbols. If the subject is gone AND the test imports nothing live → stale.
- ⚠️ Integration/e2e tests often don't map 1:1 to a module — do NOT auto-flag. Only flag unit tests with a clearly-deleted subject. When unsure, keep.

### C. Build / cache artifacts (should never be committed)
Patterns: `__pycache__/`, `*.pyc`, `.pytest_cache/`, `.mypy_cache/`, `.ruff_cache/`, `.next/`, `dist/`, `build/`, `out/`, `*.tsbuildinfo`, `.turbo/`, `coverage/`, `.coverage`, `coverage.xml`, `htmlcov/`, `.DS_Store`, `*.log`, `node_modules/` (never commit).
- **If tracked in git** (see `tracked-cruft.txt`): two-step — add to `.gitignore`, then `git rm -r --cached <path>` to untrack without deleting your local working copy needlessly, OR `git rm -r <path>` to remove entirely. Commit as `chore: stop tracking build artifacts, add to .gitignore`.
- **If untracked**: safe to `rm -rf` (they regenerate). These don't even need the backup step — they're reproducible. But never delete `node_modules`/`.venv` as part of "cleanup" unless asked.

### D. Stale test results / reports
`test-results/`, `playwright-report/`, `allure-results/`, `.nyc_output/`, `cypress/screenshots`, `cypress/videos`, JUnit `*.xml` outputs. Almost always should be gitignored, not committed. Same two-step as C.

### E. Dead snapshots (Jest/Vitest)
`__snapshots__/*.snap` for components/tests that were deleted. Detect: a `.snap` whose matching test file is gone. `git rm` it.

## Procedure

1. Read `.hygiene/<ts>/dead-files-candidates.txt` (untracked cruft) and `tracked-cruft.txt` (committed cruft).
2. Classify each into A–E above.
3. **Artifacts/results/caches (C, D)**: fix `.gitignore` + untrack/delete. Low risk, but still confirm the list with the user.
4. **Orphans/stale tests/dead snapshots (A, B, E)**: run the false-positive checklist, then for bulk delete follow the backup→verify→delete sequence in `references/safety.md`.
5. Verify green after deletion. A test suite that was importing a "stale" test helper will go red → that file wasn't stale; revert.

## .gitignore hygiene
While here, ensure `.gitignore` covers the artifact patterns so they don't return. Append a clearly-commented block:
```
# --- build/cache/test artifacts (codebase-hygiene) ---
__pycache__/
*.pyc
.pytest_cache/
.mypy_cache/
.ruff_cache/
.next/
dist/
build/
coverage/
.coverage
htmlcov/
*.tsbuildinfo
.DS_Store
test-results/
playwright-report/
.hygiene/
```

## Output for the report
Table: path · category (A–E) · tracked? · action (gitignore+untrack / delete / keep-reason) · size. Sum reclaimed bytes + file count for the before→after metrics.
