import { currentActor } from "@/server/context";
import { fail, ok } from "@/server/http";
import { can, isAgentRole } from "@/server/auth/rbac";
import { getStore } from "@/server/data";
import { getTicket } from "@/server/services/ticketService";
import { summarizeThread } from "@/server/ai/aiService";
import type { Role } from "@/server/domain/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await currentActor(req);
  const role = actor.role as Role;
  if (!can(role, "ticket.read")) return fail("Forbidden.", 403);

  const ticket = await getTicket(id);
  if (!ticket) return fail("Ticket not found.", 404);
  // Record security: requesters only ever see their own tickets.
  if (!isAgentRole(role) && ticket.requesterEmail.toLowerCase() !== (actor.email ?? "").toLowerCase()) {
    return fail("Forbidden.", 403);
  }

  const store = await getStore();
  const messages = (await store.messages.list({ ticketId: id })).sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  const summary = await summarizeThread(ticket, messages);
  return ok({ summary });
}
