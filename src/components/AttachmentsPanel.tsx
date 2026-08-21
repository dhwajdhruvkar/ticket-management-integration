"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiGetAll } from "@/lib/api";
import { useToast } from "./Toast";
import type { AttachmentRow } from "@/server/domain/models";

// =============================================================================
// AttachmentsPanel — list + upload for a ticket's files.
//
// Rendered in the ticket detail side pane for agents and requesters alike.
// Uploads are multipart to /api/v1/tickets/[id]/attachments; downloads go
// through /api/v1/attachments/[id] (Content-Disposition: attachment).
// =============================================================================

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AttachmentsPanel({
  ticketId,
  canDelete,
}: {
  ticketId: string;
  canDelete?: boolean;
}) {
  const toast = useToast();
  const [items, setItems] = useState<AttachmentRow[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(() => {
    apiGetAll<AttachmentRow>(`/tickets/${ticketId}/attachments`)
      .then(setItems)
      .catch(() => setItems([]));
  }, [ticketId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const form = new FormData();
      for (const f of Array.from(files).slice(0, 5)) form.append("file", f);
      const res = await fetch(`/api/v1/tickets/${ticketId}/attachments`, {
        method: "POST",
        body: form,
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Upload failed.");
      toast.success({ title: files.length > 1 ? "Files attached" : "File attached" });
      refresh();
    } catch (err) {
      toast.error({
        title: "Upload failed",
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function remove(att: AttachmentRow) {
    if (!confirm(`Delete "${att.fileName}"?`)) return;
    try {
      const res = await fetch(`/api/v1/attachments/${att.id}`, { method: "DELETE" });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Delete failed.");
      refresh();
      toast.info({ title: "Attachment deleted" });
    } catch (err) {
      toast.error({
        title: "Could not delete",
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "1.25rem 0 10px" }}>
        <span className="label" style={{ margin: 0 }}>
          Attachments{items && items.length > 0 ? ` (${items.length})` : ""}
        </span>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ fontSize: "0.72rem", padding: "0.25rem 0.6rem" }}
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          <ClipIcon /> <span style={{ marginLeft: 4 }}>{uploading ? "Uploading…" : "Attach"}</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(e) => void upload(e.target.files)}
        />
      </div>

      {items === null ? (
        <div className="skel" style={{ height: 34, borderRadius: 8 }} />
      ) : items.length === 0 ? (
        <p className="muted" style={{ fontSize: "0.76rem", margin: 0 }}>
          No files attached.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {items.map((a) => (
            <div
              key={a.id}
              className="panel-2"
              style={{ padding: "0.5rem 0.65rem", display: "flex", alignItems: "center", gap: 8 }}
            >
              <span aria-hidden style={{ color: "var(--muted)", display: "inline-flex", flexShrink: 0 }}>
                <FileIcon mime={a.mimeType} />
              </span>
              <a
                href={`/api/v1/attachments/${a.id}`}
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: "0.8rem",
                  fontWeight: 600,
                  color: "var(--brand-700)",
                  textDecoration: "none",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={a.fileName}
              >
                {a.fileName}
              </a>
              <span className="muted" style={{ fontSize: "0.68rem", flexShrink: 0 }}>
                {formatBytes(a.sizeBytes)}
              </span>
              {canDelete ? (
                <button
                  type="button"
                  aria-label={`Delete ${a.fileName}`}
                  onClick={() => void remove(a)}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "var(--muted)",
                    cursor: "pointer",
                    padding: 2,
                    display: "inline-flex",
                    flexShrink: 0,
                  }}
                >
                  <TrashIcon />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* icons */
const ic = {
  width: 13,
  height: 13,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function ClipIcon() {
  return (
    <svg {...ic}>
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg {...ic}>
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    </svg>
  );
}
function FileIcon({ mime }: { mime: string }) {
  if (mime.startsWith("image/")) {
    return (
      <svg {...ic} width={15} height={15}>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="M21 15l-5-5L5 21" />
      </svg>
    );
  }
  return (
    <svg {...ic} width={15} height={15}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}
