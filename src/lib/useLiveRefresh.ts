"use client";

import { useEffect, useRef } from "react";

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
    const trigger = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => { debounce = null; onChangeRef.current(); }, debounceMs);
    };

    const source = typeof EventSource === "undefined" ? null : new EventSource("/api/v1/events");
    if (source) {
      source.onmessage = (message) => {
        let event: LiveEvent;
        try { event = JSON.parse(message.data) as LiveEvent; } catch { return; }
        if (event.type === "ticket.updated" || event.type === "notification") trigger();
      };
      // onerror is left alone: the browser retries the stream on its own.
    }

    const poll = setInterval(() => {
      if (document.visibilityState === "visible") onChangeRef.current();
    }, pollMs);

    return () => {
      source?.close();
      clearInterval(poll);
      if (debounce) clearTimeout(debounce);
    };
  }, [enabled, debounceMs, pollMs]);
}
