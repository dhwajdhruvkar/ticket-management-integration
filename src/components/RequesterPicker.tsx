"use client";

import { useEffect, useId, useState } from "react";
import { apiGet } from "@/lib/api";
import type { RequesterSearchResult } from "@/server/services/requesterSearch";

export function RequesterPicker({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled: boolean }) {
  const id = useId();
  const [result, setResult] = useState<RequesterSearchResult>({ items: [], hasMore: false });
  const [state, setState] = useState("");
  useEffect(() => {
    if (disabled) return;
    let live = true;
    const timer = setTimeout(() => {
      if (!value.trim()) { setResult({ items: [], hasMore: false }); setState(""); return; }
      setState("Searching organization users…");
      apiGet<RequesterSearchResult>(`/requesters?q=${encodeURIComponent(value)}`).then((data) => {
        if (live) { setResult(data); setState(data.hasMore ? "More matches available; refine your search." : ""); }
      }).catch(() => { if (live) { setResult({ items: [], hasMore: false }); setState("Search unavailable. You can still enter a valid email."); } });
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [value, disabled]);
  return <div>
    <label className="label" htmlFor={id}>Requester email</label>
    <input id={id} className="input" type="text" inputMode="email" autoComplete="off"
      list={`${id}-choices`} aria-describedby={`${id}-help`} value={value} disabled={disabled}
      placeholder="Search name or email, or enter a new email" onChange={(e) => onChange(e.target.value)} />
    <datalist id={`${id}-choices`}>{result.items.map((user) => <option key={user.id} value={user.email}>{user.name}{user.department ? ` · ${user.department}` : ""}</option>)}</datalist>
    <p id={`${id}-help`} className="muted" style={{ fontSize: "0.74rem", marginTop: 4 }} role="status">
      {disabled ? "Requests are submitted as your signed-in account." : state || "Select an organization user or enter a new email. No login account is created."}
    </p>
  </div>;
}
