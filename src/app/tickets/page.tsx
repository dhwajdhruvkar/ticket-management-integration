// Route /tickets — the ticket queue (agents) / "My requests" (requesters).
// Thin wrapper: all logic lives in TicketsExplorer; the Suspense boundary is
// required because that component reads useSearchParams.
import { Suspense } from "react";
import TicketsExplorer from "@/components/TicketsExplorer";

export default function TicketsPage() {
  // Suspense boundary required because TicketsExplorer uses useSearchParams.
  return (
    <Suspense>
      <TicketsExplorer />
    </Suspense>
  );
}
