// Route /settings — workspace configuration (SLA, routing, automations, macros,
// custom fields, departments, API keys, appearance). Thin wrapper around
// SettingsView, which enforces role-based section visibility.
import { Suspense } from "react";
import SettingsView from "@/components/SettingsView";

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsView />
    </Suspense>
  );
}
