import { createHmac } from "node:crypto";
import { getStore } from "./data";
import { clientKey } from "./rateLimit";

/** Persistent fixed-window limit; no raw IP addresses are stored. Fail closed on missing signing config. */
export async function sharedActionLimit(req: Request, purpose: string, limit = 10, windowMs = 60_000): Promise<boolean> {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) return false;
  const at = Date.now();
  const id = createHmac("sha256", secret).update(`rate:${clientKey(req, purpose)}`).digest("hex");
  const store = await getStore();
  return store.transaction(async (tx) => {
    const current = await tx.publicRateLimits.get(id);
    if (!current) { await tx.publicRateLimits.create({ id, count: 1, resetAt: new Date(at + windowMs).toISOString() }); return true; }
    if (Date.parse(current.resetAt) <= at) { await tx.publicRateLimits.update(id, { count: 1, resetAt: new Date(at + windowMs).toISOString() }); return true; }
    if (current.count >= limit) return false;
    return !!await tx.publicRateLimits.updateIf(id, { count: current.count, resetAt: current.resetAt }, { count: current.count + 1 });
  });
}
