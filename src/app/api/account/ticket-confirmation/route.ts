import { NextResponse } from "next/server";
import { z } from "zod";
import { fail, ok, parseBody } from "@/server/http";
import { sharedActionLimit } from "@/server/sharedRateLimit";
import { acknowledgeTicket } from "@/server/services/ticketAcknowledgement";
import { WorkflowError } from "@/server/services/workflowService";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const Input = z.object({ token: z.string().min(32).max(256), action: z.enum(["confirm", "reopen"]) }).strict();
export async function POST(req: Request) {
  if (!await sharedActionLimit(req, "ticket-confirmation")) return fail("Too many attempts, or confirmation is not configured. Try again later.", 429);
  const body = await parseBody(req, Input);
  if (body instanceof NextResponse) return body;
  try { return ok(await acknowledgeTicket(body.token, body.action), { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } }); }
  catch (error) { if (error instanceof WorkflowError) return fail(error.message, error.status); throw error; }
}
