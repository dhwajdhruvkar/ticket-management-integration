import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));

import {
  DELETE as deleteRoute,
  GET as downloadRoute,
} from "@/app/api/v1/attachments/[id]/route";
import {
  GET as listRoute,
  POST as uploadRoute,
} from "@/app/api/v1/tickets/[id]/attachments/route";
import { createApiKey } from "@/server/auth/apiKeys";
import { getStore } from "@/server/data";
import { now } from "@/server/domain/ids";
import {
  deleteAttachment,
  listAttachments,
  readAttachment,
  saveAttachment,
  saveAttachments,
} from "@/server/services/attachmentService";
import { createTicket } from "@/server/services/ticketService";
import {
  AzureBlobStore,
  parseConnectionString,
  validateContainerName,
} from "@/server/storage/azureBlob";
import { getBlobStore, validateBlobKey, type BlobPutOptions, type BlobStore } from "@/server/storage/blobStore";
import { config } from "@/server/config";

const TENANT = "tenant_netlink";

function routeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function apiRequest(
  url: string,
  key: string,
  init: Omit<RequestInit, "headers"> & { headers?: HeadersInit } = {}
): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${key}`);
  return new Request(url, { ...init, headers });
}

class MemoryBlob implements BlobStore {
  readonly blobs = new Map<string, Buffer>();
  readonly contentTypes = new Map<string, string | undefined>();
  puts = 0;
  gets = 0;
  failPutAt = 0;
  failDelete = false;

  async put(key: string, bytes: Buffer, options?: BlobPutOptions): Promise<string> {
    this.puts++;
    if (this.failPutAt === this.puts) throw new Error("simulated blob write failure");
    this.blobs.set(key, Buffer.from(bytes));
    this.contentTypes.set(key, options?.contentType);
    return `memory://${key}`;
  }

  async get(key: string): Promise<Buffer | null> {
    this.gets++;
    const value = this.blobs.get(key);
    return value ? Buffer.from(value) : null;
  }

  async delete(key: string): Promise<boolean> {
    if (this.failDelete) throw new Error("simulated blob delete failure");
    return this.blobs.delete(key);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Phase 9 attachment API", () => {
  it("uploads, lists, downloads, and deletes through tenant-scoped API keys", async () => {
    const store = await getStore();
    const marker = Date.now().toString(36);
    const otherTenantId = `tenant_attachment_${marker}`;
    const ts = now();
    await store.tenants.create({
      id: otherTenantId,
      name: "Attachment isolation tenant",
      slug: `attachment-isolation-${marker}`,
      brand: null,
      isInternal: false,
      createdAt: ts,
      updatedAt: ts,
    });

    const ticket = await createTicket(TENANT, {
      subject: `Attachment API ${marker}`,
      body: "Verify production attachment behavior.",
      requesterEmail: `attachment-${marker}@example.test`,
    });
    const own = await createApiKey(TENANT, {
      name: `Attachment API ${marker}`,
      role: "agent",
    });
    const outsider = await createApiKey(otherTenantId, {
      name: `Attachment outsider ${marker}`,
      role: "agent",
    });

    const form = new FormData();
    const payload = Buffer.from("phase-nine-payload", "utf8");
    form.append(
      "file",
      new File([payload], "../../quarterly report.txt", { type: "text/plain" })
    );
    const upload = await uploadRoute(
      apiRequest(`http://localhost/api/v1/tickets/${ticket.id}/attachments`, own.key, {
        method: "POST",
        body: form,
      }),
      routeParams(ticket.id)
    );
    expect(upload.status).toBe(201);
    const uploadBody = (await upload.json()) as {
      ok: boolean;
      data: Array<{
        id: string;
        ticketId: string;
        fileName: string;
        mimeType: string;
        sizeBytes: number;
        blobUrl: string;
      }>;
    };
    expect(uploadBody.ok).toBe(true);
    expect(uploadBody.data).toHaveLength(1);
    const attachment = uploadBody.data[0];
    expect(attachment).toMatchObject({
      ticketId: ticket.id,
      fileName: "quarterly report.txt",
      mimeType: "text/plain",
      sizeBytes: payload.length,
    });
    expect(attachment.blobUrl).toBe(`local://${attachment.id}`);
    await expect(store.attachments.get(attachment.id)).resolves.toMatchObject(attachment);

    const listing = await listRoute(
      apiRequest(`http://localhost/api/v1/tickets/${ticket.id}/attachments`, own.key),
      routeParams(ticket.id)
    );
    expect(listing.status).toBe(200);
    await expect(listing.json()).resolves.toMatchObject({
      ok: true,
      data: [{ id: attachment.id, ticketId: ticket.id }],
      meta: { total: 1 },
    });

    const invalid = await downloadRoute(
      apiRequest(`http://localhost/api/v1/attachments/${attachment.id}`, "nlk_invalid"),
      routeParams(attachment.id)
    );
    expect(invalid.status).toBe(403);

    const crossTenantDownload = await downloadRoute(
      apiRequest(
        `http://localhost/api/v1/attachments/${attachment.id}`,
        outsider.key
      ),
      routeParams(attachment.id)
    );
    expect(crossTenantDownload.status).toBe(404);

    const crossTenantDelete = await deleteRoute(
      apiRequest(
        `http://localhost/api/v1/attachments/${attachment.id}`,
        outsider.key,
        { method: "DELETE" }
      ),
      routeParams(attachment.id)
    );
    expect(crossTenantDelete.status).toBe(404);
    await expect(store.attachments.get(attachment.id)).resolves.not.toBeNull();

    const download = await downloadRoute(
      apiRequest(`http://localhost/api/v1/attachments/${attachment.id}`, own.key),
      routeParams(attachment.id)
    );
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("text/plain");
    expect(download.headers.get("content-disposition")).toContain("quarterly%20report.txt");
    expect(download.headers.get("x-content-type-options")).toBe("nosniff");
    expect(download.headers.get("content-security-policy")).toContain("sandbox");
    expect(Buffer.from(await download.arrayBuffer())).toEqual(payload);

    const removed = await deleteRoute(
      apiRequest(`http://localhost/api/v1/attachments/${attachment.id}`, own.key, {
        method: "DELETE",
      }),
      routeParams(attachment.id)
    );
    expect(removed.status).toBe(200);
    await expect(store.attachments.get(attachment.id)).resolves.toBeNull();
    await expect(getBlobStore().get(attachment.id)).resolves.toBeNull();

    const audit = await store.audit.list({ tenantId: TENANT });
    expect(
      audit.some(
        (row) => row.action === "ticket.attachment.added" && row.ticketId === ticket.id
      )
    ).toBe(true);
    expect(
      audit.some(
        (row) => row.action === "ticket.attachment.removed" && row.ticketId === ticket.id
      )
    ).toBe(true);
  });

  it("rejects a declared multipart body larger than the request-level cap", async () => {
    const marker = Date.now().toString(36);
    const ticket = await createTicket(TENANT, {
      subject: `Bounded attachment ${marker}`,
      body: "The parser must reject before buffering.",
      requesterEmail: `bounded-${marker}@example.test`,
    });
    const { key } = await createApiKey(TENANT, {
      name: `Bounded attachment ${marker}`,
      role: "agent",
    });
    const declared =
      config.attachmentMaxBytes * 5 + 1024 * 1024 + 1;
    const response = await uploadRoute(
      apiRequest(`http://localhost/api/v1/tickets/${ticket.id}/attachments`, key, {
        method: "POST",
        headers: {
          "content-type": "multipart/form-data; boundary=phase9",
          "content-length": String(declared),
        },
        body: "--phase9--",
      }),
      routeParams(ticket.id)
    );
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "Request body too large.",
    });
  });

  it("returns 503 instead of using local disk when attachments are disabled", async () => {
    const marker = Date.now().toString(36);
    const ticket = await createTicket(TENANT, {
      subject: `Disabled attachment ${marker}`,
      body: "Production must fail closed without a durable blob backend.",
      requesterEmail: `disabled-${marker}@example.test`,
    });
    const { key } = await createApiKey(TENANT, {
      name: `Disabled attachment ${marker}`,
      role: "agent",
    });
    const mutableFeatures = config.features as { attachments: boolean };
    const previous = mutableFeatures.attachments;
    mutableFeatures.attachments = false;
    try {
      const form = new FormData();
      form.append(
        "file",
        new File(["not-written"], "deferred.txt", { type: "text/plain" })
      );
      const response = await uploadRoute(
        apiRequest(`http://localhost/api/v1/tickets/${ticket.id}/attachments`, key, {
          method: "POST",
          body: form,
        }),
        routeParams(ticket.id)
      );
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        error: "Attachment storage is not enabled for this deployment.",
      });
    } finally {
      mutableFeatures.attachments = previous;
    }
  });
});

