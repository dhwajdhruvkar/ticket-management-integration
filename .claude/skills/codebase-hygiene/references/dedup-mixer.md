# Phase 3 — Mixer (Deduplication & Consolidation)

Goal: find functionality/UI that exists in multiple places and fold it into ONE survivor, so a future change happens once and propagates everywhere. This shrinks blast radius — the number of places a single logical change must touch.

Two kinds of duplication:
1. **Syntactic** — near-identical code (copy-paste). jscpd finds it mechanically.
2. **Logical/semantic** — different code, same job (`formatMoney` vs `toCurrency` vs `displayPrice`). Tools miss these; you find them by reading + naming patterns.

## Detect

### Syntactic (jscpd)
Read `.hygiene/<ts>/jscpd/jscpd-report.json` → `duplicates[]`: each entry has `firstFile`/`secondFile`, line ranges, and the duplicated `fragment`. Sort by token count (biggest clones = biggest wins). The `statistics.total.percentage` is your duplication % for the before→after metric.

### Logical (judgment-led)
Scan for these smells across the tree:
- **Sibling functions with similar names**: `*format*`, `*validate*`, `*parse*`, `*fetch*`, `*toX*`, `get*By*`. Grep names, cluster by stem.
- **Repeated literals/config**: same magic numbers, regexes, API paths, error strings in multiple files → extract a constant/module.
- **Parallel UI**: components rendering the same shape (button, card, modal, empty-state, loading skeleton) with copy-pasted markup/styles. Map by JSX/props shape.
- **Duplicate types/interfaces**: same shape declared in several files → one shared type.
- **Repeated data-fetch/error/loading patterns**: candidate for a shared hook (`useX`) or decorator/util.

## Consolidate — the survivor pattern

For each duplicate cluster:

1. **Pick the survivor.** Prefer the most complete, best-located, best-tested instance. If none is well-placed, create a new home (a domain util module / shared component) — see `references/realignment.md` for where.
2. **Generalize minimally.** Diff the copies; the differences become parameters/props. Don't over-abstract — if two things are 60% similar but diverge semantically, leaving them separate is correct. Premature DRY couples unrelated things and *increases* blast radius. Rule of thumb: consolidate on the 3rd occurrence, and only when the duplicates change together for the same reason.
3. **Redirect call sites.** Replace each duplicate with a call to the survivor. Use codemods/find-replace; verify every import resolves.
4. **Delete the now-dead copies** (they become phase-1/2 dead code — re-run the detector to confirm zero importers, then `git rm`).
5. **Verify green** (tests/types). Consolidation is the riskiest phase for behavior change — the copies may have had subtle differences. If a test goes red, the copies were NOT truly equivalent; restore and document the difference instead of merging.
6. **One survivor per commit**: `refactor: merge 3 currency formatters into money util — single source`.

## UI/UX specific (React/Next.js)
- Extract repeated markup into a `components/` primitive; pass variants via props, not copies.
- Co-locate styles with the survivor (CSS module / styled / tailwind `@apply` or a shared class).
- Centralize design tokens (colors, spacing, radii) — duplicated hex/px values are duplication too. Align with Sairam's frontend rules (color scales, layer system) when defining the token survivor.
- Shared loading/empty/error states → one `<Skeleton>`, `<EmptyState>`, `<ErrorState>` per Sairam's UI rules.

## Anti-goals (do NOT merge)
- Code that's coincidentally similar but changes for different reasons (different bounded contexts).
- Cross-domain merges that create a "god util" everything depends on (raises blast radius, the opposite of the goal).
- Test code — some duplication in tests is healthy (explicitness > DRY in tests).

## Output for the report
Per cluster: survivor (file:line) · absorbed copies (paths) · params introduced · call sites updated · risk note. Track duplication % before→after.
