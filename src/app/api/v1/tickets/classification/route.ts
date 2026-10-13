import { z } from "zod";
import { CATEGORIES, classifyTicket } from "@/server/ai/aiService";
import type { TicketCategory } from "@/server/domain/models";
import { isResponse, requirePermission } from "@/server/guards";
import { fail, ok, parseBody } from "@/server/http";
import { clientKey, rateLimit } from "@/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const Input = z.object({
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(50_000),
  category: z.enum(CATEGORIES as [TicketCategory, ...TicketCategory[]]).optional(),
  type: z.enum(["incident", "service_request"]).optional(),
  affectedPeople: z.enum(["one", "team", "many"]).optional(),
  workStopped: z.boolean().optional(),
});

export async function POST(req: Request) {
  const ctx = await requirePermission(req, "ticket.create");
  if (isResponse(ctx)) return ctx;
  if (!rateLimit(clientKey(req, "classification"), 30, 60_000)) return fail("Please wait before checking priority again.", 429);
  const input = await parseBody(req, Input);
  if (isResponse(input)) return input;
  const { subject, body, ...context } = input;
  return ok(await classifyTicket(subject, body, context));
}
