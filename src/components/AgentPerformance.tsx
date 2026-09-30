"use client";
import { useEffect, useState, type ReactNode } from "react";
import { apiGet } from "@/lib/api";
import type { AgentPerformanceReport, PerformanceRange } from "@/server/services/agentPerformance";

export function AgentPerformance({ children }: { children: (report: AgentPerformanceReport) => ReactNode }) {
  const [range, setRange] = useState<PerformanceRange>("week");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [query, setQuery] = useState("range=week");
  const [report, setReport] = useState<AgentPerformanceReport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let live = true; setLoading(true); setError("");
    apiGet<AgentPerformanceReport>(`/metrics/agents?${query}`).then((value) => { if (live) setReport(value); }).catch((failure: Error) => { if (live) setError(failure.message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [query]);
  return <section aria-label="Agent performance period">
    <form className="panel" style={{ padding: 16, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end" }} onSubmit={(event) => { event.preventDefault(); setQuery(new URLSearchParams({ range, ...(range === "custom" ? { from, to } : {}) }).toString()); }}>
      <label>Agent performance period<select className="select" value={range} onChange={(event) => setRange(event.target.value as PerformanceRange)}><option value="week">This week</option><option value="month">This month</option><option value="year">This year</option><option value="custom">Custom dates</option></select></label>
      {range === "custom" && <><label>Start date<input className="input" type="date" required value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>End date (inclusive)<input className="input" type="date" required min={from} value={to} onChange={(event) => setTo(event.target.value)} /></label></>}
      <button className="btn" disabled={loading}>Apply dates</button>
    </form>
    {loading ? <p role="status">Loading performance…</p> : error ? <p role="alert">{error}</p> : report && <>
      <p className="muted">{report.period.from} – {report.period.to} · {report.period.timezone}. Resolutions are credited to the recorded resolver at the time of resolution. Live open workload is not date-filtered.</p>
      {children(report)}
      <p className="muted">Recorded resolutions start with this release; older tickets without verified resolver data are excluded. Resolving a reopened ticket records another resolution.</p>
    </>}
  </section>;
}
