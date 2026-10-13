"use client";

import { useEffect, useState } from "react";
import { apiSend } from "@/lib/api";
import type { Classification } from "@/server/ai/aiService";
import type { TicketCategory } from "@/server/domain/models";
import { PriorityBadge } from "./ui";

export interface PriorityContext {
  category?: TicketCategory;
  type?: "incident" | "service_request";
  affectedPeople?: "one" | "team" | "many";
  workStopped?: boolean;
}

// The preview cannot see VIP status (it is looked up on submit), so it can
// differ from the final priority for VIP requesters.
export function PriorityPreview({ subject, body, category, type, affectedPeople, workStopped }: { subject: string; body: string } & PriorityContext) {
  const [result, setResult] = useState<Classification | null>(null);
  const [state, setState] = useState("Describe the request to see its automatic priority.");
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      setResult(null);
      if (!subject.trim() || !body.trim()) { setState("Describe the request to see its automatic priority."); return; }
      setState("Assessing priority…");
      apiSend<Classification>("/tickets/classification", "POST", { subject, body, category, type, affectedPeople, workStopped }).then((data) => {
        if (live) { setResult(data); setState(data.explanation); }
      }).catch(() => { if (live) setState("Preview unavailable. Priority will be calculated when you submit."); });
    }, 800);
    return () => { live = false; clearTimeout(timer); };
  }, [subject, body, category, type, affectedPeople, workStopped]);
  return <div role="status" className="muted" style={{ fontSize: "0.8rem" }}>
    {result && <><PriorityBadge priority={result.priority} /> <strong>{result.source === "ai" ? "AI assessment" : "Rules-based assessment"}</strong> · Impact: {result.impact} · Urgency: {result.urgency} · </>}{state}
  </div>;
}
