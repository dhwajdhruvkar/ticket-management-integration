# Codebase Hygiene — a Claude Code Skill

A [Claude Code](https://docs.claude.com/en/docs/claude-code) skill that **finds and removes dead code, deletes orphaned files, deduplicates repeated logic/UI, and reorganizes any codebase into clean feature/domain folders** — for Next.js / TypeScript, Python, or mixed projects.

It is built **safety-first**: detection is read-only, every finding is treated as a *candidate* (not an order), and nothing is ever deleted or moved without a git checkpoint and your explicit approval.

```
detect (read-only)  →  review (HTML report)  →  confirm  →  remove-on-branch-with-tests
```

## The four phases

| # | Phase | What it does |
|---|-------|--------------|
| 1 | **Dead code** | Unreferenced functions, exports, variables, imports, unreachable branches — code no execution path reaches |
| 2 | **Dead files** | Orphaned modules, stale tests for deleted source, committed build/cache artifacts, test-result dirs, dead snapshots |
| 3 | **Mixer (dedup)** | Duplicated & near-duplicate logic/UI folded into a single survivor so "change once = change everywhere" → smaller blast radius |
| 4 | **Realignment** | Tightly-coupled code regrouped into feature/domain folders so structure mirrors the dependency graph |

Phases run in order **1 → 2 → 3 → 4** (removing dead code orphans files; a minimal tree makes dedup clearer; realignment is most invasive so it goes last).

## Tools it drives

| Concern | JavaScript / TypeScript / Next.js | Python |
|---------|-----------------------------------|--------|
| Unused files / exports / deps | [knip](https://knip.dev), depcheck, ts-prune | [vulture](https://github.com/jendrikseipp/vulture) + [ruff](https://docs.astral.sh/ruff/) (F401/F811/F841) |
| Orphan modules / dependency graph | [madge](https://github.com/pahen/madge), dependency-cruiser | pydeps |
| Duplication | [jscpd](https://github.com/kucherenko/jscpd) (language-agnostic) | jscpd |

JS tools run via `npx --yes` (nothing to install). Python tools install into your project's env via `scripts/install_tools.sh`.

## Install

Clone (or copy) this repo into your Claude Code skills directory so it becomes the skill folder:

```bash
git clone https://github.com/chaganti-sairam/codebase-hygiene-skill.git \
  ~/.claude/skills/codebase-hygiene
```

Or for a single project (team-shared, version-controlled):

```bash
git clone https://github.com/chaganti-sairam/codebase-hygiene-skill.git \
  <your-project>/.claude/skills/codebase-hygiene
```

Restart Claude Code. The skill auto-activates when you ask to "remove dead code", "clean up the repo", "deduplicate", "reorganize the project", etc.

## Use

Just ask Claude, in a project:

> "Run codebase hygiene on this repo."

Or invoke directly:

```bash
# in your project root, on a clean tree
git switch -c chore/codebase-hygiene-$(date +%Y%m%d)
~/.claude/skills/codebase-hygiene/scripts/install_tools.sh .   # one-time (Python)
~/.claude/skills/codebase-hygiene/scripts/hygiene_scan.sh  .   # read-only detection
```

The scan writes raw findings to `.hygiene/<timestamp>/`. Claude then triages false positives, builds an HTML report for your sign-off, and executes phase by phase — committing each logical change and running your tests + type-check after every step.

## Safety model

- **Clean tree + green baseline required** before anything runs.
- **Always works on a branch**, never `main`.
- **Detection never writes** to your source.
- **Findings are candidates** — every tool produces false positives (Next.js file routing, dynamic imports, decorators, DI, CLI entry points, re-exports). Each is checked against a per-framework checklist before removal.
- **Confirm before delete** — per-category approval; folder moves are confirmed separately from code removal.
- **Backup → verify → delete** for bulk removals (file-count + `diff -rq` check before the destructive step).
- **One commit per logical change**, verified green (tests + type-check) — revert-on-red, never fix-forward.
- **`git mv` for moves** to preserve history.
- Verification uses `tsc --noEmit` / `mypy` / your test suite — never a production build.

## What's inside

```
codebase-hygiene/
├── SKILL.md                  # routing, 4-phase map, run protocol
├── references/
│   ├── safety.md             # branch + backup→verify→delete + per-commit verify
│   ├── tooling.md            # every tool: install + exact invocation
│   ├── dead-code.md          # phase 1 + framework false-positive checklist
│   ├── dead-files.md         # phase 2 + artifact/cruft taxonomy
│   ├── dedup-mixer.md        # phase 3 survivor pattern + anti-over-DRY guardrails
│   └── realignment.md        # phase 4 history-preserving moves
└── scripts/
    ├── install_tools.sh      # installs Python detectors (JS via npx)
    └── hygiene_scan.sh       # read-only stack-detecting orchestrator
```

## License

[MIT](LICENSE) — use it, fork it, ship it.

---

Built with the [skill-builder](https://docs.claude.com/en/docs/agents-and-tools/agent-skills) pattern. Contributions welcome.
