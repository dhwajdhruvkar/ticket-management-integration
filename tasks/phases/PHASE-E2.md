# Phase E2 — Attachments inside the conversation (requires Phase E1)

Goal: requesters and agents attach files from the reply box; files appear under the message in the thread, are part of the audit trail, and files on
**internal notes are hidden from requesters** (list, thread and download). Common file types allowed, max 5 files per message, size cap from config (≤ 4 MB in database mode).

## Files
Server:
1. `src/server/services/ticketService.ts` — `mutateTicket` signature (line 281-286, `message?` param type), message creation in `persist` (~line 322: `tx.messages.create({ id: newId("msg"), ticketId: id, ...message, … })`), `TicketView` interface (line 40), `getTicketView` (135-180).
2. `src/server/services/agentActions.ts` — `agentReply` (line 41-80; `mutateTicket` call ~57), `requesterReply` (line 435-464; `mutateTicket` call ~452).
3. `src/server/services/attachmentService.ts` — `ALLOWED_MIME` (25-45), `prepareAttachment`, `saveAttachments` (~line 150-215), `listAttachments` (~220), `findAttachment`/`getAttachmentMetadata`/`readAttachment`.
4. `src/app/api/v1/tickets/[id]/messages/route.ts` (60 lines — read whole).
5. `src/app/api/v1/tickets/[id]/attachments/route.ts` — `GET` handler (lines ~50-75).
6. `src/app/api/v1/attachments/[id]/route.ts` — download/delete handler (read whole; apply the requester visibility rule).
7. `src/lib/api.ts` (125 lines — read whole; add a FormData sender).
Client:
8. NEW `src/shared/attachments.ts` — `export const CHAT_ATTACHMENT_LIMITS = { maxFiles: 5, maxBytes: 4 * 1024 * 1024 };`
9. NEW `src/components/AttachmentPicker.tsx`.
10. `src/components/RequesterReplyBox.tsx` (155 lines; textarea+send at lines 93-123).
11. `src/components/TicketComposer.tsx` — only `send()` (line ~100), the textarea (~151) and the Send buttons (~346-350).
12. `src/components/ConversationThread.tsx` — `Bubble` type, `rest` mapping (line 55), `MessageBubble` (line 160; two render branches: `own` and default).
13. `tests/attachments.test.ts` (extend).

## Server steps
1. `mutateTicket` message param: add `id?: string` to its type. Pitfall: the creation spreads `...message` after `id: newId("msg")`, so an `id: undefined` key would overwrite the generated id — callers must add the key only when defined.
2. `agentReply(ticketId, agent, body, visibility, messageId?)` and `requesterReply(ticketId, requester, body, messageId?)`: pass `{ …existing, ...(messageId ? { id: messageId } : {}) }` as the message.
3. `attachmentService.ts`:
   - Add to `ALLOWED_MIME`: `"image/heic"`, `"image/bmp"`, `"video/mp4"`, `"application/vnd.ms-outlook"`. Keep blocked extensions and the no-op virus-scan seam.
   - `export function validateAttachmentFiles(inputs: AttachmentInput[]): void` → `inputs.forEach(prepareAttachment)`; throws `AttachmentError`.
   - `saveAttachments(tenantId, ticketId, inputs, actor, dependencies, options: { messageId?: string; internal?: boolean } = {})`: set `messageId: options.messageId ?? null` on the record; event text when `options.internal`: `An internal attachment was added by ${actor}.` (do not leak the file name); include `messageId` in the audit payload. Keep rollback behaviour.
   - `export async function listVisibleAttachments(tenantId, ticketId, includeInternal): Promise<AttachmentRow[]>`: ticket must exist in tenant; load `store.attachments.list({ ticketId })` and `store.messages.list({ ticketId })`; when `!includeInternal` drop attachments whose `messageId` belongs to a message with `visibility === "internal"`; sort by `createdAt` asc.
   - `export async function isAttachmentInternal(tenantId, record: AttachmentRow): Promise<boolean>` (message lookup via `store.messages.get(record.messageId)`).
