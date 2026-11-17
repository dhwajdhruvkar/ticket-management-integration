"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SCREENSHOT_ACCEPT, SCREENSHOT_LIMITS, formatBytes } from "@/shared/attachments";
import { useToast } from "./Toast";

// Screenshot picker for the new-ticket form. Controlled: the parent owns the
// items and the upload; this component only selects, previews, removes and
// replaces files, and shows per-file status. Client checks are for quick
// feedback only; the server still validates type, size and file content.

export interface ScreenshotItem {
  id: string;
  file: File;
  previewUrl: string;
  status: "selected" | "uploading" | "uploaded" | "failed";
  progress: number;
  error?: string;
}

const ALLOWED_TYPES = SCREENSHOT_ACCEPT.split(",");
let counter = 0;
const nextId = () => `shot-${Date.now().toString(36)}-${++counter}`;

/** Why a file cannot be used as a screenshot, or null if it can. */
export function screenshotProblem(file: File): string | null {
  if (!ALLOWED_TYPES.includes(file.type)) return `${file.name}: only PNG, JPEG, WebP or GIF images can be attached.`;
  if (file.size > SCREENSHOT_LIMITS.maxBytes) return `${file.name} is larger than ${formatBytes(SCREENSHOT_LIMITS.maxBytes)}.`;
  if (file.size === 0) return `${file.name} is empty.`;
  return null;
}