describe("Phase 9 attachment consistency", () => {
  it("validates every file before writing the first blob", async () => {
    const marker = Date.now().toString(36);
    const ticket = await createTicket(TENANT, {
      subject: `Attachment validation ${marker}`,
      body: "Unsafe files must reject the whole request.",
      requesterEmail: `validation-${marker}@example.test`,
    });
    const blobs = new MemoryBlob();

    await expect(
      saveAttachments(
        TENANT,
        ticket.id,
        [
          { fileName: "safe.txt", mimeType: "text/plain", bytes: Buffer.from("safe") },
          {
            fileName: "payload.exe",
            mimeType: "application/octet-stream",
            bytes: Buffer.from("unsafe"),
          },
        ],
        "phase9-test",
        { blobStore: blobs }
      )
    ).rejects.toThrow(".exe files are not allowed");
    expect(blobs.puts).toBe(0);
  });

  it("rolls back earlier files when a later blob write fails", async () => {
    const marker = Date.now().toString(36);
    const ticket = await createTicket(TENANT, {
      subject: `Atomic attachments ${marker}`,
      body: "No partial multi-file uploads.",
      requesterEmail: `atomic-${marker}@example.test`,
    });
    const blobs = new MemoryBlob();
    blobs.failPutAt = 2;

    await expect(
      saveAttachments(
        TENANT,
        ticket.id,
        [
          { fileName: "one.txt", mimeType: "text/plain", bytes: Buffer.from("one") },
          { fileName: "two.txt", mimeType: "text/plain", bytes: Buffer.from("two") },
        ],
        "phase9-test",
        { blobStore: blobs }
      )
    ).rejects.toThrow("simulated blob write failure");

    expect(blobs.blobs.size).toBe(0);
    await expect(listAttachments(TENANT, ticket.id)).resolves.toMatchObject({
      data: [],
      total: 0,
    });
  });

  it("deletes a newly written blob when metadata persistence fails", async () => {
    const marker = Date.now().toString(36);
    const ticket = await createTicket(TENANT, {
      subject: `Metadata compensation ${marker}`,
      body: "A failed row insert must not orphan a blob.",
      requesterEmail: `metadata-${marker}@example.test`,
    });
    const store = await getStore();
    const create = vi
      .spyOn(store.attachments, "create")
      .mockRejectedValueOnce(new Error("simulated metadata failure"));
    const blobs = new MemoryBlob();
    try {
      await expect(
        saveAttachment(
          TENANT,
          ticket.id,
          { fileName: "row.txt", mimeType: "text/plain", bytes: Buffer.from("row") },
          "phase9-test",
          { blobStore: blobs }
        )
      ).rejects.toThrow("simulated metadata failure");
      expect(blobs.blobs.size).toBe(0);
    } finally {
      create.mockRestore();
    }
  });

  it("checks tenant ownership before blob reads and restores metadata on delete failure", async () => {
    const marker = Date.now().toString(36);
    const ticket = await createTicket(TENANT, {
      subject: `Attachment compensation ${marker}`,
      body: "Storage failures must not orphan metadata.",
      requesterEmail: `compensation-${marker}@example.test`,
    });
    const blobs = new MemoryBlob();
    const record = await saveAttachment(
      TENANT,
      ticket.id,
      { fileName: "evidence.json", mimeType: "application/json", bytes: Buffer.from("{}") },
      "phase9-test",
      { blobStore: blobs }
    );
    expect(blobs.contentTypes.get(record.id)).toBe("application/json");

    await expect(
      readAttachment("tenant_not_owner", record.id, { blobStore: blobs })
    ).resolves.toBeNull();
    expect(blobs.gets).toBe(0);

    blobs.failDelete = true;
    await expect(
      deleteAttachment(TENANT, record.id, "phase9-test", { blobStore: blobs })
    ).rejects.toThrow("simulated blob delete failure");
    const store = await getStore();
    await expect(store.attachments.get(record.id)).resolves.toMatchObject({ id: record.id });

    blobs.failDelete = false;
    await expect(
      deleteAttachment(TENANT, record.id, "phase9-test", { blobStore: blobs })
    ).resolves.toBe(true);
    await expect(store.attachments.get(record.id)).resolves.toBeNull();
    expect(blobs.blobs.has(record.id)).toBe(false);
  });
});

