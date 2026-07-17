import { NextResponse } from "next/server";
import { currentActor, currentTenantId } from "@/server/context";
import { fail, ok } from "@/server/http";
import { can } from "@/server/auth/rbac";
import { reportRows } from "@/server/services/metricsService";
import { buildReportPdf } from "@/server/services/reportPdfService";
import type { Role } from "@/server/domain/models";

// Report builder. `?format=csv` streams a CSV download and `?format=pdf` a
// branded PDF (the same content a scheduled monthly email export renders);
// default returns JSON.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const tenantId = await currentTenantId(req);
  const actor = await currentActor(req);
  if (!can(actor.role as Role, "report.read")) return fail("Forbidden.", 403);

  const url = new URL(req.url);
  const format = url.searchParams.get("format");

  if (format === "pdf") {
    const pdf = await buildReportPdf(tenantId);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="netlink-support-report.pdf"`,
      },
    });
  }

  const rows = await reportRows(tenantId);
  if (format !== "csv") return ok(rows);

  const headers = rows.length ? Object.keys(rows[0]) : [];
  const csv = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(",")),
  ].join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="netlink-support-report.csv"`,
    },
  });
}

function csvCell(value: string | number | undefined): string {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
