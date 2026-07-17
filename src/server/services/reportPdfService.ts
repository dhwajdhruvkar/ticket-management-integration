// =============================================================================
// PDF report generation (pdfkit).
//
// Renders the same metrics/trends/rows that power the analytics page and CSV
// export into a branded, print-ready PDF. Pure-JS (no headless browser) so it
// runs inside a Node serverless function and the standalone Docker image.
// =============================================================================

import PDFDocument from "pdfkit";
import { getStore } from "../data";
import { computeMetrics, reportRows, type Metrics } from "./metricsService";

const BRAND = "#15806b";
const MUTED = "#6b827d";
const BORDER = "#dde7e4";

export async function buildReportPdf(tenantId: string): Promise<Buffer> {
  const store = await getStore();
  const tenant = await store.tenants.get(tenantId);
  const [metrics, rows] = await Promise.all([computeMetrics(tenantId), reportRows(tenantId)]);
  return render(tenant?.name ?? "Netlink Support", metrics, rows);
}

function pct(ratio: number): string {
  return `${Math.round((ratio ?? 0) * 100)}%`;
}

function mins(m: number): string {
  if (!m || m <= 0) return "—";
  if (m < 60) return `${Math.round(m)}m`;
  if (m < 60 * 24) return `${(m / 60).toFixed(1)}h`;
  return `${(m / (60 * 24)).toFixed(1)}d`;
}

function render(
  orgName: string,
  m: Metrics,
  rows: Record<string, string | number>[]
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;

    // ---- Header -----------------------------------------------------------
    doc.rect(0, 0, doc.page.width, 96).fill(BRAND);
    doc.fillColor("#ffffff").fontSize(20).font("Helvetica-Bold").text(orgName, left, 30);
    doc.fontSize(12).font("Helvetica").text("Service Desk Report", left, 58);
    doc
      .fontSize(9)
      .fillColor("#d6f4e7")
      .text(`Generated ${new Date().toLocaleString()}`, left, 74);
    doc.fillColor("#0b1f1c").font("Helvetica");
    doc.y = 120;

    // ---- KPI grid ---------------------------------------------------------
    sectionTitle(doc, "Key metrics", left);
    const kpis: [string, string][] = [
      ["Total tickets", String(m.totalTickets)],
      ["Open", String(m.openCount)],
      ["Resolved", String(m.resolvedCount)],
      ["AI deflection", pct(m.deflectionRate)],
      ["AI containment", pct(m.containmentRate)],
      ["CSAT", pct(m.csat)],
      ["Avg first response", mins(m.avgFirstResponseMins)],
      ["MTTR", mins(m.mttrMins)],
      ["SLA breached (open)", String(m.slaBreached)],
      ["Reopen rate", pct(m.reopenRate)],
      ["Agent hours saved", `${m.agentHoursSaved.toFixed(1)}h`],
      ["Est. cost saved", `$${Math.round(m.costSaved).toLocaleString()}`],
    ];
    const cols = 3;
    const cellW = width / cols;
    const cellH = 46;
    let gy = doc.y;
    kpis.forEach(([label, value], i) => {
      const col = i % cols;
      const rowIdx = Math.floor(i / cols);
      const x = left + col * cellW;
      const y = gy + rowIdx * cellH;
      doc.roundedRect(x + 2, y, cellW - 6, cellH - 6, 6).lineWidth(1).stroke(BORDER);
      doc.fillColor(MUTED).fontSize(8).font("Helvetica").text(label.toUpperCase(), x + 12, y + 9, { width: cellW - 24 });
      doc.fillColor("#0b1f1c").fontSize(16).font("Helvetica-Bold").text(value, x + 12, y + 20, { width: cellW - 24 });
    });
    doc.y = gy + Math.ceil(kpis.length / cols) * cellH + 8;

    // ---- SLA compliance table --------------------------------------------
    sectionTitle(doc, "SLA compliance by priority", left);
    tableHeader(doc, left, ["Priority", "Finished", "Met", "Compliance"], [0.4, 0.2, 0.2, 0.2], width);
    for (const s of m.slaCompliance) {
      tableRow(doc, left, [s.priority, String(s.total), String(s.met), pct(s.compliance)], [0.4, 0.2, 0.2, 0.2], width);
    }
    doc.moveDown(1);

    // ---- Ticket appendix --------------------------------------------------
    sectionTitle(doc, `Tickets (${rows.length})`, left);
    const cw = [0.16, 0.13, 0.16, 0.13, 0.14, 0.28];
    tableHeader(doc, left, ["Reference", "Type", "Status", "Priority", "Category", "Requester"], cw, width);
    for (const r of rows) {
      if (doc.y > doc.page.height - doc.page.margins.bottom - 24) {
        doc.addPage();
        tableHeader(doc, left, ["Reference", "Type", "Status", "Priority", "Category", "Requester"], cw, width);
      }
      tableRow(
        doc,
        left,
        [
          String(r.reference),
          String(r.type),
          String(r.status),
          String(r.priority),
          String(r.category),
          String(r.requester),
        ],
        cw,
        width
      );
    }

    doc.end();
  });
}

type Doc = PDFKit.PDFDocument;

function sectionTitle(doc: Doc, title: string, left: number): void {
  doc.moveDown(0.6);
  doc.fillColor(BRAND).fontSize(12).font("Helvetica-Bold").text(title, left);
  doc.moveDown(0.3);
  doc.fillColor("#0b1f1c").font("Helvetica");
}

function tableHeader(doc: Doc, left: number, cells: string[], widths: number[], total: number): void {
  const y = doc.y;
  doc.fontSize(8).font("Helvetica-Bold").fillColor(MUTED);
  let x = left;
  cells.forEach((c, i) => {
    const w = widths[i] * total;
    doc.text(c.toUpperCase(), x + 2, y, { width: w - 4, ellipsis: true });
    x += w;
  });
  doc.moveTo(left, y + 12).lineTo(left + total, y + 12).lineWidth(1).stroke(BORDER);
  doc.y = y + 16;
  doc.fillColor("#0b1f1c").font("Helvetica");
}

function tableRow(doc: Doc, left: number, cells: string[], widths: number[], total: number): void {
  const y = doc.y;
  doc.fontSize(8.5).font("Helvetica").fillColor("#36514c");
  let x = left;
  cells.forEach((c, i) => {
    const w = widths[i] * total;
    doc.text(c, x + 2, y, { width: w - 4, ellipsis: true, lineBreak: false });
    x += w;
  });
  doc.y = y + 14;
}
