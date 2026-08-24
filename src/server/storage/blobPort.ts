// Storage contract shared by attachment backends and their selector.
// Keeping the port independent prevents an adapter <-> selector import cycle.

export interface BlobStore {
  /** Persist bytes under the given key; returns the storage URL/locator. */
  put(key: string, bytes: Buffer, options?: BlobPutOptions): Promise<string>;
  /** Read bytes for a key. Null when missing. */
  get(key: string): Promise<Buffer | null>;
  /** Delete a key. False means it was already absent; storage failures throw. */
  delete(key: string): Promise<boolean>;
}

export interface BlobPutOptions {
  contentType?: string;
}

/** Blob keys are opaque server-generated ids, never caller-controlled paths. */
export function validateBlobKey(key: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(key)) {
    throw new Error("Invalid blob key.");
  }
  return key;
}
