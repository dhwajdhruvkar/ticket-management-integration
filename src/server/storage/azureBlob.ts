// =============================================================================
// Azure Blob Storage adapter (SharedKey REST, no SDK dependency).
//
// Implements the BlobStore port against the Blob service using SharedKey
// authorization (HMAC-SHA256 over the canonicalized request). The container is
// created on first use (409 = already exists). Selected automatically when
// AZURE_STORAGE_CONNECTION_STRING is set; otherwise local disk is used.
// Signing canonicalization is exported pure for unit testing.
// =============================================================================

import { createHmac } from "node:crypto";
import { config } from "../config";
import { logger } from "../observability/logger";
import type { BlobStore } from "./blobStore";

const API_VERSION = "2021-08-06";

export interface AzureBlobAccount {
  accountName: string;
  accountKey: string;
  endpointSuffix: string;
  protocol: string;
}

/** Parse an Azure storage connection string into its parts. */
export function parseConnectionString(conn: string): AzureBlobAccount | null {
  const parts = new Map<string, string>();
  for (const segment of conn.split(";")) {
    const eq = segment.indexOf("=");
    if (eq > 0) parts.set(segment.slice(0, eq).trim(), segment.slice(eq + 1).trim());
  }
  const accountName = parts.get("AccountName");
  const accountKey = parts.get("AccountKey");
  if (!accountName || !accountKey) return null;
  return {
    accountName,
    accountKey,
    endpointSuffix: parts.get("EndpointSuffix") ?? "core.windows.net",
    protocol: parts.get("DefaultEndpointsProtocol") ?? "https",
  };
}

export interface SignInput {
  verb: string;
  contentLength?: number;
  contentType?: string;
  /** All x-ms-* headers on the request. */
  msHeaders: Record<string, string>;
  accountName: string;
  /** /container/blob path (leading slash, no query). */
  resourcePath: string;
  /** Canonicalized query params (e.g. { restype: "container" }). */
  query?: Record<string, string>;
}

/** Build the SharedKey string-to-sign (Blob service, 2015-02-21+ format). */
export function buildStringToSign(input: SignInput): string {
  const headers = Object.entries(input.msHeaders)
    .map(([k, v]) => [k.toLowerCase(), v.trim()] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}:${v}`)
    .join("\n");

  const canonicalizedResource =
    `/${input.accountName}${input.resourcePath}` +
    Object.entries(input.query ?? {})
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `\n${k.toLowerCase()}:${v}`)
      .join("");

  return [
    input.verb.toUpperCase(),
    "", // Content-Encoding
    "", // Content-Language
    input.contentLength && input.contentLength > 0 ? String(input.contentLength) : "",
    "", // Content-MD5
    input.contentType ?? "",
    "", // Date (we use x-ms-date)
    "", // If-Modified-Since
    "", // If-Match
    "", // If-None-Match
    "", // If-Unmodified-Since
    "", // Range
    headers,
    canonicalizedResource,
  ].join("\n");
}

export function signSharedKey(stringToSign: string, accountKeyBase64: string): string {
  return createHmac("sha256", Buffer.from(accountKeyBase64, "base64"))
    .update(stringToSign, "utf8")
    .digest("base64");
}

export class AzureBlobStore implements BlobStore {
  private containerReady = false;

  constructor(
    private readonly account: AzureBlobAccount,
    private readonly container: string
  ) {}

  private url(path: string, query = ""): string {
    const { protocol, accountName, endpointSuffix } = this.account;
    return `${protocol}://${accountName}.blob.${endpointSuffix}${path}${query}`;
  }

  private async request(
    verb: string,
    resourcePath: string,
    opts: {
      body?: Buffer;
      contentType?: string;
      extraMsHeaders?: Record<string, string>;
      query?: Record<string, string>;
    } = {}
  ): Promise<Response> {
    const msHeaders: Record<string, string> = {
      "x-ms-date": new Date().toUTCString(),
      "x-ms-version": API_VERSION,
      ...opts.extraMsHeaders,
    };
    const stringToSign = buildStringToSign({
      verb,
      contentLength: opts.body?.length,
      contentType: opts.contentType,
      msHeaders,
      accountName: this.account.accountName,
      resourcePath,
      query: opts.query,
    });
    const signature = signSharedKey(stringToSign, this.account.accountKey);

    const queryString = opts.query
      ? "?" + Object.entries(opts.query).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")
      : "";
    return fetch(this.url(resourcePath, queryString), {
      method: verb,
      headers: {
        ...msHeaders,
        ...(opts.contentType ? { "Content-Type": opts.contentType } : {}),
        Authorization: `SharedKey ${this.account.accountName}:${signature}`,
      },
      body: opts.body ? new Uint8Array(opts.body) : undefined,
    });
  }

  private async ensureContainer(): Promise<void> {
    if (this.containerReady) return;
    const res = await this.request("PUT", `/${this.container}`, {
      query: { restype: "container" },
    });
    if (res.ok || res.status === 409) {
      this.containerReady = true;
      return;
    }
    throw new Error(`Azure container create failed: ${res.status} ${await res.text()}`);
  }

  async put(key: string, bytes: Buffer): Promise<string> {
    await this.ensureContainer();
    const res = await this.request("PUT", `/${this.container}/${key}`, {
      body: bytes,
      contentType: "application/octet-stream",
      extraMsHeaders: { "x-ms-blob-type": "BlockBlob" },
    });
    if (!res.ok) throw new Error(`Azure PutBlob failed: ${res.status} ${await res.text()}`);
    return this.url(`/${this.container}/${key}`);
  }

  async get(key: string): Promise<Buffer | null> {
    const res = await this.request("GET", `/${this.container}/${key}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Azure GetBlob failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async delete(key: string): Promise<boolean> {
    const res = await this.request("DELETE", `/${this.container}/${key}`);
    return res.ok || res.status === 404;
  }
}

/** Build the Azure adapter from config, or null when not configured/parsable. */
export function azureBlobFromConfig(): AzureBlobStore | null {
  if (!config.blobConnString) return null;
  const account = parseConnectionString(config.blobConnString);
  if (!account) {
    logger.warn("AZURE_STORAGE_CONNECTION_STRING is set but unparsable; using local disk");
    return null;
  }
  return new AzureBlobStore(account, config.attachmentsContainer);
}
