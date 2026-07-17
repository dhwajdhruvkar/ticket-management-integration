import { currentActor } from "@/server/context";
import { fail, ok, readJson } from "@/server/http";
import { can } from "@/server/auth/rbac";
// =============================================================================
// POST /api/v1/problems/[id]/actions — problem workflow actions (agent+).
//
// Dispatches by `action`: link/unlink incident, AI root-cause suggestion,
// publish workaround to the KB (KEDB), raise a permanent-fix change, add a note.
// =============================================================================
import {
  addNote,
  aiSuggestRootCause,
  linkIncident,
  publishWorkaroundToKb,
  raiseChange,
  unlinkIncident,
} from "@/server/services/problemService";
import type { Role } from "@/server/domain/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  action: "ai_root_cause" | "publish_workaround" | "raise_change" | "add_note" | "link_incident" | "unlink_incident";
  body?: string;
  ticketId?: string;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await currentActor(req);
  const role = actor.role as Role;
  const payload = await readJson<Body>(req);
  if (!payload?.action) return fail("action is required.");

  switch (payload.action) {
    case "ai_root_cause": {
      if (!can(role, "problem.write")) return fail("Forbidden.", 403);
      const result = await aiSuggestRootCause(id);
      return result ? ok(result) : fail("Problem not found.", 404);
    }
    case "publish_workaround": {
      if (!can(role, "kb.write")) return fail("Forbidden.", 403);
      const updated = await publishWorkaroundToKb(id, actor.name);
      return updated ? ok(updated) : fail("No workaround to publish.", 400);
    }
    case "raise_change": {
      if (!can(role, "change.write")) return fail("Forbidden.", 403);
      const result = await raiseChange(id, actor.name);
      return result ? ok(result) : fail("Problem not found.", 404);
    }
    case "add_note": {
      if (!can(role, "problem.write")) return fail("Forbidden.", 403);
      if (!payload.body?.trim()) return fail("body is required.");
      const updated = await addNote(id, actor.name, payload.body);
      return updated ? ok(updated) : fail("Problem not found.", 404);
    }
    case "link_incident": {
      if (!can(role, "problem.write")) return fail("Forbidden.", 403);
      if (!payload.ticketId) return fail("ticketId is required.");
      const linked = await linkIncident(id, payload.ticketId, actor.name);
      return linked ? ok({ linked: true }) : fail("Could not link incident.", 400);
    }
    case "unlink_incident": {
      if (!can(role, "problem.write")) return fail("Forbidden.", 403);
      if (!payload.ticketId) return fail("ticketId is required.");
      const unlinked = await unlinkIncident(id, payload.ticketId, actor.name);
      return unlinked ? ok({ unlinked: true }) : fail("Could not unlink incident.", 400);
    }
    default:
      return fail("Unknown action.");
  }
}
