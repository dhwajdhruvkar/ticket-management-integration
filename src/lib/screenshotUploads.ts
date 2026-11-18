// Upload orchestration for the new-ticket screenshots, kept free of React so its
// rules are unit-tested (tests/screenshotUploadRunner.test.ts):
//   - every selected file has its own upload key, fixed when it is selected and
//     re-sent unchanged on retry, so the server can tell a retry from a second file;
//   - files upload one at a time and independently: one failure never stops the rest;
//   - leaving the screen aborts what is in flight and reports nothing afterwards.

export interface UploadableItem {
  id: string;
  file: File;
  uploadKey: string;
  status: "selected" | "uploading" | "uploaded" | "failed";
}

export interface ItemPatch {
  status?: "selected" | "uploading" | "uploaded" | "failed";
  progress?: number;
  error?: string;
}

export type UploadFn = (ticketId: string, file: File, onProgress: (percent: number) => void, signal: AbortSignal, uploadKey: string) => Promise<unknown>;

/** A fresh random key for one selected file (not derived from its name or size). */
export function createUploadKey(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function createUploadRunner({
  upload,
  patch,
  onBusy = () => {},
}: {
  upload: UploadFn;
  patch: (id: string, patch: ItemPatch) => void;
  /** +1 when a file starts uploading, -1 when it settles. */
  onBusy?: (delta: 1 | -1) => void;
}) {
  const controller = new AbortController();
  let disposed = false;
  const safePatch = (id: string, change: ItemPatch) => { if (!disposed) patch(id, change); };

  async function uploadOne(ticketId: string, item: UploadableItem): Promise<void> {
    if (disposed) return;
    onBusy(1);
    safePatch(item.id, { status: "uploading", progress: 0, error: undefined });
    try {
      await upload(ticketId, item.file, (progress) => safePatch(item.id, { progress }), controller.signal, item.uploadKey);
      safePatch(item.id, { status: "uploaded", progress: 100 });
    } catch (error) {
      if (!controller.signal.aborted) safePatch(item.id, { status: "failed", error: error instanceof Error && error.message ? error.message : "Upload failed." });
    } finally {
      onBusy(-1);
    }
  }

  return {
    uploadOne,
    /** Uploads the items in order; resolves when every one has settled. */
    async uploadAll(ticketId: string, items: UploadableItem[]): Promise<void> {
      for (const item of items) await uploadOne(ticketId, item);
    },
    /** Abort in-flight uploads and ignore anything that settles afterwards. */
    dispose() {
      disposed = true;
      controller.abort();
    },
  };
}
