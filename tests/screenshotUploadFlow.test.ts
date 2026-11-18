import { describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));

import { GET as listRoute, POST as uploadRoute } from "@/app/api/v1/tickets/[id]/attachments/route";
import { GET as downloadRoute } from "@/app/api/v1/attachments/[id]/route";
import { saveAttachmentWithKey, uploadAttachmentId } from "@/server/services/attachmentService";
import { getStore } from "@/server/data";
import type { BlobStore } from "@/server/storage/blobStore";
import { createApiKey } from "@/server/auth/apiKeys";
import { SCREENSHOT_ACCEPT, SCREENSHOT_LIMITS } from "@/shared/attachments";
import { screenshotProblem } from "@/components/ScreenshotUploader";
import { createTicket, getTicketView } from "@/server/services/ticketService";

const TENANT = "tenant_netlink";
const params = (id: string) => ({ params: Promise.resolve({ id }) });
// A real 1x1 PNG, so the content check (magic bytes) passes.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

// Rate limits key on the client IP (trusted on Vercel only); give every request its own so this file never trips the limiter.
vi.stubEnv("VERCEL", "1");
let ipCounter = 0;

function upload(ticketId: string, key: string, files: { name: string; bytes: Buffer; type: string }[], extra: Record<string, string> = {}) {
  const form = new FormData();
  for (const f of files) form.append("file", new File([new Uint8Array(f.bytes)], f.name, { type: f.type }));
  return uploadRoute(
    new Request(`http://localhost/api/v1/tickets/${ticketId}/attachments`, { method: "POST", headers: { authorization: `Bearer ${key}`, "x-forwarded-for": `198.51.100.${(ipCounter++ % 250) + 1}`, ...extra }, body: form }),
    params(ticketId)
  );
}
const list = async (ticketId: string, key: string) =>
  ((await (await listRoute(new Request(`http://localhost/api/v1/tickets/${ticketId}/attachments`, { headers: { authorization: `Bearer ${key}` } }), params(ticketId))).json()) as { data: { id: string; fileName: string }[] }).data;

async function setup(label: string) {
  const marker = `${label}-${Date.now()}`;
  const ticket = await createTicket(TENANT, { subject: `Screenshot ${marker}`, body: "Upload flow check.", requesterEmail: `shot-${marker}@example.test` });
  const key = (await createApiKey(TENANT, { name: `Shots ${marker}`, role: "agent" })).key;
  return { ticket, key };
}

// A second, different real PNG (same declared type and, below, the same file name and size as PNG).
const PNG2 = Buffer.from(PNG);
PNG2[PNG2.length - 8] ^= 0xff; // flips a byte in the trailing CRC area: same size, different content, still starts with the PNG signature
const KEY_A = "11111111-1111-4111-8111-111111111111";
const KEY_B = "22222222-2222-4222-8222-222222222222";
const KEY_C = "33333333-3333-4333-8333-333333333333";
const png = (bytes: Buffer = PNG, name = "shot.png") => [{ name, bytes, type: "image/png" }];
const keyed = (key: string) => ({ "x-upload-key": key });

function memoryBlobs(over: Partial<BlobStore> = {}) {
  const map = new Map<string, Buffer>();
  const store: BlobStore = {
    put: async (key, bytes) => { map.set(key, Buffer.from(bytes)); return `mem://${key}`; },
    get: async (key) => map.get(key) ?? null,
    delete: async (key) => map.delete(key),
    ...over,
  };
  return { store, map };
}

