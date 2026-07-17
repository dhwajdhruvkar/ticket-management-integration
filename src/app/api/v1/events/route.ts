import { currentActor, currentTenantId } from "@/server/context";
import { subscribeEvents } from "@/server/events/bus";
import { isAgentRole } from "@/server/auth/rbac";
import type { Role } from "@/server/domain/models";

// =============================================================================
// GET /api/v1/events — Server-Sent Events stream.
//
// Pushes notification and ticket-update events to the signed-in user:
//   agents receive tenant-wide events; requesters only their own (their
//   notifications + tickets they raised). Heartbeat every 25s keeps proxies
//   from closing the stream. Single-node bus (see server/events/bus.ts).
// =============================================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const [tenantId, actor] = await Promise.all([currentTenantId(req), currentActor(req)]);
  const agent = isAgentRole(actor.role as Role);
  const email = (actor.email ?? "").toLowerCase();

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Stream already closed.
        }
      };

      send({ type: "connected", at: new Date().toISOString() });

      const unsubscribe = subscribeEvents((event) => {
        if (event.tenantId !== tenantId) return;
        // Internal-note typing stays agent-only.
        if (event.type === "ticket.typing" && event.visibility === "internal" && !agent) return;
        if (!agent) {
          const mine =
            (event.type === "notification" && event.toAddress?.toLowerCase() === email) ||
            ((event.type === "ticket.updated" || event.type === "ticket.typing") &&
              event.requesterEmail?.toLowerCase() === email);
          if (!mine) return;
        }
        send(event);
      });

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          clearInterval(heartbeat);
        }
      }, 25_000);

      const close = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      };
      req.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
