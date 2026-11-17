import { NextResponse } from "next/server";
import { config } from "@/server/config";
import pkg from "../../../../../package.json";

// Health + capability probe for the production API surface (/api/v1).
// Reports which optional capabilities are active in the current environment.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "netlink-support",
    version: pkg.version,
    dataDriver: config.dataDriver,
    productionProfile: {
      authentication: config.authMode,
      attachmentStorage: config.attachmentStorage,
    },
    features: config.features,
    time: new Date().toISOString(),
  });
}
