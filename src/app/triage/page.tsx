// Route /triage — the dispatcher queue (rapid classify/assign/prioritize of new
// and escalated tickets). Thin wrapper around TriageView.
import { Suspense } from "react";
import TriageView from "@/components/TriageView";

export default function TriagePage() {
  return (
    <Suspense>
      <TriageView />
    </Suspense>
  );
}
