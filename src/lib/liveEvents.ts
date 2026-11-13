"use client";

// One EventSource per browser tab, shared by every live-update consumer.
// The server filters the stream per signed-in user, so sharing it cannot widen
// what any component sees. The browser reconnects on its own; each consumer
// keeps its own polling fallback, so a dead stream never leaves a view stale.

type Listener = (message: MessageEvent<string>) => void;

const listeners = new Set<Listener>();
let source: EventSource | null = null;

/** Subscribe to the shared stream; call the returned function to unsubscribe. */
export function subscribeLiveEvents(listener: Listener): () => void {
  if (typeof EventSource === "undefined") return () => {};
  listeners.add(listener);
  if (!source) {
    source = new EventSource("/api/v1/events");
    source.onmessage = (message) => {
      for (const l of [...listeners]) l(message);
    };
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && source) {
      source.close();
      source = null;
    }
  };
}
