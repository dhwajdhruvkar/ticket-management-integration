# Project Agent Tools

This repository includes Archify, Ponytail, Graphify and all 25 engineering
skills from Addy Osmani's agent-skills collection. They help agents understand,
document and review this application. They do not add website features, change
API permissions or require a paid service.

## Installed sources

Project-local skills live in `.agents/skills/`. Exact upstream revisions and
directory SHA-256 checks are recorded in `agent-tools.lock.json`; licenses and
notices are retained. Addy's shared references are in `.agents/references/`.

- [Archify](https://github.com/tt-a1i/archify) renders source-backed diagrams.
- [Ponytail](https://github.com/DietrichGebert/ponytail) guides minimal, verified implementations.
- [Graphify](https://github.com/Graphify-Labs/graphify) builds a code knowledge graph.
- [Addy Osmani's agent-skills](https://github.com/addyosmani/agent-skills) supplies workflows selected through `using-agent-skills`.

Skills become discoverable in a subsequent agent turn or session. Ask for
`$archify`, `$ponytail`, `$graphify`, or a workflow such as
`$code-review-and-quality`. `AGENTS.md` explains how to combine them while
preserving the CodeGraph-first rule and main-branch delivery preference.
No global hooks or user settings are changed.

## Install the local Graphify runtime

The skills are committed. The Python runtime is local, not committed or
installed during Vercel builds. Use Python 3.10 or newer. The npm wrapper never
silently downloads a missing runtime.

Windows PowerShell:

```powershell
python -m venv .tools/graphify-venv
& ./.tools/graphify-venv/Scripts/python.exe -m pip install -r requirements-agent-tools.txt
```

macOS or Linux:

```sh
python3 -m venv .tools/graphify-venv
.tools/graphify-venv/bin/python -m pip install -r requirements-agent-tools.txt
```

The package is pinned to `graphifyy==0.9.72`; pip resolves its transitive
dependencies. The source lock verifies skill files, not the full Python
environment. Do not run a global `graphify install`, which may alter other
agents' configuration.

## Build and query the code map

```sh
npm run graph:build
npm run graphify -- diagnose multigraph --json
npm run graphify -- query "actor tenant permission" --budget 3000
```

The build extracts only `src/` with local AST parsers, creates a report and
exports `graphify-out/graph.html`. Secrets, tenant data, skills and generated
output are outside that scope. The wrapper disables query logging. Semantic
document or provider extraction is not enabled.

Select terms from real node labels, following Graphify's query reference.
Queries retrieve relationships, not natural-language answers or security
proofs. Narrow a truncated query or raise its budget, then check the source.

The initial main-source map contains 193 code files, 1,882 nodes, 6,589 edges
and 67 manually named communities. CSS is not extracted. Diagnostics report no
dangling or missing endpoints. Four self-loops include recursive helpers and
an Auth.js POST wrapper requiring source interpretation. Some links are
inferred, not verified runtime calls. These numbers describe this snapshot
and will change after source updates.

The first report has manually curated community names. Ordinary rebuilds skip
paid naming and may replace changed communities with placeholders or hub
names; review labels after a significant source change. The Auth.js POST loop
is an extraction ambiguity: the wrapper calls `handlers.POST`, not itself.

## Render the architecture

```sh
npm run architecture:render
```

Node.js 18 or newer is sufficient; the packaged renderer needs no separate npm
installation. Chrome or Chromium is required for the real-browser gate. Each
run creates a fresh `.archify/architecture-ticket-intake-*` folder containing
the candidate, HTML and receipts. A nonzero exit is not completed delivery;
consult the compact finalize summary.

The authored source is `docs/architecture/ticket-intake.json`. Its citations
are frozen to the revision in `meta.repository`. Inspect corresponding source
before updating that revision or its claims. The diagram shows UI/API-key
entrances, access checks, intake, ticket/audit writes and Prisma/PostgreSQL
persistence. Optional providers are not presented as configured services.

## Verify and update the tools

```sh
npm run agent-tools:check
npm run typecheck
npm run lint
npm test
npm run build
```

CI checks directory hashes. The regression test covers modified, added and
missing files and repository-escaping lock paths. App typechecking and linting
exclude vendored fixtures and generated analysis. `.vercelignore` excludes
these development assets from deployments.

For intentional updates, review upstream changes, replace only selected
skills and required references/licenses, update recorded revisions, then run
`node scripts/check-agent-tools.cjs --update-lock` and verification. Never
regenerate hashes just to hide an unexpected difference. No migration,
credential upload or business-data operation is part of this setup.
