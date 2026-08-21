// =============================================================================
// Structured logging.
//
// Emits one JSON line per event so logs are queryable in any aggregator. When
// SENTRY_DSN is set, error() also forwards to Sentry (via @sentry/nextjs, wired
// in instrumentation) — guarded so the app runs without it installed.
// =============================================================================

import { config } from "../config";

type Level = "debug" | "info" | "warn" | "error";

const REDACTED = "[REDACTED]";
const MAX_LOG_STRING_LENGTH = 4_096;
const SENSITIVE_KEY =
  /authorization|cookie|password|passwd|secret|token|api.?key|key.?hash|account.?key|access.?key|signing.?key|database.?url|connection.?string|private.?key|client.?secret|webhook.?url|dsn/i;

function redactText(value: string): string {
  const safe = value
    .replace(/\bBearer\s+[^\s,;]+/gi, `Bearer ${REDACTED}`)
    .replace(/\bnlk_[A-Za-z0-9_-]+\b/g, REDACTED)
    .replace(
      /([a-z][a-z0-9+.-]*:\/\/)([^@\s/]+)@/gi,
      `$1${REDACTED}@`
    )
    .replace(/(AccountKey=)[^;\s]+/gi, `$1${REDACTED}`)
    .replace(
      /([?&](?:token|api[_-]?key|secret|signature|sig)=)[^&\s]+/gi,
      `$1${REDACTED}`
    );
  return safe.length > MAX_LOG_STRING_LENGTH
    ? `${safe.slice(0, MAX_LOG_STRING_LENGTH)}…[TRUNCATED]`
    : safe;
}

function redactValue(
  value: unknown,
  seen: WeakSet<object>,
  depth: number
): unknown {
  if (typeof value === "string") return redactText(value);
  if (
    value === null ||
    value === undefined ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: redactText(value.message) };
  }
  if (typeof value !== "object") return String(value);
  if (depth >= 6) return "[TRUNCATED]";
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, seen, depth + 1));
  }

  const safe: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    safe[key] = SENSITIVE_KEY.test(key)
      ? REDACTED
      : redactValue(item, seen, depth + 1);
  }
  return safe;
}

/** Redact nested credentials before they reach stdout or an error collector. */
export function redactLogMeta(
  meta?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  return redactValue(meta, new WeakSet<object>(), 0) as Record<string, unknown>;
}

function emit(level: Level, msg: string, meta?: Record<string, unknown>) {
  const safeMeta = redactLogMeta(meta);
  const entry = {
    ...safeMeta,
    ts: new Date().toISOString(),
    level,
    msg: redactText(msg),
  };
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
    const safeMeta = redactLogMeta(meta);
    emit("error", msg, safeMeta);
    if (config.sentryDsn) {
      // Sentry capture is wired in instrumentation when @sentry/nextjs is present.
      const g = globalThis as unknown as { __sentryCapture?: (m: string, x?: unknown) => void };
      g.__sentryCapture?.(redactText(msg), safeMeta);
    }
  },
};
