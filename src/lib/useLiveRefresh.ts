"use client";

import { useEffect, useRef } from "react";
import { subscribeLiveEvents } from "./liveEvents";

// =============================================================================
// Live refresh with a polling fallback.
//
// The SSE bus is in-process, so on multi-instance hosting a viewer can miss an
// event. Polling (visible tabs only) is the guarantee; SSE just makes refreshes
// sooner. Callers must not describe this as guaranteed real time.
// =============================================================================

interface LiveEvent { type?: string }

export function useLiveRefresh(onChange: () => void, opts: { enabled?: boolean; debounceMs?: number; pollMs?: number } = {}): void {
  const { enabled = true, debounceMs = 2000, pollMs = 60_000 } = opts;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!enabled) return;

    let debounce: ReturnType<typeof setTimeout> | null = null;
    let missedWhileHidden = false;
    const run = () => {
      if (document.visibilityState !== "visible") { missedWhileHidden = true; return; }
      onChangeRef.current();
    };
    const trigger = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => { debounce = null; run(); }, debounceMs);
    };

    const unsubscribe = subscribeLiveEvents((message) => {
      let event: LiveEvent;
      try { event = JSON.parse(message.data) as LiveEvent; } catch { return; }
      if (event.type === "ticket.updated" || event.type === "notification") trigger();
    });

    const poll = setInterval(() => {
      if (document.visibilityState === "visible") onChangeRef.current();
    }, pollMs);
    // Hidden tabs do no work; catch up once when the tab is shown again.
    const onVisible = () => {
      if (document.visibilityState === "visible" && missedWhileHidden) { missedWhileHidden = false; onChangeRef.current(); }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      unsubscribe();
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      if (debounce) clearTimeout(debounce);
    };
  }, [enabled, debounceMs, pollMs]);
}