describe("screenshot upload: idempotency by upload key", () => {
  it("without a key, uploads stay independent (deliberate duplicates remain possible)", async () => {
    const { ticket, key } = await setup("plain");
    expect((await upload(ticket.id, key, png())).status).toBe(201);
    expect((await upload(ticket.id, key, png())).status).toBe(201);
    expect(await list(ticket.id, key)).toHaveLength(2);
  });

  it("the same key with the same content returns the existing attachment", async () => {
    const { ticket, key } = await setup("replay");
    const first = await upload(ticket.id, key, png(), keyed(KEY_A));
    expect(first.status).toBe(201);
    const stored = ((await first.json()) as { data: { id: string }[] }).data[0];
    const retry = await upload(ticket.id, key, png(), keyed(KEY_A));
    expect(retry.status).toBe(200);
    expect(retry.headers.get("Upload-Replayed")).toBe("true");
    expect(((await retry.json()) as { data: { id: string }[] }).data[0].id).toBe(stored.id);
    expect(await list(ticket.id, key)).toHaveLength(1);
  });

  it("the same file name and size with different content is NOT treated as the stored file", async () => {
    const { ticket, key } = await setup("samename");
    expect(PNG2.length).toBe(PNG.length);
    expect(PNG2.equals(PNG)).toBe(false);
    await upload(ticket.id, key, png(PNG), keyed(KEY_A));
    // Same key, different bytes: refused, never answered with the old attachment.
    const conflict = await upload(ticket.id, key, png(PNG2), keyed(KEY_A));
    expect(conflict.status).toBe(409);
    // A new selected file (new key) with the same name and size is stored separately.
    const second = await upload(ticket.id, key, png(PNG2), keyed(KEY_B));
    expect(second.status).toBe(201);
    expect(await list(ticket.id, key)).toHaveLength(2);
  });

  it("two different keys intentionally store identical files", async () => {
    const { ticket, key } = await setup("twins");
    expect((await upload(ticket.id, key, png(), keyed(KEY_A))).status).toBe(201);
    expect((await upload(ticket.id, key, png(), keyed(KEY_B))).status).toBe(201);
    const rows = await list(ticket.id, key);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
  });

  it("concurrent retries with one key produce exactly one attachment record", async () => {
    const { ticket, key } = await setup("race");
    const results = await Promise.all(Array.from({ length: 6 }, () => upload(ticket.id, key, png(), keyed(KEY_C))));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.every((s) => s === 200 || s === 201)).toBe(true);
    const ids = new Set(await Promise.all(results.map(async (r) => ((await r.json()) as { data: { id: string }[] }).data[0].id)));
    expect(ids.size).toBe(1);
    expect(await list(ticket.id, key)).toHaveLength(1);
  });

  it("a key cannot be reused to reach another ticket's attachment", async () => {
    const a = await setup("ticket-a");
    const b = await setup("ticket-b");
    const first = ((await (await upload(a.ticket.id, a.key, png(), keyed(KEY_A))).json()) as { data: { id: string }[] }).data[0];
    const other = await upload(b.ticket.id, b.key, png(), keyed(KEY_A));
    expect(other.status).toBe(201); // a new attachment on ticket B, not A's
    expect(((await other.json()) as { data: { id: string }[] }).data[0].id).not.toBe(first.id);
    expect(await list(a.ticket.id, a.key)).toHaveLength(1);
    expect(await list(b.ticket.id, b.key)).toHaveLength(1);
  });

  it("the attachment id is scoped to tenant, ticket and key", () => {
    const id = uploadAttachmentId("t1", "tk1", KEY_A);
    expect(id).toBe(uploadAttachmentId("t1", "tk1", KEY_A));
    for (const other of [uploadAttachmentId("t2", "tk1", KEY_A), uploadAttachmentId("t1", "tk2", KEY_A), uploadAttachmentId("t1", "tk1", KEY_B)]) expect(other).not.toBe(id);
    expect(id).toMatch(/^att_[0-9a-f]{32}$/);
  });

  it("another tenant cannot replay, upload to or reach the ticket", async () => {
    const { ticket, key } = await setup("tenant");
    await upload(ticket.id, key, png(), keyed(KEY_A));
    const outsider = (await createApiKey("tenant_verify_other_shots", { name: "Outsider", role: "agent" })).key;
    expect([403, 404]).toContain((await upload(ticket.id, outsider, png(), keyed(KEY_A))).status);
    await expect(saveAttachmentWithKey("tenant_verify_other_shots", ticket.id, { fileName: "shot.png", mimeType: "image/png", bytes: PNG }, KEY_A)).rejects.toThrow("Ticket not found");
    expect(await list(ticket.id, key)).toHaveLength(1);
  });

  it("rejects malformed keys and a key combined with several files", async () => {
    const { ticket, key } = await setup("badkey");
    for (const bad of ["short", "has spaces in it 1234567", "x".repeat(65), "semi;colon;semi;colon"]) {
      expect((await upload(ticket.id, key, png(), keyed(bad))).status, bad).toBe(400);
    }
    expect((await upload(ticket.id, key, [...png(), ...png(PNG, "two.png")], keyed(KEY_A))).status).toBe(400);
    expect(await list(ticket.id, key)).toHaveLength(0);
  });

  it("validation failures leave no record and no blob, and the key stays usable", async () => {
    const { ticket, key } = await setup("invalid");
    expect((await upload(ticket.id, key, [{ name: "fake.png", bytes: Buffer.from("not an image at all"), type: "image/png" }], keyed(KEY_A))).status).toBeGreaterThanOrEqual(400);
    expect((await upload(ticket.id, key, [{ name: "run.exe", bytes: Buffer.from("MZ"), type: "application/x-msdownload" }], keyed(KEY_B))).status).toBeGreaterThanOrEqual(400);
    expect(await list(ticket.id, key)).toHaveLength(0);
    expect((await upload(ticket.id, key, png(), keyed(KEY_A))).status).toBe(201); // the earlier failure did not burn the key
  });

  it("a storage failure removes the claim and leaves no orphaned blob, so a retry succeeds", async () => {
    const { ticket } = await setup("storagefail");
    let fail = true;
    const { store, map } = memoryBlobs({
      put: async (k, bytes) => { if (fail) { map.set(k, Buffer.from(bytes)); throw new Error("storage down"); } map.set(k, Buffer.from(bytes)); return `mem://${k}`; },
    });
    const input = { fileName: "shot.png", mimeType: "image/png", bytes: PNG };
    await expect(saveAttachmentWithKey(TENANT, ticket.id, input, KEY_A, "tester", { blobStore: store })).rejects.toThrow("storage down");
    expect(map.size).toBe(0); // the partial blob was deleted
    expect((await (await getStore()).attachments.list({ ticketId: ticket.id }))).toHaveLength(0);
    fail = false;
    const ok = await saveAttachmentWithKey(TENANT, ticket.id, input, KEY_A, "tester", { blobStore: store });
    expect(ok.replayed).toBe(false);
    expect(map.size).toBe(1);
  });

  it("clears an abandoned claim (row without a blob, older than a minute) and stores the upload", async () => {
    const { ticket } = await setup("abandoned");
    const store = await getStore();
    const id = uploadAttachmentId(TENANT, ticket.id, KEY_A);
    await store.attachments.create({ id, ticketId: ticket.id, fileName: "shot.png", mimeType: "image/png", sizeBytes: PNG.length, blobUrl: "", messageId: null, createdAt: new Date(Date.now() - 5 * 60_000).toISOString() });
    const { store: blobs } = memoryBlobs();
    const saved = await saveAttachmentWithKey(TENANT, ticket.id, { fileName: "shot.png", mimeType: "image/png", bytes: PNG }, KEY_A, "tester", { blobStore: blobs });
    expect(saved.replayed).toBe(false);
    expect(saved.record.blobUrl).toBe(`mem://${id}`);
    expect(await store.attachments.list({ ticketId: ticket.id })).toHaveLength(1);
  });

  it("a fresh claim whose blob has not appeared is reported as in progress, not stolen", async () => {
    const { ticket } = await setup("inprogress");
    const store = await getStore();
    const id = uploadAttachmentId(TENANT, ticket.id, KEY_A);
    await store.attachments.create({ id, ticketId: ticket.id, fileName: "shot.png", mimeType: "image/png", sizeBytes: PNG.length, blobUrl: "", messageId: null, createdAt: new Date().toISOString() });
    const { store: blobs } = memoryBlobs();
    await expect(saveAttachmentWithKey(TENANT, ticket.id, { fileName: "shot.png", mimeType: "image/png", bytes: PNG }, KEY_A, "tester", { blobStore: blobs })).rejects.toMatchObject({ status: 409 });
    expect(await store.attachments.list({ ticketId: ticket.id })).toHaveLength(1);
  }, 10_000);

  it("keeps the existing audit event, listing and private download for a keyed upload", async () => {
    const { ticket, key } = await setup("audit");
    const res = await upload(ticket.id, key, png(), keyed(KEY_A));
    const saved = ((await res.json()) as { data: { id: string; fileName: string }[] }).data[0];
    const view = await getTicketView(ticket.id, { includeInternal: true });
    expect(view?.attachments.map((a) => a.id)).toContain(saved.id);
    expect(view?.events.some((e) => e.message.includes("shot.png"))).toBe(true);
    const download = await downloadRoute(new Request(`http://localhost/api/v1/attachments/${saved.id}`, { headers: { authorization: `Bearer ${key}` } }), params(saved.id));
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toMatch(/^attachment/);
    expect(Buffer.from(await download.arrayBuffer()).equals(PNG)).toBe(true);
  });
});

