// Edge-safe (no Node imports): used by the proxy and the route rate limiter,
// which must agree on a request's key.
//
// Forwarded headers are client-controlled unless a trusted proxy rewrites them.
// Vercel documents that it OVERWRITES x-forwarded-for (and sets x-real-ip and
// x-vercel-forwarded-for to the same client address) instead of passing on what
// the caller sent, so on Vercel (VERCEL=1) they are trusted. Anywhere else they
// are ignored unless the operator states that a trusted proxy sets them
// (TRUST_PROXY_HEADERS=1); otherwise every caller shares the "local" key, which
// is stricter, never bypassable by a spoofed header.

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const IPV6 = /^[0-9a-f:.]{2,45}$/i;

/** A plausible IPv4/IPv6 literal; anything else (garbage, long strings, lists) is rejected. */
function validIp(value: string | null | undefined): string | null {
  const v = value?.trim();
  if (!v || v.length > 45) return null;
  if (IPV4.test(v)) return v.split(".").every((n) => Number(n) <= 255) ? v : null;
  return (v.match(/:/g)?.length ?? 0) >= 2 && IPV6.test(v) ? v.toLowerCase() : null;
}

function proxyTrusted(): boolean {
  return process.env.VERCEL === "1" || process.env.TRUST_PROXY_HEADERS === "1";
}

export function clientIp(req: { headers: Pick<Headers, "get"> }): string {
  if (!proxyTrusted()) return "local";
  const h = req.headers;
  return (
    validIp(h.get("x-vercel-forwarded-for")?.split(",")[0]) ??
    validIp(h.get("x-forwarded-for")?.split(",")[0]) ??
    validIp(h.get("x-real-ip")) ??
    "local"
  );
}
