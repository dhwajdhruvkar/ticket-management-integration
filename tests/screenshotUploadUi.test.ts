// Screenshot upload experience, tested without a DOM: the orchestration runner,
// the real XHR upload function against a fake XMLHttpRequest, the file-selection
// rules, and the uploader's rendered states (react-dom/server).
// Not covered here (needs a real browser): clicking the hidden file input,
// drag-and-drop, and object-URL previews of real files. See "Manual checks".
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScreenshotUploader, screenshotProblem, selectScreenshots, type ScreenshotItem } from "@/components/ScreenshotUploader";
import { ToastProvider } from "@/components/Toast";
import { uploadTicketAttachment, ApiError } from "@/lib/api";
import { createUploadKey, createUploadRunner, type UploadableItem, type UploadFn, type ItemPatch } from "@/lib/screenshotUploads";
import { SCREENSHOT_LIMITS } from "@/shared/attachments";

const file = (name: string, type = "image/png", size = 10) => new File([new Uint8Array(size)], name, { type });
const item = (name: string, key: string): UploadableItem => ({ id: `id-${name}-${key}`, file: file(name), uploadKey: key, status: "selected" });

function harness(upload: UploadFn) {
  const patches: { id: string; patch: ItemPatch }[] = [];
  let busy = 0;
  const runner = createUploadRunner({ upload, patch: (id, patch) => patches.push({ id, patch }), onBusy: (d) => { busy += d; } });
  const last = (id: string) => patches.filter((p) => p.id === id).at(-1)?.patch;
  return { runner, patches, last, busy: () => busy };
}

describe("upload keys", () => {
  it("every selected file gets a different key, even with the same name and size", () => {
    const keys = new Set(Array.from({ length: 200 }, () => createUploadKey()));
    expect(keys.size).toBe(200);
    for (const key of keys) expect(key).toMatch(/^[A-Za-z0-9_-]{16,64}$/); // what the server accepts
  });
});

