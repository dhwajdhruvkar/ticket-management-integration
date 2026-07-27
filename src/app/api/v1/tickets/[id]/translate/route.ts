import { fail, ok, readJson } from "@/server/http";
import { isResponse, loadTicket, requirePermission } from "@/server/guards";
import { translateText } from "@/server/ai/aiService";

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
  const ctx = await requirePermission(req, "ticket.read");
  if (isResponse(ctx)) return ctx;

  // Tenant scope for everyone; requesters additionally only see their own.
  const ticket = await loadTicket(ctx, id);
  if (isResponse(ticket)) return ticket;

  const body = await readJson<TranslateBody>(req);
  if (!body?.text?.trim() || !body?.targetLang?.trim()) {
    return fail("text and targetLang are required.");
  }
  return ok(await translateText(body.text, body.targetLang.trim()));
}
