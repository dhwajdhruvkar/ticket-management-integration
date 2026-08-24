import { NextResponse } from "next/server";
import { z } from "zod";
import { clientKey, rateLimit } from "@/server/rateLimit";
import { fail, ok, parseBody } from "@/server/http";
import {
  accountAccessError,
  completeAccountSetup,
} from "@/server/services/accountAccessService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SetupSchema = z.object({
  token: z.string().min(32).max(256),
  password: z.string().min(1).max(128),
});

export async function POST(req: Request) {
  if (!rateLimit(clientKey(req, "account-setup"), 10, 60_000)) {
    return fail("Too many attempts. Try again in a minute.", 429);
  }
  const body = await parseBody(req, SetupSchema);
  if (body instanceof NextResponse) return body;
  try {
    return ok(await completeAccountSetup(body.token, body.password), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const known = accountAccessError(error);
    if (known) return fail(known.message, known.status);
    throw error;
  }
}
