#!/usr/bin/env bash
# Install Python dead-code detectors. JS/TS tools run via `npx --yes` (no install needed).
# Usage: install_tools.sh [project-root]
set -uo pipefail

ROOT="${1:-.}"
echo "==> codebase-hygiene: tool setup for $ROOT"

# --- JS/TS: nothing to install; npx fetches on demand ---
if [ -f "$ROOT/package.json" ]; then
  echo "[js]  knip / depcheck / madge / jscpd / dependency-cruiser run via 'npx --yes' — no install needed."
fi

# --- Python: install vulture + ruff + deadcode into the project's env ---
PY_PROJECT=0
if [ -f "$ROOT/pyproject.toml" ] || [ -f "$ROOT/setup.py" ] || [ -f "$ROOT/requirements.txt" ]; then PY_PROJECT=1; fi
if compgen -G "$ROOT"/**/*.py >/dev/null 2>&1 || compgen -G "$ROOT"/*.py >/dev/null 2>&1; then PY_PROJECT=1; fi

if [ "$PY_PROJECT" = "1" ]; then
  if command -v poetry >/dev/null 2>&1 && [ -f "$ROOT/pyproject.toml" ]; then
    echo "[py]  installing dev tools via poetry (vulture ruff deadcode pydeps)..."
    ( cd "$ROOT" && poetry add --group dev --quiet vulture ruff deadcode pydeps ) \
      || echo "[py]  poetry add failed — install manually: poetry add --group dev vulture ruff deadcode pydeps"
  elif command -v pip >/dev/null 2>&1; then
    echo "[py]  installing dev tools via pip (vulture ruff deadcode pydeps)..."
    pip install --quiet --upgrade vulture ruff deadcode pydeps \
      || echo "[py]  pip install failed — try: pip install vulture ruff deadcode pydeps"
  else
    echo "[py]  no poetry/pip found. Install manually: pip install vulture ruff deadcode pydeps"
  fi
fi

echo "==> done. Next: scripts/hygiene_scan.sh $ROOT"
