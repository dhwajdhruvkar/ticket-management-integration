import { isResponse, requirePermission } from "@/server/guards";
import { fail, ok } from "@/server/http";
import { searchRequesters } from "@/server/services/requesterSearch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ctx = await requirePermission(req, "report.read");
  if (isResponse(ctx)) return ctx;
  const query = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (query.length > 254) return fail("Search must be at most 254 characters.");
  return ok(await searchRequesters(ctx.tenantId, query), { headers: { "Cache-Control": "no-store" } });
}