describe("screenshot upload: existing validation and authorization", () => {
  it("rejects files whose content is not the declared image and unsupported types", async () => {
    const { ticket, key } = await setup("invalid-plain");
    expect((await upload(ticket.id, key, [{ name: "fake.png", bytes: Buffer.from("not an image at all"), type: "image/png" }])).status).toBeGreaterThanOrEqual(400);
    expect((await upload(ticket.id, key, [{ name: "run.exe", bytes: Buffer.from("MZ"), type: "application/x-msdownload" }])).status).toBeGreaterThanOrEqual(400);
    expect(await list(ticket.id, key)).toHaveLength(0);
  });

  it("another tenant's key cannot upload to the ticket", async () => {
    const { ticket } = await setup("tenant-plain");
    const outsider = (await createApiKey("tenant_verify_other_shots", { name: "Outsider", role: "agent" })).key;
    expect([403, 404]).toContain((await upload(ticket.id, outsider, png())).status);
  });
});

describe("screenshot picker validation (client-side feedback; the server re-checks)", () => {
  const file = (name: string, type: string, size: number) => new File([new Uint8Array(size)], name, { type });

  it("accepts the allowed image types and rejects everything else", () => {
    for (const type of SCREENSHOT_ACCEPT.split(",")) expect(screenshotProblem(file("a", type, 10)), type).toBeNull();
    expect(screenshotProblem(file("doc.pdf", "application/pdf", 10))).toMatch(/only PNG, JPEG, WebP or GIF/);
    expect(screenshotProblem(file("x.svg", "image/svg+xml", 10))).toMatch(/only PNG/);
    expect(screenshotProblem(file("no-type", "", 10))).toMatch(/only PNG/);
  });

  it("rejects empty and over-size files, and accepts exactly the limit", () => {
    expect(screenshotProblem(file("empty.png", "image/png", 0))).toMatch(/empty/);
    expect(screenshotProblem(file("big.png", "image/png", SCREENSHOT_LIMITS.maxBytes + 1))).toMatch(/larger than/);
    expect(screenshotProblem(file("edge.png", "image/png", SCREENSHOT_LIMITS.maxBytes))).toBeNull();
  });
});
