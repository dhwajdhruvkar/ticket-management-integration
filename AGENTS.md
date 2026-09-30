# Project agent guidance

## Scope and safety

Preserve unrelated worktree changes. These tools are not application runtime
features. Never upload `.env`, credentials, tenant records or API keys into
graphs, diagrams, prompts or commits. Do not run database migrations or paid
semantic extraction merely to refresh a code map.

## Code discovery

<!-- CODEGRAPH_START -->
If `.codegraph/` exists at the repository root, use `codegraph_explore` or
`codegraph explore "<symbol names or question>"` BEFORE grep/find or reading
application code. If it does not exist, do not create or index it.
<!-- CODEGRAPH_END -->

Otherwise, when a current `graphify-out/graph.json` exists, use Graphify for
orientation before broad text searches. Rebuild with `npm run graph:build` if
source files changed. Select query tokens from the real node-label vocabulary,
following Graphify's query reference. Report truncation, inferred links and
extraction gaps; confirm security and mutation claims at source call sites.
A graph is navigation evidence, not proof of runtime correctness. Use `rg`
and focused source reads when a graph is missing or cannot answer the question.

## Project skills

Read `.agents/skills/using-agent-skills/SKILL.md` to select the relevant Addy
Osmani workflow; do not load every skill for every task. Read selected skills
completely and follow their routed references. Shared references live in
`.agents/references/`.

- Apply `.agents/skills/ponytail/SKILL.md` to coding and reviews: understand
  the flow, reuse existing code or the standard library, and keep the working
  solution small without weakening security, validation or accessibility.
- Use `.agents/skills/archify/SKILL.md` for source-backed HTML diagrams.
  Cite inspected committed source, pin its revision and run all finalize gates.
  Do not claim perceptual review without inspecting captures.
- Use `.agents/skills/graphify/SKILL.md` for local source analysis. The project
  build extracts only `src/` via AST without paid AI providers. Semantic or
  provider extraction requires a separate user request.

Skills do not expand user authorization. Higher-priority safety instructions
override examples suggesting destructive Git resets, automatic messages,
provider uploads or extra deployments.

## Verification and delivery

Run `npm run agent-tools:check`, typecheck, lint, tests and production build for
setup changes. Use existing tests for new helper logic. Do not edit vendored
skill content; update reviewed upstream revisions and hashes intentionally.

The owner asks that "commit and push" publish relevant verified changes to
`origin/main`, triggering Vercel. Use a clean main-based worktree if necessary
to preserve unrelated edits. Inspect the staged diff, never force push, check
the exact commit's deployment and report any unverified result. Do not commit
or deploy without a user request authorizing it.

See `docs/AGENT_TOOLING.md` for installation and usage.