describe("upload runner", () => {
  it("shows progress, then success", async () => {
    const h = harness(async (_t, _f, onProgress) => { onProgress(30); onProgress(100); });
    await h.runner.uploadAll("tkt_1", [item("a.png", "key-aaaaaaaaaaaaaaaa")]);
    expect(h.patches.map((p) => p.patch)).toEqual([
      { status: "uploading", progress: 0, error: undefined }, { progress: 30 }, { progress: 100 }, { status: "uploaded", progress: 100 },
    ]);
    expect(h.busy()).toBe(0);
  });

  it("marks a failed upload with its message and leaves the others to finish independently", async () => {
    const calls: string[] = [];
    const h = harness(async (_t, f) => { calls.push(f.name); if (f.name === "bad.png") throw new ApiError("The file is too large to upload.", 413); });
    const [one, bad, three] = [item("one.png", "key-1111111111111111"), item("bad.png", "key-2222222222222222"), item("three.png", "key-3333333333333333")];
    await h.runner.uploadAll("tkt_1", [one, bad, three]);
    expect(calls).toEqual(["one.png", "bad.png", "three.png"]); // the failure did not stop the rest
    expect(h.last(one.id)?.status).toBe("uploaded");
    expect(h.last(bad.id)).toEqual({ status: "failed", error: "The file is too large to upload." });
    expect(h.last(three.id)?.status).toBe("uploaded");
    expect(h.busy()).toBe(0);
  });

  it("a final state with some failures reports exactly which files failed", async () => {
    const h = harness(async (_t, f) => { if (/bad/.test(f.name)) throw new Error("boom"); });
    const items = ["ok1", "bad1", "ok2", "bad2"].map((n) => item(`${n}.png`, `key-${n}${"x".repeat(14)}`));
    await h.runner.uploadAll("t", items);
    const final = ["ok1", "bad1", "ok2", "bad2"].map((n, i) => [n, h.last(items[i].id)?.status]);
    expect(final).toEqual([["ok1", "uploaded"], ["bad1", "failed"], ["ok2", "uploaded"], ["bad2", "failed"]]);
  });

  it("retrying a failed file re-sends the SAME key; different files keep different keys", async () => {
    const seen: { name: string; key: string }[] = [];
    let failFirst = true;
    const h = harness(async (_t, f, _p, _s, key) => { seen.push({ name: f.name, key }); if (failFirst) { failFirst = false; throw new Error("network"); } });
    const a = item("same.png", "key-aaaaaaaaaaaaaaaa");
    const b = item("same.png", "key-bbbbbbbbbbbbbbbb"); // same name and size, a different selected file
    await h.runner.uploadAll("tkt_1", [a, b]);
    expect(h.last(a.id)?.status).toBe("failed");
    await h.runner.uploadOne("tkt_1", { ...a, status: "failed" }); // the user presses Retry
    expect(seen.map((s) => s.key)).toEqual(["key-aaaaaaaaaaaaaaaa", "key-bbbbbbbbbbbbbbbb", "key-aaaaaaaaaaaaaaaa"]);
    expect(h.last(a.id)?.status).toBe("uploaded");
  });

  it("uploads to the ticket it was given", async () => {
    const tickets: string[] = [];
    const h = harness(async (t) => { tickets.push(t); });
    await h.runner.uploadAll("tkt_42", [item("a.png", "key-aaaaaaaaaaaaaaaa")]);
    expect(tickets).toEqual(["tkt_42"]);
  });

  it("leaving the screen aborts the upload in flight and reports nothing afterwards", async () => {
    let signal!: AbortSignal;
    let release!: () => void;
    const h = harness((_t, _f, onProgress, s) => new Promise((resolve, reject) => {
      signal = s;
      onProgress(10);
      release = () => reject(new ApiError("Upload cancelled.", 0));
      s.addEventListener("abort", () => reject(new ApiError("Upload cancelled.", 0)));
      void resolve;
    }));
    const done = h.runner.uploadAll("t", [item("a.png", "key-aaaaaaaaaaaaaaaa"), item("b.png", "key-bbbbbbbbbbbbbbbb")]);
    await Promise.resolve();
    const before = h.patches.length;
    h.runner.dispose();
    await done;
    expect(signal.aborted).toBe(true);
    expect(h.patches.length).toBe(before); // no "failed" patch after unmount, and the second file never started
    release?.();
    expect(h.busy()).toBe(0);
  });

  it("does nothing after dispose", async () => {
    const upload = vi.fn();
    const h = harness(upload);
    h.runner.dispose();
    await h.runner.uploadOne("t", item("a.png", "key-aaaaaaaaaaaaaaaa"));
    expect(upload).not.toHaveBeenCalled();
  });
});