4. Attachments `GET` route: for non-agent roles (`!isAgentRole(ctx.role)` — the guard already returns `ctx.role`? use the same `actorContext` result) call `listVisibleAttachments(..., false)` and respond with `paginated(rows, rows.length, pagination)`; agents keep the existing path.
5. `/attachments/[id]` route: for requesters (non-agent roles), return 404 when `isAttachmentInternal` is true (both GET download and any metadata). Agents unaffected.
6. `getTicketView`: load `store.attachments.list({ ticketId: id })`; add `attachments: AttachmentRow[]` to `TicketView`; when `!options.includeInternal`, drop attachments tied to internal messages (compute internal ids from the already-loaded `messages`). Sort by `createdAt`. Run `npm run typecheck` to find other `TicketView` constructors/mocks.
7. Messages route: support `multipart/form-data` in addition to JSON.
```ts
const multipart = (req.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data");
```
   For multipart: reject when `content-length` exceeds `config.attachmentMaxBytes * 5 + 1 MiB`; `const form = await req.formData()`; build `{ body, visibility, asRequester: form.get("asRequester") === "true" }` and validate with the existing `MessageBody` schema (`safeParse`; fail 400 on error); `files = form.getAll("file").filter((f): f is File => f instanceof File)`; > 5 files → 400.
   Before posting the message: if `files.length` and `!config.features.attachments` → `fail("Attachment storage is not enabled for this deployment.", 503)`; convert files to `AttachmentInput[]` (`fileName`, `mimeType: file.type || "application/octet-stream"`, `bytes: Buffer.from(await file.arrayBuffer())`) and call `validateAttachmentFiles` (map `AttachmentError` to `fail(err.message, err.status)`).
   Then `const messageId = newId("msg")` (`@/server/domain/ids`), call `requesterReply/agentReply(..., messageId)`; if files: `await saveAttachments(ticket.tenantId, id, inputs, ctx.actor.name, {}, { messageId, internal: visibility === "internal" })`. If saving fails after the message was created, return `fail("Your message was sent, but the attachments could not be saved: " + reason, 502)`. Requesters keep the rules: public only, own ticket.
   JSON path stays identical.

## Client steps
8. `api.ts`: add `apiSendForm<T>(path: string, form: FormData): Promise<T>` mirroring `apiSend` (POST, no manual `Content-Type`, same error unwrapping).
9. `AttachmentPicker`: props `{ files: File[]; onChange: (files: File[]) => void; disabled?: boolean }`. Paperclip button (inline SVG) + hidden `<input type="file" multiple>`; client-side checks against `CHAT_ATTACHMENT_LIMITS` with `useToast` errors; chip list with filename, size and a remove button (aria-labels).
10. `RequesterReplyBox`: `files` state; the send action builds `FormData` (`body`, `asRequester: "true"`, each `file`) when `files.length`, else the current `apiSend`; clear files on success; allow sending only when there is text.
11. `TicketComposer.send()`: same, with `visibility: tab`; show the picker next to the Send buttons.
12. `ConversationThread`: extend `Bubble` with `attachments?: AttachmentRow[]` using `ticket.attachments.filter((a) => a.messageId === m.id)`; in both branches of `MessageBubble` render small download links under the body: `<a href={`/api/v1/attachments/${a.id}`} download>{a.fileName}</a> · size` (download only; never render inline HTML/SVG). Keep the root bubble unchanged.
    `AttachmentsPanel.tsx` stays as is (its list now comes from the filtered API).

## Tests (`tests/attachments.test.ts`, follow its existing helpers)
1. Saving with `messageId` stores it; audit payload includes it.
2. `listVisibleAttachments(…, false)` hides files on an internal note, shows files on a public message and ticket-level files; `includeInternal=true` shows all.
3. `isAttachmentInternal` true/false; cross-tenant ticket returns nothing.
4. New MIME types accepted; `.exe` and disallowed MIME still rejected.
5. `getTicketView` with `includeInternal:false` excludes internal-note attachments (create a ticket + internal message + attachment in the memory store).

## Done when
`npx vitest run tests/attachments.test.ts tests/ticketMessageValidation.test.ts tests/securityHardening.test.ts`, `npm run typecheck`, `npm run lint` pass.
