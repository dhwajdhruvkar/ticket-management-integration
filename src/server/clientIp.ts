// Edge-safe (no Node imports): used by the proxy and the route rate limiter,
// which must agree on a request's key.
export function clientIp(req: { headers: Pick<Headers, "get"> }): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip") || "local";
}
