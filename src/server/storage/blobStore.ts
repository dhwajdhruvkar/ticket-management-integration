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
  put(key: string, bytes: Buffer): Promise<string>;
  /** Read bytes for a key. Null when missing. */
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<boolean>;
}

class LocalDiskStore implements BlobStore {
  private readonly dir = path.join(process.cwd(), config.dataDir, "attachments");

  private pathFor(key: string): string {
    // Keys are server-generated ids — reject anything path-like defensively.
    const safe = key.replace(/[^a-zA-Z0-9_-]/g, "");
    return path.join(this.dir, safe);
  }

  async put(key: string, bytes: Buffer): Promise<string> {
    fs.mkdirSync(this.dir, { recursive: true });
    const file = this.pathFor(key);
    fs.writeFileSync(file, bytes);
    return `local://${key}`;
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return fs.readFileSync(this.pathFor(key));
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<boolean> {
    try {
      fs.unlinkSync(this.pathFor(key));
      return true;
    } catch {
      return false;
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