describe("Phase 9 Azure Blob adapter", () => {
  it("performs create, upload, download, and delete with SharedKey authentication", async () => {
    const responses = [
      new Response(null, { status: 409 }),
      new Response(null, { status: 201 }),
      new Response("azure-bytes", { status: 200 }),
      new Response(null, { status: 202 }),
      new Response(null, { status: 404 }),
      new Response(null, { status: 500 }),
    ];
    const fetchMock = vi.fn().mockImplementation(async () => responses.shift());
    vi.stubGlobal("fetch", fetchMock);
    const account = parseConnectionString(
      "DefaultEndpointsProtocol=https;AccountName=acme;AccountKey=a2V5cGFydA==;EndpointSuffix=core.windows.net"
    );
    expect(account).not.toBeNull();
    const blobs = new AzureBlobStore(account!, "attachments");

    await expect(
      blobs.put("att_azure", Buffer.from("azure-bytes"), { contentType: "text/plain" })
    ).resolves.toBe("https://acme.blob.core.windows.net/attachments/att_azure");
    await expect(blobs.get("att_azure")).resolves.toEqual(Buffer.from("azure-bytes"));
    await expect(blobs.delete("att_azure")).resolves.toBe(true);
    await expect(blobs.delete("att_missing")).resolves.toBe(false);
    await expect(blobs.delete("att_failed")).rejects.toThrow("Azure DeleteBlob failed: 500");

    expect(fetchMock).toHaveBeenCalledTimes(6);
    const [putUrl, putInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(putUrl).toBe("https://acme.blob.core.windows.net/attachments/att_azure");
    expect(putInit.method).toBe("PUT");
    const putHeaders = new Headers(putInit.headers);
    expect(putHeaders.get("content-type")).toBe("text/plain");
    expect(putHeaders.get("x-ms-blob-type")).toBe("BlockBlob");
    expect(putHeaders.get("authorization")).toMatch(/^SharedKey acme:/);
  });

  it("rejects unsafe keys, invalid containers, and malformed connection strings", () => {
    expect(() => validateBlobKey("../../secret")).toThrow("Invalid blob key");
    expect(() => validateContainerName("Bad--Container")).toThrow(
      "valid Azure container name"
    );
    expect(
      parseConnectionString(
        "DefaultEndpointsProtocol=ftp;AccountName=ACME;AccountKey=not-base64!"
      )
    ).toBeNull();
  });
});
