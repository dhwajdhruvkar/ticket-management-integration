// =============================================================================
// Blob storage port (attachment binaries).
//
// LocalDiskStore is the default: files live under <DATA_DIR>/attachments with
// opaque ids as names, safe for single-node and volume-mounted containers.
// When AZURE_STORAGE_CONNECTION_STRING is configured, the Azure Blob adapter
// (SharedKey REST, see azureBlob.ts) is selected behind the same interface.
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import { config } from "../config";
import { logger } from "../observability/logger";
import { azureBlobFromConfig } from "./azureBlob";

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

class LocalDiskStore implements BlobStore {
  private readonly dir = path.join(process.cwd(), config.dataDir, "attachments");

  private pathFor(key: string): string {
    return path.join(this.dir, validateBlobKey(key));
  }

  async put(key: string, bytes: Buffer, options?: BlobPutOptions): Promise<string> {
    void options;
    fs.mkdirSync(this.dir, { recursive: true });
    const file = this.pathFor(key);
    fs.writeFileSync(file, bytes);
    return `local://${key}`;
  }

  async get(key: string): Promise<Buffer | null> {
    const file = this.pathFor(key);
    try {
      return fs.readFileSync(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async delete(key: string): Promise<boolean> {
    const file = this.pathFor(key);
    try {
      fs.unlinkSync(file);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }
}

let instance: BlobStore | null = null;

export function getBlobStore(): BlobStore {
  if (!instance) {
    if (config.features.blob) {
      instance = azureBlobFromConfig();
      if (instance) logger.info("attachments storage: azure-blob", { container: config.attachmentsContainer });
    }
    if (!instance) instance = new LocalDiskStore();
  }
  return instance;
}
