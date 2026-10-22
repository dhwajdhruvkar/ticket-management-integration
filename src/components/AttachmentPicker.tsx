"use client";

import { useRef } from "react";
import { CHAT_ATTACHMENT_LIMITS, formatBytes } from "@/shared/attachments";
import { useToast } from "./Toast";

// Pick files for a reply. Checks count and size here for quick feedback; the
// server still validates type and size and is the authority.

export function AttachmentPicker({ files, onChange, disabled }: { files: File[]; onChange: (files: File[]) => void; disabled?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const full = files.length >= CHAT_ATTACHMENT_LIMITS.maxFiles;

  function add(picked: FileList | null) {
    if (!picked) return;
    const next = [...files];
    for (const file of Array.from(picked)) {
      if (next.length >= CHAT_ATTACHMENT_LIMITS.maxFiles) {
        toast.error({ title: "Too many files", description: `Attach at most ${CHAT_ATTACHMENT_LIMITS.maxFiles} files per message.` });
        break;
      }
      if (file.size > CHAT_ATTACHMENT_LIMITS.maxBytes) {
        toast.error({ title: "File too large", description: `${file.name} is larger than ${formatBytes(CHAT_ATTACHMENT_LIMITS.maxBytes)}.` });
        continue;
      }
      next.push(file);
    }
    onChange(next);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div className="flex items-center" style={{ gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={disabled || full}
          onClick={() => inputRef.current?.click()}
        >
          <PaperclipIcon /> Attach files
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          tabIndex={-1}
          onChange={(event) => add(event.target.files)}
        />
        <span className="muted" style={{ fontSize: "0.74rem" }}>
          Up to {CHAT_ATTACHMENT_LIMITS.maxFiles} files, {formatBytes(CHAT_ATTACHMENT_LIMITS.maxBytes)} each
        </span>
      </div>
      {files.length > 0 ? (
        <ul aria-label="Files to attach" style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`} className="badge" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span>{file.name}</span>
              <span className="muted">{formatBytes(file.size)}</span>
              <button
                type="button"
                className="btn btn-ghost"
                aria-label={`Remove ${file.name}`}
                disabled={disabled}
                style={{ padding: "0 4px", minHeight: 0 }}
                onClick={() => onChange(files.filter((_, i) => i !== index))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function PaperclipIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
    </svg>
  );
}
