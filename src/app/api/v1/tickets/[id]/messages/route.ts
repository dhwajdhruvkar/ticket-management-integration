import { fail, ok, parseBody, readMultipartFormData } from "@/server/http";
import { isResponse, loadTicket, requirePermission } from "@/server/guards";
import { can, isAgentRole, isTicketSubmitterRole } from "@/server/auth/rbac";
import { agentReply, requesterReply } from "@/server/services/agentActions";
import { AttachmentError, saveAttachments, validateAttachmentFiles, type AttachmentInput } from "@/server/services/attachmentService";
import { config } from "@/server/config";
import { newId } from "@/server/domain/ids";
import { CHAT_ATTACHMENT_LIMITS } from "@/shared/attachments";
import { z } from "zod";
import { WorkflowError } from "@/server/services/workflowService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =============================================================================
// POST /api/v1/tickets/[id]/messages — add a reply or internal note.
//
// Agents can post public replies or internal notes on any ticket; requesters
// can post public replies on their own tickets only (which un-parks/reopens as
// needed). Routes to agentReply/requesterReply based on the actor's role.
//
// Accepts JSON, or multipart/form-data with optional "file" parts (max 5). Files
// are checked before the message is posted, so a bad file never leaves a message
// behind. Files on an internal note stay hidden from requesters.
// =============================================================================

const MessageBody = z.object({ body: z.string().trim().min(1).max(20000), visibility: z.enum(["public", "internal"]).optional(), asRequester: z.boolean().optional() }).strict();
type MessageInput = z.infer<typeof MessageBody>;

const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;
const MAX_MULTIPART_BYTES = config.attachmentMaxBytes * CHAT_ATTACHMENT_LIMITS.maxFiles + MULTIPART_OVERHEAD_BYTES;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermission(req, "ticket.read");
  if (isResponse(ctx)) return ctx;
  if (isTicketSubmitterRole(ctx.role)) {
    return fail("Ticket submitter integrations are read-only after creation.", 403);
  }

  const multipart = (req.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data");
  let payload: MessageInput;
  let files: File[] = [];
  if (multipart) {
    const declared = Number(req.headers.get("content-length") ?? 0);
    if (declared > MAX_MULTIPART_BYTES) return fail("The upload is too large.", 413);
    let form: FormData;
    try {
      const parsedForm = await readMultipartFormData(req, MAX_MULTIPART_BYTES);
      if (isResponse(parsedForm)) return parsedForm;
      form = parsedForm;
    } catch {
      return fail("The upload is too large or malformed.", 400);
    }
    const visibility = form.get("visibility");
    const parsed = MessageBody.safeParse({
      body: String(form.get("body") ?? ""),
      visibility: typeof visibility === "string" ? visibility : undefined,
      asRequester: form.get("asRequester") === "true",
    });
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid message.", 400);
    payload = parsed.data;
    files = form.getAll("file").filter((f): f is File => f instanceof File);
    if (files.length > CHAT_ATTACHMENT_LIMITS.maxFiles) return fail(`At most ${CHAT_ATTACHMENT_LIMITS.maxFiles} files per message.`, 400);
  } else {
    const parsedBody = await parseBody(req, MessageBody);
    if (isResponse(parsedBody)) return parsedBody;
    payload = parsedBody;
  }

  // Tenant scope for everyone; requesters additionally only see their own.
  const ticket = await loadTicket(ctx, id);
  if (isResponse(ticket)) return ticket;

  // Requesters can only reply publicly on their own tickets.
  if (payload.asRequester && isAgentRole(ctx.role)) return fail("Staff cannot impersonate the requester.", 403);
  try {
    const requester = !isAgentRole(ctx.role);
    if (requester && payload.visibility === "internal") return fail("Requesters can only send public replies.", 403);
    if (!requester && !can(ctx.role, "ticket.write")) return fail("Forbidden.", 403);

    let inputs: AttachmentInput[] = [];
    if (files.length) {
      if (!config.features.attachments) return fail("Attachment storage is not enabled for this deployment.", 503);
      inputs = await Promise.all(
        files.map(async (file) => ({
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          bytes: Buffer.from(await file.arrayBuffer()),
        }))
      );
      validateAttachmentFiles(inputs);
    }

    const messageId = newId("msg");
    const updated = requester
      ? await requesterReply(id, { name: ctx.actor.name, role: "requester" }, payload.body, messageId)
      : await agentReply(id, ctx.actor, payload.body, payload.visibility ?? "public", messageId);
    if (!updated) return fail("Ticket not found.", 404);

    if (inputs.length) {
      try {
        await saveAttachments(ticket.tenantId, id, inputs, ctx.actor.name, {}, { messageId, internal: payload.visibility === "internal" });
      } catch (error) {
        // The message is already posted; say so, so the sender does not resend it.
        const reason = error instanceof AttachmentError ? error.message : "the storage service failed";
        return fail(`Your message was sent, but the attachments could not be saved: ${reason}`, 502);
      }
    }
    return ok(updated);
  } catch (error) {
    if (error instanceof WorkflowError) return fail(error.message, error.status);
    if (error instanceof AttachmentError) return fail(error.message, error.status);
    throw error;
  }
}
