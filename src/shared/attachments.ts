// Client-safe limits for files attached to a conversation message.
// The server enforces its own (config) size cap; these bound what the reply box allows.
export const CHAT_ATTACHMENT_LIMITS = { maxFiles: 5, maxBytes: 4 * 1024 * 1024 } as const;

/** Screenshots on the new-ticket form: each file is its own request, so 4 MB stays under Vercel's ~4.5 MB body limit. */
export const SCREENSHOT_LIMITS = { maxFiles: 5, maxBytes: 4 * 1024 * 1024 } as const;
export const SCREENSHOT_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

/** Human-readable file size, e.g. "512 B", "48 KB", "3.2 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
