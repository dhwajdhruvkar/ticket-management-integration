// Route /audit — the tamper-evident audit trail (agent+). Thin wrapper around
// AuditViewer, which lists the hash-chained records and verifies chain integrity.
import AuditViewer from "@/components/AuditViewer";

export default function AuditPage() {
  return <AuditViewer />;
}
