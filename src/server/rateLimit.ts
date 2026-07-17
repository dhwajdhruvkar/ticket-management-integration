// =============================================================================
// Rate limiting.
//
// A lightweight in-memory fixed-window limiter for public endpoints (intake,
// auth). For multi-instance production this swaps to a Redis-backed limiter via
// the same interface; the in-memory version keeps single-node and the demo
// protected with zero dependencies.
// =============================================================================

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

export function rateLimit(key: string, limit = 60, windowMs = 60_000): boolean {
  const now = Date.now();
  const existing = windows.get(key);
  if (!existing || now > existing.resetAt) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (existing.count >= limit) return false;
  existing.count++;
  return true;
}

export function clientKey(req: Request, scope: string): string {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = fwd || req.headers.get("x-real-ip") || "local";
  return `${scope}:${ip}`;
}
