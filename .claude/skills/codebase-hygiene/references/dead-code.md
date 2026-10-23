# Phase 1 — Dead Code

Goal: remove code that no real execution path reaches — unused exports, unreferenced functions/classes/vars, dead imports, unreachable branches.

## Detect

Run by the scan; outputs land in `.hygiene/<ts>/`:
- `js-knip.txt` / `js-knip.json` — unused files, exports, types, deps
- `js-orphans.txt` — modules nobody imports
- `py-ruff.txt` — F401 unused import, F811 redefinition, F841 unused local
- `py-vulture.txt` — dead functions/classes/methods/vars/unreachable

## Triage — the false-positive checklist

A symbol flagged "unused" is LIVE (do not remove) if any of these apply:

### Framework / runtime magic
- **Next.js file routing**: `app/**/page.tsx`, `layout.tsx`, `route.ts`, `loading.tsx`, `error.tsx`, `middleware.ts`, `pages/**`, `generateStaticParams`, `generateMetadata` — invoked by the framework, never imported. (knip's Next plugin handles most; verify.)
- **API/serverless handlers**: default exports in route files, lambda `handler`, FastAPI/Flask route functions registered via decorator.
- **Dynamic import / lazy**: `import(\`./\${name}\`)`, `React.lazy(() => import(...))`, `importlib.import_module(...)` — string-built paths defeat static analysis.
- **Dependency injection / decorators**: `@Injectable`, `@Component`, pytest fixtures, `@app.task` (Celery), `@router.get`, class registered in a container.
- **Reflection / registries**: `getattr(obj, name)`, plugin registries, `__subclasses__()`, enum lookups by string.
- **Re-exports / barrels**: `__init__.py` `__all__`, `index.ts` `export * from`. Removing the "unused" re-export can break a public path.
- **Entry points**: CLI `main`, `if __name__ == "__main__"`, `bin/`, `scripts` in package.json, `[project.scripts]` in pyproject.
- **Public API of a library/package**: if this repo is consumed by other repos, "no internal importer" ≠ unused. Check published surface.
- **Tests-only usage**: a helper used only by tests is still live unless the tests are also dead.
- **Type-only / ambient**: `.d.ts`, global augmentations, types referenced only in JSDoc.

### Confidence ladder (Python vulture)
- 90–100%: unused imports, unreachable code after `return` → safe.
- 80–90%: unused local vars, unused private methods → likely safe, eyeball.
- 60–80%: unused functions/classes → MUST verify against the magic list above.

## Remove (one logical group per commit)

1. Start with the safest tier: **unused imports** (ruff `--fix --select F401`, or knip-flagged imports). These almost never have false positives.
   ```bash
   ruff check --select F401,F811 --fix .   # Python: auto-removes unused imports
   ```
2. Then **unused local vars** (F841), **unreachable branches**.
3. Then **unused private/internal functions** that survived the checklist.
4. Last, **unused exports** — downgrade to non-exported first if you're unsure (`export function` → `function`); if then flagged unused locally too, remove. This two-step avoids breaking an unseen consumer.
5. Verify green (tsc/eslint/tests or ruff/mypy/pytest) after EACH group. Red → revert that group, mark false positive.

## Iterate

Removing dead code reveals more dead code (a function only called by a now-deleted function). Re-run the detector after each phase-1 commit until it reports zero new high-confidence findings (max ~3 passes; diminishing returns after).

## Output for the report
For each candidate: `file:line`, symbol, tool, confidence, verdict (remove / keep-reason). Group kept items by false-positive category so the user sees WHY each survivor stayed.