// --- the real XHR upload function ------------------------------------------------------------
class FakeXhr {
  static instances: FakeXhr[] = [];
  headers: Record<string, string> = {};
  upload: { onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
  onload?: () => void; onerror?: () => void; onabort?: () => void;
  status = 0; responseText = "";
  method = ""; url = ""; body: FormData | null = null; aborted = false;
  constructor() { FakeXhr.instances.push(this); }
  open(method: string, url: string) { this.method = method; this.url = url; }
  setRequestHeader(k: string, v: string) { this.headers[k] = v; }
  send(body: FormData) { this.body = body; }
  abort() { this.aborted = true; this.onabort?.(); }
  respond(status: number, body: unknown) { this.status = status; this.responseText = typeof body === "string" ? body : JSON.stringify(body); this.onload?.(); }
}

describe("uploadTicketAttachment (XHR)", () => {
  afterEach(() => { vi.unstubAllGlobals(); FakeXhr.instances = []; });
  const start = (options: { key?: string; signal?: AbortSignal; onProgress?: (n: number) => void } = {}) => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    const promise = uploadTicketAttachment("tkt/1", file("shot.png"), options.onProgress, options.signal, options.key);
    return { promise, xhr: FakeXhr.instances.at(-1)! };
  };

  it("posts one file to the ticket and sends the upload key header", async () => {
    const { promise, xhr } = start({ key: "key-aaaaaaaaaaaaaaaa" });
    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe("/api/v1/tickets/tkt%2F1/attachments");
    expect(xhr.headers["X-Upload-Key"]).toBe("key-aaaaaaaaaaaaaaaa");
    expect(xhr.body?.getAll("file")).toHaveLength(1);
    xhr.respond(201, { ok: true, data: [{ id: "att_1" }] });
    await expect(promise).resolves.toEqual({ id: "att_1" });
  });

  it("sends no key header when none is given", () => {
    const { xhr } = start();
    expect(xhr.headers["X-Upload-Key"]).toBeUndefined();
  });

  it("reports progress as whole percentages, capped at 100", async () => {
    const seen: number[] = [];
    const { promise, xhr } = start({ onProgress: (n) => seen.push(n) });
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 3 });
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 3, total: 2 });
    xhr.upload.onprogress?.({ lengthComputable: false, loaded: 1, total: 0 });
    xhr.respond(200, { ok: true, data: [{ id: "att_1" }] });
    await promise;
    expect(seen).toEqual([33, 100, 100]); // last 100 is the completion notice
  });

  it("treats a replayed 200 like a success", async () => {
    const { promise, xhr } = start({ key: "key-aaaaaaaaaaaaaaaa" });
    xhr.respond(200, { ok: true, data: [{ id: "att_existing" }] });
    await expect(promise).resolves.toEqual({ id: "att_existing" });
  });

  it("surfaces the server's message, and sensible messages for proxy errors", async () => {
    const a = start(); a.xhr.respond(400, { ok: false, error: "File content does not match its type." });
    await expect(a.promise).rejects.toMatchObject({ message: "File content does not match its type.", status: 400 });
    const b = start(); b.xhr.respond(413, "<html>too big</html>");
    await expect(b.promise).rejects.toMatchObject({ message: "The file is too large to upload.", status: 413 });
    const c = start(); c.xhr.respond(429, "");
    await expect(c.promise).rejects.toMatchObject({ status: 429 });
    const d = start(); d.xhr.respond(502, "bad gateway");
    await expect(d.promise).rejects.toMatchObject({ message: "Upload failed (502)." });
    const e = start(); e.xhr.onerror?.();
    await expect(e.promise).rejects.toMatchObject({ status: 0 });
  });

  it("aborts when the signal fires, and refuses to start on an aborted signal", async () => {
    const ctl = new AbortController();
    const { promise, xhr } = start({ signal: ctl.signal });
    ctl.abort();
    await expect(promise).rejects.toMatchObject({ message: "Upload cancelled." });
    expect(xhr.aborted).toBe(true);
    const already = new AbortController(); already.abort();
    const second = start({ signal: already.signal });
    await expect(second.promise).rejects.toMatchObject({ message: "Upload cancelled." });
    expect(second.xhr.body).toBeNull(); // nothing was sent
  });
});

