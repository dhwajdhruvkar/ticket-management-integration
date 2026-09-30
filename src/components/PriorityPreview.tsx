"use client";

import { useEffect, useState } from "react";
import { apiSend } from "@/lib/api";
import type { Classification } from "@/server/ai/aiService";
import { PriorityBadge } from "./ui";

export function PriorityPreview({ subject, body }: { subject: string; body: string }) {
  const [result, setResult] = useState<Classification | null>(null);
  const [state, setState] = useState("Describe the request to see its automatic priority.");
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      setResult(null);
      if (!subject.trim() || !body.trim()) { setState("Describe the request to see its automatic priority."); return; }
      setState("Assessing priority…");
      apiSend<Classification>("/tickets/classification", "POST", { subject, body }).then((data) => {
        if (live) { setResult(data); setState(data.explanation); }
      }).catch(() => { if (live) setState("Preview unavailable. Priority will be calculated when you submit."); });
    }, 800);
    return () => { live = false; clearTimeout(timer); };
  }, [subject, body]);
  return <div role="status" className="muted" style={{ fontSize: "0.8rem" }}>
    {result && <><PriorityBadge priority={result.priority} /> <strong>{result.source === "ai" ? "AI assessment" : "Rules-based assessment"}</strong> · </>}{state}
  </div>;
}
