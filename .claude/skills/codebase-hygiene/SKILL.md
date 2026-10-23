---
name: "Codebase Hygiene"
description: "Systematically clean and consolidate any codebase (Next.js/TypeScript, Python, or mixed). Use when removing dead or unreferenced code, deleting orphaned files, stale tests, build artifacts and test results, deduplicating repeated functions or UI components to shrink blast radius, or reorganizing files into feature/domain folders. Triggers: dead code, unused exports, code cleanup, remove duplication, DRY, consolidate, refactor structure, reorganize, tidy repo, codebase hygiene, reduce tech debt, prune unused. Runs detect → review → confirm → remove-on-branch-with-tests, and never deletes anything without a git checkpoint plus explicit approval."
---

# Codebase Hygiene

Four-phase cleanup pipeline that works on any project. Detects first (read-only), reports, gets your approval, then removes/refactors on a branch with tests gating every step.

## The Four Phases

| # | Phase | What it does | Reference |
|---|-------|--------------|-----------|
| 1 | **Dead code** | Find unreferenced functions, exports, vars, imports, unreachable branches — code not used in any real execution path | `references/dead-code.md` |
| 2 | **Dead files** | Find orphaned modules, stale tests for deleted source, committed build artifacts, test results, caches | `references/dead-files.md` |
| 3 | **Mixer (dedup)** | Find duplicated/near-duplicate logic & UI, consolidate into one survivor so "change once = changes everywhere" → smaller blast radius | `references/dedup-mixer.md` |
| 4 | **Realignment** | Regroup tightly-coupled code into feature/domain folders so the structure matches the dependency graph | `references/realignment.md` |

Execution order is intentional: **1 → 2 → 3 → 4**. Removing dead code orphans files (feeds phase 2); a minimal tree makes dedup clearer (phase 3); realignment is the most invasive so it goes last.

## NON-NEGOTIABLE Safety Protocol

This skill deletes and moves code. Read `references/safety.md` and follow it exactly. Summary:

1. **Clean tree + green baseline.** `git status` clean, tests pass, type-check passes BEFORE touching anything. Record the baseline.
2. **Work on a branch.** `git switch -c chore/codebase-hygiene-<date>`. Never on main/master.
3. **Detect is read-only.** Phase scans never modify files. They write raw output to `.hygiene/<timestamp>/`.
4. **Human-reviewed removal plan.** Produce an HTML report, get explicit approval per category. Per Sairam's rules, deleting/overwriting is a HARD STOP — confirm first.
5. **One commit per logical removal**, with verification (tests + type-check, NOT `npm run build` — dev server is running) green after each. If red → revert that commit.
6. **Backup before bulk deletes** (Sairam's destructive-sequencing rule): copy targets, verify `find | wc -l` count match + `diff -rq`, only then delete. See `references/safety.md`.

False positives are the enemy. Framework magic (Next.js file-routing, dynamic imports, decorators, DI, CLI entry points, serverless handlers, `__init__` re-exports) makes tools flag live code as dead. Every tool finding is a *candidate*, never an *order*.

## Run Protocol (create these as TodoWrite items)

```
[ ] 0. Safety setup: clean tree, green tests/types, new branch, record baseline
[ ] 1. Run detection: scripts/hygiene_scan.sh  (read-only, writes .hygiene/<ts>/)
[ ] 2. Triage findings: filter framework false-positives (references/*.md checklists)
[ ] 3. Build HTML report + removal plan, auto-open it, get per-category approval
[ ] 4. Phase 1 — remove dead code, commit, verify green
[ ] 5. Phase 2 — remove dead files/artifacts (backup→verify→delete), commit, verify
[ ] 6. Phase 3 — consolidate duplicates, commit, verify
[ ] 7. Phase 4 — realign folders (git mv, fix imports), commit, verify
[ ] 8. Final report: before→after metrics (LOC, files, dup%, dep edges)
```

## Quick Start

```bash
# 0. Safety
cd <project-root>
git status                              # must be clean
git switch -c chore/codebase-hygiene-$(date +%Y%m%d)

# 1. Install detectors once (npx-based JS tools need nothing; Python needs a few)
~/.claude/skills/codebase-hygiene/scripts/install_tools.sh

# 2. Detect everything (read-only)
~/.claude/skills/codebase-hygiene/scripts/hygiene_scan.sh .

# 3. Read .hygiene/<latest>/*  → triage → report → confirm → execute per phase
```

The scan auto-detects stack (package.json → JS/TS, pyproject/requirements/*.py → Python, both → mixed) and runs the right detectors.

## Tooling Cheat-Sheet

Full install + command reference: `references/tooling.md`.

| Concern | JS / TS / Next.js | Python |
|---------|-------------------|--------|
| Unused files/exports/deps | **knip** (primary), depcheck, ts-prune | **vulture** + **ruff** (F401/F811/F841) |
| Orphan modules / dep graph | madge, dependency-cruiser | pydeps, importlab |
| Duplication | **jscpd** (language-agnostic) | **jscpd** |
| Verify after change | `tsc --noEmit`, `eslint`, tests | `ruff check`, `mypy`, `pytest` |

Verification NEVER uses `npm run build` (Sairam: dev server is always running).

## Reference Files

- `references/safety.md` — full safety/branch/backup/verify protocol (read before any deletion)
- `references/tooling.md` — every tool, install command, exact invocation, JSON output flags
- `references/dead-code.md` — phase 1: detection + false-positive checklist per framework
- `references/dead-files.md` — phase 2: orphan files, stale tests, artifact/cruft taxonomy, .gitignore vs delete
- `references/dedup-mixer.md` — phase 3: how to find + safely consolidate duplication (functions, components, types)
- `references/realignment.md` — phase 4: dependency-graph-driven regrouping into feature/domain folders

## Scripts

- `scripts/install_tools.sh` — installs Python detectors (vulture, ruff, deadcode); JS tools run via npx
- `scripts/hygiene_scan.sh` — read-only orchestrator; detects stack, runs all phase-1–3 detectors, writes `.hygiene/<ts>/`
