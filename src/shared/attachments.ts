// Client-safe limits for files attached to a conversation message.
// The server enforces its own (config) size cap; these bound what the reply box allows.
export const CHAT_ATTACHMENT_LIMITS = { maxFiles: 5, maxBytes: 4 * 1024 * 1024 } as const;