// --- selection rules ---------------------------------------------------------------------------
describe("selecting screenshots", () => {
  it("accepts several valid images at once", () => {
    const { accepted, problems } = selectScreenshots(0, [file("a.png"), file("b.jpg", "image/jpeg"), file("c.webp", "image/webp")]);
    expect(accepted.map((f) => f.name)).toEqual(["a.png", "b.jpg", "c.webp"]);
    expect(problems).toEqual([]);
  });

  it("rejects invalid files with a reason and keeps the valid ones", () => {
    const { accepted, problems } = selectScreenshots(0, [file("ok.png"), file("doc.pdf", "application/pdf"), file("empty.png", "image/png", 0), file("huge.png", "image/png", SCREENSHOT_LIMITS.maxBytes + 1), file("x.svg", "image/svg+xml")]);
    expect(accepted.map((f) => f.name)).toEqual(["ok.png"]);
    expect(problems).toHaveLength(4);
    expect(problems.join(" ")).toMatch(/only PNG, JPEG, WebP or GIF/);
    expect(problems.join(" ")).toMatch(/empty/);
    expect(problems.join(" ")).toMatch(/larger than/);
  });

  it("stops at the maximum number of files, counting those already selected", () => {
    const many = Array.from({ length: 8 }, (_, i) => file(`s${i}.png`));
    const first = selectScreenshots(0, many);
    expect(first.accepted).toHaveLength(SCREENSHOT_LIMITS.maxFiles);
    expect(first.problems).toEqual([`Attach at most ${SCREENSHOT_LIMITS.maxFiles} screenshots.`]);
    expect(selectScreenshots(SCREENSHOT_LIMITS.maxFiles - 1, many).accepted).toHaveLength(1);
    expect(selectScreenshots(SCREENSHOT_LIMITS.maxFiles, [file("x.png")]).accepted).toHaveLength(0);
    expect(screenshotProblem(file("ok.png"))).toBeNull();
  });
});

// --- rendered states ----------------------------------------------------------------------------
describe("ScreenshotUploader rendering", () => {
  const shot = (name: string, status: ScreenshotItem["status"], extra: Partial<ScreenshotItem> = {}): ScreenshotItem =>
    ({ id: `id-${name}`, uploadKey: `key-${name}-aaaaaaaaaaaa`, file: file(name), previewUrl: `blob:preview/${name}`, status, progress: 0, ...extra });
  const render = (items: ScreenshotItem[], props: Record<string, unknown> = {}) =>
    renderToStaticMarkup(createElement(ToastProvider, null, createElement(ScreenshotUploader, { items, onChange: () => {}, onRetry: () => {}, ...props })));

  it("shows a preview with an accessible name, the file name and size, and Ready for a selected file, with Replace and Remove", () => {
    const html = render([shot("one.png", "selected")]);
    expect(html).toContain('src="blob:preview/one.png"');
    expect(html).toContain('alt="Preview of one.png"');
    expect(html).toContain("Ready");
    expect(html).toContain('aria-label="Remove one.png"');
    expect(html).toContain('aria-label="Replace one.png"');
  });

  it("shows progress while uploading, with an accessible progress bar, and no edit buttons", () => {
    const html = render([shot("up.png", "uploading", { progress: 40 })]);
    expect(html).toContain("Uploading 40%");
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="40"');
    expect(html).not.toContain('aria-label="Remove up.png"');
  });

  it("shows Uploaded for a finished file, and a failure message with Retry and Remove for a failed one", () => {
    const html = render([shot("done.png", "uploaded", { progress: 100 }), shot("bad.png", "failed", { error: "Upload failed (502)." })]);
    expect(html).toContain("Uploaded");
    expect(html).toContain("Upload failed (502).");
    expect(html).toContain('aria-label="Retry upload of bad.png"');
    expect(html).toContain('aria-label="Remove bad.png"');
    expect(html).not.toContain('aria-label="Retry upload of done.png"');
  });

  it("hides Replace once the ticket exists (a replacement would never be uploaded), and disables controls while busy", () => {
    const afterCreate = render([shot("bad.png", "failed", { error: "x" })], { canReplace: false });
    expect(afterCreate).not.toContain("Replace bad.png");
    expect(afterCreate).toContain("Retry upload of bad.png");
    const busy = render([shot("a.png", "selected")], { disabled: true });
    expect(busy).not.toContain('aria-label="Remove a.png"');
    expect(busy).toMatch(/<button[^>]*disabled[^>]*>Add screenshots/);
  });

  it("tells the user the limits and not to include secrets, and disables Add at the limit", () => {
    const html = render(Array.from({ length: SCREENSHOT_LIMITS.maxFiles }, (_, i) => shot(`s${i}.png`, "selected")));
    expect(html).toContain("Don&#x27;t include passwords");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Add screenshots/);
  });
});
