// =============================================================================
// Structured logging.
//
// Emits one JSON line per event so logs are queryable in any aggregator. When
// SENTRY_DSN is set, error() also forwards to Sentry (via @sentry/nextjs, wired
// in instrumentation) — guarded so the app runs without it installed.
// =============================================================================

import { config } from "../config";

type Level = "debug" | "info" | "warn" | "error";

function emit(level: Level, msg: string, meta?: Record<string, unknown>) {
  const entry = { ts: new Date().toISOString(), level, msg, ...meta };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => emit("debug", msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => emit("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => {
    emit("error", msg, meta);
    if (config.sentryDsn) {
      // Sentry capture is wired in instrumentation when @sentry/nextjs is present.
      const g = globalThis as unknown as { __sentryCapture?: (m: string, x?: unknown) => void };
      g.__sentryCapture?.(msg, meta);
    }
  },
};
