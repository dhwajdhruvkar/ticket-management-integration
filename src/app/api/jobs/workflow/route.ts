import { timingSafeEqual } from "node:crypto";
import { fail, ok } from "@/server/http";
import { runWorkflowMaintenance } from "@/server/jobs/workflowMaintenance";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization") ?? "";
  if (!secret || secret.length < 32 || header.length > 512) return fail("Unauthorized.", 401);
  const expected = Buffer.from(`Bearer ${secret}`), supplied = Buffer.from(header);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return fail("Unauthorized.", 401);
  try { return ok(await runWorkflowMaintenance("cron"), { headers: { "Cache-Control": "no-store" } }); }
  catch { return fail("Workflow maintenance failed. Check deployment logs.", 503); }
}
