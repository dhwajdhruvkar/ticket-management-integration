# Safety Protocol (read before ANY deletion or move)

This skill changes code destructively. These rules are non-negotiable. They encode Sairam's CLAUDE.md hard-stops (data deletion/overwrite = confirm first) and the destructive-sequencing rule.

## 0. Pre-flight (gate — do not proceed until all green)

```bash
git status --porcelain            # MUST be empty (clean tree)
git rev-parse --abbrev-ref HEAD   # note current branch
```

Record a **baseline** so you can prove "no behavior changed":

```bash
# JS/TS
npx tsc --noEmit                  # type-check baseline
npx eslint . --max-warnings=0 || true
<your test command, e.g. npm test / pnpm test / vitest run>

# Python
poetry run ruff check .           # or: ruff check .
poetry run mypy . || true
poetry run pytest -q
```

Save pass/fail + counts. If the baseline is already red, STOP and tell the user — you cannot distinguish your breakage from pre-existing breakage. Never use `npm run build` to verify (Sairam's dev server is always running; building would conflict).

## 1. Always work on a branch

```bash
git switch -c chore/codebase-hygiene-$(date +%Y%m%d)
```

Never run this skill on `main`/`master`/`develop`. Each phase becomes one or more commits so any step is independently revertible.

## 2. Detection is read-only

`scripts/hygiene_scan.sh` and every tool it calls only READ. They write findings to `.hygiene/<timestamp>/`. Add `.hygiene/` to `.gitignore`. No file is deleted or moved during detection.

## 3. Findings are candidates, not orders

Every tool produces false positives. Before deleting anything, run it through the false-positive checklist in the relevant `references/*.md`. The decision to delete is the user's — present, do not assume.

## 4. Confirm before destructive action (HARD STOP)

Per Sairam's autonomy rules, **data deletion/overwrite requires explicit confirmation**. Produce the HTML removal plan, auto-open it (`open report.html`), and get per-category approval. "Approve dead code" ≠ "approve folder moves." Confirm each phase separately.

## 5. Backup → verify → delete (destructive sequencing rule)

For any **bulk** delete (multiple files, a directory), the destructive step must NOT start until a backup is complete AND verified. This rule exists because a `cp -R &` race once silently dropped 10 files.

```bash
BK=~/Backups/hygiene-$(date +%Y%m%d-%H%M%S)
mkdir -p "$BK"
cp -R <targets> "$BK"/            # foreground; do NOT background + parallel-delete
wait                              # if any cp was backgrounded, wait for it

# VERIFY both before deleting:
[ "$(find <source> -type f | wc -l)" = "$(find "$BK" -type f | wc -l)" ] && echo "count OK"
diff -rq <source> "$BK"/<source-basename>    # must print nothing

# only now:
git rm -r <targets>   # tracked → use git rm so it's in history
# or: rm -rf <targets>  for untracked cruft
```

For git-tracked files, `git rm` is itself recoverable (history + branch), so a filesystem backup is belt-and-suspenders — still do it for bulk/irreversible-feeling deletes. For single-file, git-tracked removals on a branch, the git history is sufficient backup.

## 6. One commit per logical change + verify green

After each removal/consolidation/move:

```bash
<run the same baseline checks: tsc/eslint/tests or ruff/mypy/pytest>
```

- Green → commit with Sairam's format: `chore: remove dead <thing> — unreferenced since <context>`
- Red → `git restore .` (or `git reset --hard HEAD`) that change and mark the candidate as a false positive in the report. Do NOT "fix forward" a hygiene change; revert and move on.

Commit message types: `chore` (cleanup/cruft), `refactor` (dedup/realign). Examples:
```
chore: remove 14 unused exports flagged by knip — no importers in tree
refactor: merge formatCurrency variants into shared money util — one survivor
refactor: move auth modules into feature/auth — matches dependency cluster
```

## 7. Realignment preserves history

Phase 4 moves files. Always `git mv` (preserves blame/history), then fix imports, then verify. Never copy+delete (loses history). See `references/realignment.md`.

## 8. Final accounting

End with a before→after table: LOC, file count, duplicate %, dependency edges, dead-export count. Push the branch and open a PR; do not merge to main without the user.

## Stop conditions

Stop and ask the user if:
- Baseline is red before you start.
- A "dead" symbol is reachable via dynamic dispatch you can't statically rule out.
- Removing a candidate turns tests red and the fix isn't a trivial revert.
- A move would cross a public API / package boundary that other repos import.
