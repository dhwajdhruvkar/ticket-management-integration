import { currentActor } from "@/server/context";
import { fail, ok, readJson } from "@/server/http";
import { can, isAgentRole } from "@/server/auth/rbac";
import { getTicket } from "@/server/services/ticketService";
import { translateText } from "@/server/ai/aiService";
import type { Role } from "@/server/domain/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =============================================================================
// POST /api/v1/tickets/[id]/translate — AI translation of ticket text.
//
// Translates supplied ticket content (subject/body/message) to the requested
// language via the AI service, for agents handling multilingual requests.
// =============================================================================

interface TranslateBody {
  text: string;
  targetLang: string;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await currentActor(req);
  const role = actor.role as Role;
  if (!can(role, "ticket.read")) return fail("Forbidden.", 403);

  const ticket = await getTicket(id);
  if (!ticket) return fail("Ticket not found.", 404);
  // Record security: requesters only ever act on their own tickets.
  if (!isAgentRole(role) && ticket.requesterEmail.toLowerCase() !== (actor.email ?? "").toLowerCase()) {
    return fail("Forbidden.", 403);
  }

  const body = await readJson<TranslateBody>(req);
  if (!body?.text?.trim() || !body?.targetLang?.trim()) {
    return fail("text and targetLang are required.");
  }
  return ok(await translateText(body.text, body.targetLang.trim()));
}
