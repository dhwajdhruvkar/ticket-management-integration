// Route /triage — the agent triage queue (rapid classify/assign/prioritize of
// new tickets). Thin wrapper around TriageView.
import { Suspense } from "react";
import TriageView from "@/components/TriageView";

export default function TriagePage() {
  return (
    <Suspense>
      <TriageView />
    </Suspense>
  );
}
