#!/usr/bin/env bash
# Read-only detection orchestrator for the codebase-hygiene skill.
# Detects stack, runs phase 1-3 detectors, writes raw findings to .hygiene/<timestamp>/.
# NEVER modifies, deletes, or moves source. Safe to run anytime.
# Usage: hygiene_scan.sh [project-root]
set -uo pipefail   # NOT -e: continue past individual tool failures

ROOT="${1:-.}"
ROOT="$(cd "$ROOT" && pwd)"
TS="$(date +%Y%m%d-%H%M%S)"
OUT="$ROOT/.hygiene/$TS"
mkdir -p "$OUT"

IGNORE_GLOB="**/node_modules/**,**/.next/**,**/dist/**,**/build/**,**/.venv/**,**/venv/**,**/__pycache__/**,**/.git/**,**/*.lock,**/.hygiene/**"
FIND_PRUNE=( -path '*/node_modules/*' -o -path '*/.git/*' -o -path '*/.venv/*' -o -path '*/.next/*' -o -path '*/dist/*' )

echo "==> codebase-hygiene scan"
echo "    root:   $ROOT"
echo "    output: $OUT"
echo

HAS_JS=0; HAS_PY=0
[ -f "$ROOT/package.json" ] && HAS_JS=1
if [ -f "$ROOT/pyproject.toml" ] || [ -f "$ROOT/setup.py" ] || [ -f "$ROOT/requirements.txt" ] \
   || find "$ROOT" -name '*.py' \( "${FIND_PRUNE[@]}" \) -prune -o -name '*.py' -print -quit 2>/dev/null | grep -q .; then
  HAS_PY=1
fi
echo "    stack:  JS/TS=$HAS_JS  Python=$HAS_PY"
echo

run() { echo "    -> $1"; shift; "$@"; }

# pick source dir for graph tools
SRC="$ROOT/src"; [ -d "$SRC" ] || SRC="$ROOT"

# ---------- PHASE 1+2: JS/TS ----------
if [ "$HAS_JS" = "1" ]; then
  echo "[js] knip (unused files/exports/deps)"
  ( cd "$ROOT" && npx --yes knip --no-progress )            > "$OUT/js-knip.txt"      2>&1 || true
  ( cd "$ROOT" && npx --yes knip --no-progress --reporter json ) > "$OUT/js-knip.json" 2>&1 || true
  echo "[js] depcheck (unused/missing deps)"
  ( cd "$ROOT" && npx --yes depcheck --json )               > "$OUT/js-depcheck.json" 2>&1 || true
  echo "[js] madge (orphans + circular)"
  ( cd "$ROOT" && npx --yes madge --orphans --extensions ts,tsx,js,jsx "$SRC" ) > "$OUT/js-orphans.txt"  2>&1 || true
  ( cd "$ROOT" && npx --yes madge --circular --extensions ts,tsx,js,jsx "$SRC" ) > "$OUT/js-circular.txt" 2>&1 || true
fi

# ---------- PHASE 1: Python ----------
if [ "$HAS_PY" = "1" ]; then
  PYRUN=()
  if command -v poetry >/dev/null 2>&1 && [ -f "$ROOT/pyproject.toml" ]; then PYRUN=(poetry run); fi
  echo "[py] ruff (F401 unused import / F811 redefinition / F841 unused local)"
  ( cd "$ROOT" && "${PYRUN[@]}" ruff check --select F401,F811,F841 --output-format concise . ) > "$OUT/py-ruff.txt" 2>&1 \
    || command -v ruff >/dev/null && ( cd "$ROOT" && ruff check --select F401,F811,F841 --output-format concise . ) > "$OUT/py-ruff.txt" 2>&1 || true
  echo "[py] vulture (dead code, min-confidence 80)"
  ( cd "$ROOT" && "${PYRUN[@]}" vulture . --min-confidence 80 ) > "$OUT/py-vulture.txt" 2>&1 \
    || command -v vulture >/dev/null && ( cd "$ROOT" && vulture . --min-confidence 80 ) > "$OUT/py-vulture.txt" 2>&1 || true
fi

# ---------- PHASE 3: duplication (both) ----------
echo "[dup] jscpd (copy-paste detection)"
( cd "$ROOT" && npx --yes jscpd . --silent --min-lines 5 --min-tokens 50 \
    --reporters json --output "$OUT/jscpd" --ignore "$IGNORE_GLOB" ) > "$OUT/dup-jscpd.txt" 2>&1 || true

# ---------- PHASE 2: dead files / artifacts ----------
echo "[files] artifact + cruft candidates"
find "$ROOT" \( "${FIND_PRUNE[@]}" \) -prune -o \
  \( -name '__pycache__' -o -name '.pytest_cache' -o -name '.mypy_cache' -o -name '.ruff_cache' \
     -o -name 'htmlcov' -o -name '.coverage' -o -name 'coverage.xml' -o -name '*.pyc' \
     -o -name '.DS_Store' -o -name '*.log' -o -name '*.tsbuildinfo' \
     -o -name 'test-results' -o -name 'playwright-report' -o -name 'allure-results' -o -name '.nyc_output' \
  \) -print > "$OUT/dead-files-candidates.txt" 2>/dev/null || true

echo "[files] git-tracked cruft (should be gitignored)"
if git -C "$ROOT" rev-parse >/dev/null 2>&1; then
  git -C "$ROOT" ls-files \
    | grep -E '(__pycache__|\.pyc$|\.DS_Store|/dist/|/build/|/\.next/|htmlcov|\.coverage|\.tsbuildinfo|test-results/|playwright-report/)' \
    > "$OUT/tracked-cruft.txt" 2>/dev/null || true
else
  echo "(not a git repo — skipped)" > "$OUT/tracked-cruft.txt"
fi

# ---------- baseline metrics for before/after ----------
{
  echo "timestamp: $TS"
  echo "root: $ROOT"
  echo "files (tracked): $(git -C "$ROOT" ls-files 2>/dev/null | wc -l | tr -d ' ')"
  echo "loc (approx, tracked code): $(git -C "$ROOT" ls-files 2>/dev/null | grep -E '\.(ts|tsx|js|jsx|py)$' | xargs wc -l 2>/dev/null | tail -1)"
} > "$OUT/metrics-baseline.txt" 2>/dev/null || true

echo
echo "==> scan complete. Findings in: $OUT"
echo "    Review each *.txt / *.json, triage false positives (references/*.md),"
echo "    then build the HTML report and get approval BEFORE removing anything."
ls -1 "$OUT"
