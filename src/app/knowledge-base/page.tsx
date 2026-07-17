// Route /knowledge-base — Help Center (requesters read) / KB management
// (agents author). Thin wrapper around KBManager; the Suspense boundary is
// required because that component reads useSearchParams (?focus=<id>).
import { Suspense } from "react";
import KBManager from "@/components/KBManager";

export default function KnowledgeBasePage() {
  // Suspense boundary required because KBManager uses useSearchParams.
  return (
    <Suspense>
      <KBManager />
    </Suspense>
  );
}
