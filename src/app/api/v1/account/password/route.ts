import { NextResponse } from "next/server";
import { z } from "zod";
import { actorContext } from "@/server/guards";
import { fail, ok, parseBody } from "@/server/http";
import {
  accountAccessError,
  changeOwnPassword,
} from "@/server/services/accountAccessService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(1).max(128),
});

export async function POST(req: Request) {
  const ctx = await actorContext(req);
  if (!ctx.actor.id || !ctx.actor.email) return fail("A browser session is required.", 403);
  const body = await parseBody(req, PasswordSchema);
  if (body instanceof NextResponse) return body;
  try {
    await changeOwnPassword(
      ctx.tenantId,
      ctx.actor.id,
      body.currentPassword,
      body.newPassword,
      ctx.actor.email
    );
    return ok({ changed: true });
  } catch (error) {
    const known = accountAccessError(error);
    if (known) return fail(known.message, known.status);
    throw error;
  }
}
