import { z } from "zod";
import { classifyTicket } from "@/server/ai/aiService";
import { isResponse, requirePermission } from "@/server/guards";
import { fail, ok, parseBody } from "@/server/http";
import { clientKey, rateLimit } from "@/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const Input = z.object({ subject: z.string().trim().min(1).max(300), body: z.string().trim().min(1).max(50_000) });

export async function POST(req: Request) {
  const ctx = await requirePermission(req, "ticket.create");
  if (isResponse(ctx)) return ctx;
  if (!rateLimit(clientKey(req, "classification"), 30, 60_000)) return fail("Please wait before checking priority again.", 429);
  const input = await parseBody(req, Input);
  if (isResponse(input)) return input;
  return ok(await classifyTicket(input.subject, input.body));
}
