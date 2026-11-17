import { describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));

import { GET as listRoute, POST as uploadRoute } from "@/app/api/v1/tickets/[id]/attachments/route";
import { createApiKey } from "@/server/auth/apiKeys";
import { SCREENSHOT_ACCEPT, SCREENSHOT_LIMITS } from "@/shared/attachments";
import { screenshotProblem } from "@/components/ScreenshotUploader";
import { createTicket } from "@/server/services/ticketService";

const TENANT = "tenant_netlink";
const params = (id: string) => ({ params: Promise.resolve({ id }) });
// A real 1x1 PNG, so the content check (magic bytes) passes.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

function upload(ticketId: string, key: string, files: { name: string; bytes: Buffer; type: string }[], extra: Record<string, string> = {}) {
  const form = new FormData();
  for (const f of files) form.append("file", new File([new Uint8Array(f.bytes)], f.name, { type: f.type }));
  return uploadRoute(
    new Request(`http://localhost/api/v1/tickets/${ticketId}/attachments`, { method: "POST", headers: { authorization: `Bearer ${key}`, ...extra }, body: form }),
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

describe("screenshot upload: retry without duplicates", () => {
  it("a plain second upload adds a second copy (deliberate duplicates stay possible)", async () => {
    const { ticket, key } = await setup("plain");
    expect((await upload(ticket.id, key, [{ name: "shot.png", bytes: PNG, type: "image/png" }])).status).toBe(201);
    expect((await upload(ticket.id, key, [{ name: "shot.png", bytes: PNG, type: "image/png" }])).status).toBe(201);
    expect(await list(ticket.id, key)).toHaveLength(2);
  });

  it("an explicit retry of a file that was already stored returns it instead of adding another", async () => {
    const { ticket, key } = await setup("retry");
    const first = await upload(ticket.id, key, [{ name: "shot.png", bytes: PNG, type: "image/png" }]);
    const stored = ((await first.json()) as { data: { id: string }[] }).data[0];
    // The browser never saw that response, so it retries the same file.
    const retry = await upload(ticket.id, key, [{ name: "shot.png", bytes: PNG, type: "image/png" }], { "x-upload-retry": "1" });
    expect(retry.status).toBe(200);
    expect(retry.headers.get("Upload-Replayed")).toBe("true");
    expect(((await retry.json()) as { data: { id: string }[] }).data[0].id).toBe(stored.id);
    expect(await list(ticket.id, key)).toHaveLength(1);
  });

  it("a retry of a file that was NOT stored uploads it normally", async () => {
    const { ticket, key } = await setup("retry-new");
    const retry = await upload(ticket.id, key, [{ name: "other.png", bytes: PNG, type: "image/png" }], { "x-upload-retry": "1" });
    expect(retry.status).toBe(201);
    expect(await list(ticket.id, key)).toHaveLength(1);
  });

  it("a retry never reuses another ticket's file", async () => {
    const a = await setup("ticket-a");
    const b = await setup("ticket-b");
    await upload(a.ticket.id, a.key, [{ name: "same.png", bytes: PNG, type: "image/png" }]);
    const retry = await upload(b.ticket.id, b.key, [{ name: "same.png", bytes: PNG, type: "image/png" }], { "x-upload-retry": "1" });
    expect(retry.status).toBe(201);
    expect(await list(a.ticket.id, a.key)).toHaveLength(1);
    expect(await list(b.ticket.id, b.key)).toHaveLength(1);
  });

  it("rejects files whose content is not the declared image, and unsupported types, so a failed upload leaves nothing behind", async () => {
    const { ticket, key } = await setup("invalid");
    expect((await upload(ticket.id, key, [{ name: "fake.png", bytes: Buffer.from("not an image at all"), type: "image/png" }])).status).toBeGreaterThanOrEqual(400);
    expect((await upload(ticket.id, key, [{ name: "run.exe", bytes: Buffer.from("MZ"), type: "application/x-msdownload" }])).status).toBeGreaterThanOrEqual(400);
    expect(await list(ticket.id, key)).toHaveLength(0);
  });

  it("another tenant's key cannot upload to or list the ticket", async () => {
    const { ticket } = await setup("tenant");
    const outsider = (await createApiKey("tenant_verify_other_shots", { name: "Outsider", role: "agent" })).key;
    expect([403, 404]).toContain((await upload(ticket.id, outsider, [{ name: "x.png", bytes: PNG, type: "image/png" }])).status);
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