export function ScreenshotUploader({
  items,
  onChange,
  onRetry,
  disabled,
  canReplace = true,
}: {
  items: ScreenshotItem[];
  onChange: (items: ScreenshotItem[]) => void;
  onRetry?: (id: string) => void;
  disabled?: boolean;
  /** False once the ticket exists: a replacement file would never be uploaded, so only Retry and Remove make sense. */
  canReplace?: boolean;
}) {
  const addRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const replaceId = useRef<string | null>(null);
  const urls = useRef(new Map<string, string>());
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const toast = useToast();
  const full = items.length >= SCREENSHOT_LIMITS.maxFiles;

  // Revoke preview URLs of items that left the list (removed, replaced or cleared by the parent), and all of them on unmount.
  useEffect(() => {
    const live = new Set(items.map((item) => item.id));
    for (const [id, url] of urls.current) {
      if (!live.has(id)) {
        URL.revokeObjectURL(url);
        urls.current.delete(id);
      }
    }
  }, [items]);
  useEffect(() => {
    const map = urls.current;
    return () => {
      for (const url of map.values()) URL.revokeObjectURL(url);
      map.clear();
    };
  }, []);

  const make = useCallback((file: File): ScreenshotItem => {
    const id = nextId();
    const previewUrl = URL.createObjectURL(file);
    urls.current.set(id, previewUrl);
    return { id, file, previewUrl, status: "selected", progress: 0 };
  }, []);

  function add(picked: FileList | File[] | null) {
    if (!picked) return;
    const next = [...items];
    const problems: string[] = [];
    for (const file of Array.from(picked)) {
      if (next.length >= SCREENSHOT_LIMITS.maxFiles) {
        problems.push(`Attach at most ${SCREENSHOT_LIMITS.maxFiles} screenshots.`);
        break;
      }
      const problem = screenshotProblem(file);
      if (problem) problems.push(problem);
      else next.push(make(file));
    }
    setError(problems.join(" "));
    if (problems.length) toast.error({ title: "Some files were not added", description: problems[0] });
    onChange(next);
    if (addRef.current) addRef.current.value = "";
  }

  function replace(picked: FileList | null) {
    const file = picked?.[0];
    const id = replaceId.current;
    if (replaceRef.current) replaceRef.current.value = "";
    if (!file || !id) return;
    const problem = screenshotProblem(file);
    setError(problem ?? "");
    if (problem) return;
    onChange(items.map((item) => (item.id === id ? make(file) : item)));
  }

  const editable = (item: ScreenshotItem) => !disabled && (item.status === "selected" || item.status === "failed");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        onDragOver={(event) => { event.preventDefault(); if (!disabled && !full) setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); if (!disabled && !full) add(event.dataTransfer.files); }}
        style={{
          border: `1px dashed ${dragging ? "var(--brand-500)" : "var(--border)"}`,
          background: dragging ? "var(--brand-50)" : "var(--surface-2)",
          borderRadius: 10,
          padding: "0.9rem",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 6,
          textAlign: "center",
        }}
      >
        <button type="button" className="btn btn-ghost" disabled={disabled || full} onClick={() => addRef.current?.click()}>
          Add screenshots
        </button>
        <input ref={addRef} type="file" accept={SCREENSHOT_ACCEPT} multiple hidden tabIndex={-1} onChange={(event) => add(event.target.files)} />
        <input ref={replaceRef} type="file" accept={SCREENSHOT_ACCEPT} hidden tabIndex={-1} onChange={(event) => replace(event.target.files)} />
        <span className="muted" style={{ fontSize: "0.76rem" }}>
          or drop images here · PNG, JPEG, WebP or GIF · up to {SCREENSHOT_LIMITS.maxFiles} files, {formatBytes(SCREENSHOT_LIMITS.maxBytes)} each
        </span>
        <span className="muted" style={{ fontSize: "0.74rem", maxWidth: 520 }}>
          Don&apos;t include passwords, API keys, access tokens or unnecessary personal information. Crop or blur sensitive areas. Screenshots are stored in Netlink Support and shared only with the support team.
        </span>
      </div>
      {error ? <p role="alert" style={{ margin: 0, fontSize: "0.8rem", color: "var(--danger-fg)" }}>{error}</p> : null}
      {items.length > 0 ? (
        <ul aria-label="Selected screenshots" className="grid grid-cols-2 sm:grid-cols-4" style={{ listStyle: "none", padding: 0, margin: 0, gap: 8 }}>
          {items.map((item) => (
            <li key={item.id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 6, display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview, not an optimisable asset */}
              <img src={item.previewUrl} alt={`Preview of ${item.file.name}`} style={{ width: "100%", height: 90, objectFit: "cover", borderRadius: 6, background: "var(--surface-3)" }} />
              <span style={{ fontSize: "0.74rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={item.file.name}>{item.file.name}</span>
              <span className="muted" style={{ fontSize: "0.7rem" }}>
                {formatBytes(item.file.size)} · {item.status === "selected" ? "Ready" : item.status === "uploading" ? `Uploading ${item.progress}%` : item.status === "uploaded" ? "Uploaded" : "Failed"}
              </span>
              {item.status === "uploading" ? (
                <div role="progressbar" aria-label={`Uploading ${item.file.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={item.progress} style={{ height: 4, background: "var(--surface-3)", borderRadius: 2 }}>
                  <div style={{ width: `${item.progress}%`, height: "100%", background: "var(--brand-500)", borderRadius: 2 }} />
                </div>
              ) : null}
              {item.status === "failed" && item.error ? <span role="alert" style={{ fontSize: "0.7rem", color: "var(--danger-fg)" }}>{item.error}</span> : null}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {item.status === "failed" && onRetry ? (
                  <button type="button" className="btn" disabled={disabled} aria-label={`Retry upload of ${item.file.name}`} onClick={() => onRetry(item.id)}>Retry</button>
                ) : null}
                {editable(item) ? (
                  <>
                    {canReplace ? (
                      <button type="button" className="btn btn-ghost" aria-label={`Replace ${item.file.name}`} onClick={() => { replaceId.current = item.id; replaceRef.current?.click(); }}>Replace</button>
                    ) : null}
                    <button type="button" className="btn btn-ghost" aria-label={`Remove ${item.file.name}`} onClick={() => onChange(items.filter((other) => other.id !== item.id))}>Remove</button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
