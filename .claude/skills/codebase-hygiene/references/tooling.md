# Tooling Reference

Install commands and exact invocations per language. JS tools run via `npx --yes` (no global install, always latest). Python tools install into the project's venv/poetry.

## JavaScript / TypeScript / Next.js

| Tool | Finds | Install | Run |
|------|-------|---------|-----|
| **knip** | unused files, deps, exports, types, enum members, class members, duplicate exports | `npx --yes knip` | `npx --yes knip --reporter json > out.json` |
| **depcheck** | unused + missing npm dependencies | `npx --yes depcheck` | `npx --yes depcheck --json` |
| **ts-prune** | unused TS exports (superseded by knip; use if knip can't configure) | `npx --yes ts-prune` | `npx --yes ts-prune` |
| **madge** | orphan modules, circular deps, dep graph | `npx --yes madge` | `npx --yes madge --orphans --circular --extensions ts,tsx,js,jsx src` |
| **dependency-cruiser** | architecture rules, dep graph (DOT/JSON) | `npx --yes depcruise` | `npx --yes depcruise src --output-type json` |
| **jscpd** | copy-paste duplication (language-agnostic) | `npx --yes jscpd` | `npx --yes jscpd src --reporters json,html --output .hygiene/jscpd` |

### knip notes (the workhorse)
- Zero-config works for many setups; for Next.js / monorepos add `knip.json`:
  ```json
  { "entry": ["next.config.*","app/**/{page,layout,loading,error,route}.{ts,tsx}","pages/**/*.{ts,tsx}","src/**/*.{ts,tsx}!"], "project": ["src/**/*.{ts,tsx}"] }
  ```
- knip understands Next.js, Vite, Vitest, Jest, Storybook plugins → far fewer false positives than ts-prune.
- `npx knip --include files` → only unused files. `--include exports` → only unused exports. `--production` → ignore devDeps/test-only.

### Verify (NEVER `npm run build` — dev server running)
```bash
npx tsc --noEmit            # type errors = you broke a reference
npx eslint . --max-warnings=0
<test cmd>                  # vitest run / jest / npm test
npx next lint               # Next.js projects
```

## Python

| Tool | Finds | Install | Run |
|------|-------|---------|-----|
| **vulture** | dead functions, classes, methods, vars, unreachable code | `pip install vulture` | `vulture . --min-confidence 80` |
| **ruff** | unused imports (F401), redefinition (F811), unused local (F841), + more | `pip install ruff` | `ruff check --select F401,F811,F841 .` |
| **deadcode** | unused code (vulture alternative, can auto-fix) | `pip install deadcode` | `deadcode .` |
| **pydeps** | import dependency graph | `pip install pydeps` | `pydeps pkg --max-bacon=2 --noshow -o graph.svg` |
| **coverage** | never-executed lines (run with test suite) | `pip install coverage` | `coverage run -m pytest && coverage report --show-missing` |

If Poetry: prefix with `poetry run` and install with `poetry add --group dev vulture ruff deadcode`.

### vulture notes
- `--min-confidence 80` cuts most false positives; start at 90 for a conservative pass, lower to 60 to be aggressive (more noise).
- Generate a whitelist for intentional "unused" (framework hooks, `__all__` exports): `vulture . --make-whitelist > whitelist.py`, then `vulture . whitelist.py`.

### Verify
```bash
ruff check .
mypy .                     # type errors = broke a reference
pytest -q
```

## Duplication (both stacks): jscpd

```bash
npx --yes jscpd <path> \
  --min-lines 5 --min-tokens 50 \
  --reporters json,html \
  --output .hygiene/jscpd \
  --ignore "**/node_modules/**,**/.next/**,**/dist/**,**/.venv/**,**/__pycache__/**,**/*.lock"
```
- Reads `.hygiene/jscpd/jscpd-report.json` → `duplicates[]` with file pairs, line ranges, fragment.
- `--min-tokens` ↑ = only larger clones (less noise). 50 is a good DRY signal; 70+ for high-confidence only.

## Mixed repos
Run both stacks. The scan script auto-detects and does this. jscpd covers both at once.

## When a tool isn't installed
- JS: nothing to install — `npx --yes` fetches on demand.
- Python: run `scripts/install_tools.sh` or `poetry add --group dev vulture ruff deadcode pydeps`. If neither pip nor poetry is available, report it and fall back to `ruff` only (often already present).
