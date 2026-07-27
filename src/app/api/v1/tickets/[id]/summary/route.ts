import { fail, ok } from "@/server/http";
import { isResponse, loadTicket, requirePermission } from "@/server/guards";
import { isAgentRole } from "@/server/auth/rbac";
import { getStore } from "@/server/data";
import { summarizeThread } from "@/server/ai/aiService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermission(req, "ticket.read");
  if (isResponse(ctx)) return ctx;

  // Tenant scope for everyone; requesters additionally only see their own.
  const ticket = await loadTicket(ctx, id);
  if (isResponse(ticket)) return ticket;

  const store = await getStore();
  const all = await store.messages.list({ ticketId: id });
  // A summary of internal notes would leak them in prose, so requesters get a
  // summary of the public conversation only.
  const visible = isAgentRole(ctx.role) ? all : all.filter((m) => m.visibility !== "internal");
  const messages = visible.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  if (messages.length === 0) return fail("Nothing to summarise on this ticket yet.", 409);
  const summary = await summarizeThread(ticket, messages);
  return ok({ summary });
}
