# Phase G — "Who & Where" picker (run after Phase F)

Goal: a searchable, keyboard-accessible list of ALL ACTIVE users of the organization (owner decision: no sign-in filter), shown as "Name · Department · Location";
empty search browses the first page alphabetically; choosing a person pre-fills an editable Location; location is stored on the ticket and shown to agents.
No migration: the location snapshot lives in the existing `customFields` JSON as `requesterLocation`. Directory/SSO sync is out of scope (postponed).

## Files
1. `src/server/services/requesterSearch.ts` (22 lines — read whole).
2. `src/app/api/v1/requesters/route.ts` (16 lines) — unchanged unless the empty-query guard is there (it is not; only the length check).
3. `src/components/RequesterPicker.tsx` (33 lines — rewrite as a combobox).
4. `src/components/TicketsExplorer.tsx` — `NewTicketForm` only: state ~1525-1536, submit payload ~1541-1550, "Who and where" section ~1632-1655 (`<RequesterPicker …/>` at line 1637).
5. `src/server/services/ticketService.ts` — `NewTicketInput` (line 51-75) and `createTicket` field `customFields: null` (line ~209).
6. `src/server/services/intake.ts` — after `requesterUser` is resolved (~line 36-41).
7. `src/app/api/v1/tickets/route.ts` — POST validation block (same place as Phase F's small additions).
8. `src/components/TicketProperties.tsx` (468 lines) — find where `requesterEmail` is rendered (`grep -n requesterEmail`), read ±30 lines, add a Location row.
9. `tests/requesterSearch.test.ts`.

## Steps
### requesterSearch.ts
- `RequesterChoice` adds `location: string | null`.
- Remove the early `if (!term) return {items: [], hasMore: false}`; an empty term lists active users of the tenant alphabetically (same sort, same `limit`, `hasMore` accordingly). Keep: tenant scope, `active: true`, limit clamp 1-50, match on `name email department location` (add location to the haystack).
- Update the existing test that expects an empty result for an empty query.

### RequesterPicker.tsx (accessible combobox; keep props `{ value, onChange, disabled }`, add `onSelect?: (choice: RequesterChoice | null) => void`)
- `<input role="combobox" aria-expanded aria-controls={listId} aria-autocomplete="list" aria-activedescendant>` + `<ul role="listbox" id={listId}>` with `<li role="option" aria-selected>` rows ("Name — email", second line "Department · Location").
- Fetch on focus and on typing (250 ms debounce) from `/requesters?q=` (the existing `apiGet` call; empty query allowed now). Keyboard: ArrowDown/ArrowUp move, Enter selects, Escape closes, Tab closes. Click selects (use `onMouseDown` to avoid blur race).
- Selecting calls `onChange(choice.email)` and `onSelect(choice)`; typing manually calls `onChange(text)` and `onSelect(null)` so a free email address still works ("No login account is created" help text stays; when `disabled`, show "Requests are submitted as your signed-in account.").
- Keep the status text (`role="status"`) for searching / "more matches" / unavailable. Label "Requester (who)".

### NewTicketForm
- State `location` (string). `<RequesterPicker … onSelect={(choice) => setLocation(choice?.location ?? "")} />` — only overwrite when a choice is selected or cleared.
- Add `<input className="input" aria-label="Location" placeholder="Location / site" maxLength={160} value={location} …/>` in the same "Who and where" grid (relabel the section "Who and where").
- Payload: `requesterLocation: location.trim() || undefined`. For requesters (`lockRequester`) the picker is disabled; prefill location from their profile only if the form already has it (do not add new fetches); the server fallback below covers it.

### Server
- `NewTicketInput.requesterLocation?: string`.
- `createTicket`: `customFields: input.requesterLocation?.trim() ? { requesterLocation: input.requesterLocation.trim().slice(0, 160) } : null`.
- `intakeTicket`: after `requesterUser` is resolved: `if (!input.requesterLocation && requesterUser?.location) input.requesterLocation = requesterUser.location;`.
- POST route: `if (body.requesterLocation !== undefined && (typeof body.requesterLocation !== "string" || body.requesterLocation.length > 160)) delete body.requesterLocation;` (never trust other `customFields` from the client; this route does not accept them and must keep it that way).

### TicketProperties
Show "Location" with value `String(ticket.customFields?.requesterLocation ?? "—")` next to the requester row (agent view). Use the file's existing row component.

## Tests (`tests/requesterSearch.test.ts`)
Empty query returns first page alphabetically with `hasMore`; includes `location`; matches by location text; excludes inactive users and other tenants; limit clamp (0 → 1, 500 → 50). Also run `tests/tenantUserIsolation.test.ts` and `tests/externalIntegration.test.ts`.

## Done when
Those tests, `npm run typecheck`, `npm run lint` pass. In the final answer list any a11y behaviour not verified in a browser.
