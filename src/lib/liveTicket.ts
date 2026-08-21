"use client";

import { useEffect, useRef, useState } from "react";
import { apiSend } from "./api";
import type { MessageVisibility } from "@/server/domain/models";

// =============================================================================
// Live ticket hooks (SSE).
//
// useTicketLive(ticketId): subscribes to /api/v1/events and
//   - calls onUpdate() (debounced) whenever this ticket changes server-side,
//     so the conversation updates in real time without reloading;
//   - tracks who is currently typing (ephemeral ticket.typing pings; entries
//     expire ~4s after the last ping; own pings are filtered out).
//
// useTypingPing(ticketId): returns a throttled ping the composers call on
// keystrokes (at most one POST every 2s).
// =============================================================================

export interface TypingUser {
  key: string;
  name: string;
  kind: "agent" | "requester";
  visibility: MessageVisibility;
}

interface TypingEvent {
  type?: string;
  ticketId?: string;
  actorId?: string;
  actorName?: string;
  actorKind?: "agent" | "requester";
  visibility?: MessageVisibility;
}

const TYPING_TTL_MS = 4_000;

export function useTicketLive(
  ticketId: string | undefined,
  opts: { selfId?: string; selfName?: string; onUpdate?: () => void }
): { typing: TypingUser[] } {
  const [typing, setTyping] = useState<TypingUser[]>([]);

  // Refs so the SSE subscription survives re-renders without reconnecting.
  const onUpdateRef = useRef(opts.onUpdate);
  onUpdateRef.current = opts.onUpdate;
  const selfRef = useRef({ id: opts.selfId, name: opts.selfName });
  selfRef.current = { id: opts.selfId, name: opts.selfName };

  useEffect(() => {
    if (!ticketId || typeof EventSource === "undefined") return;

    // key -> entry with expiry; pruned on a short interval.
    const active = new Map<string, TypingUser & { expiresAt: number }>();
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    const emit = () => {
      const nowMs = Date.now();
      const list = [...active.values()].filter((t) => t.expiresAt > nowMs);
      setTyping((prev) => {
        const next = list.map(({ expiresAt, ...user }) => {
          void expiresAt;
          return user;
        });
        // Avoid re-render churn while the same people keep typing.
        if (
          prev.length === next.length &&
          prev.every((p, i) => p.key === next[i].key && p.visibility === next[i].visibility)
        ) {
          return prev;
        }
        return next;
      });
    };

    const prune = setInterval(() => {
      const nowMs = Date.now();
      for (const [k, v] of active) if (v.expiresAt <= nowMs) active.delete(k);
      emit();
    }, 1_000);

    const source = new EventSource("/api/v1/events");
    source.onmessage = (e) => {
      let event: TypingEvent;
      try {
        event = JSON.parse(e.data) as TypingEvent;
      } catch {
        return;
      }
      if (event.ticketId !== ticketId) return;

      if (event.type === "ticket.updated") {
        // A message someone just sent also bumps the ticket; coalesce bursts
        // (routing + automation + reply can fire back-to-back).
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => onUpdateRef.current?.(), 250);
        return;
      }

      if (event.type === "ticket.typing") {
        const self = selfRef.current;
        const isSelf =
          (event.actorId && self.id && event.actorId === self.id) ||
          (!event.actorId && event.actorName === self.name);
        if (isSelf) return;
        const key = event.actorId ?? event.actorName ?? "someone";
        active.set(key, {
          key,
          name: event.actorName ?? "Someone",
          kind: event.actorKind ?? "agent",
          visibility: event.visibility ?? "public",
          expiresAt: Date.now() + TYPING_TTL_MS,
        });
        emit();
      }
    };

    return () => {
      source.close();
      clearInterval(prune);
      if (refreshTimer) clearTimeout(refreshTimer);
      setTyping([]);
    };
  }, [ticketId]);

  return { typing };
}

const PING_INTERVAL_MS = 2_000;

export function useTypingPing(ticketId: string): (visibility?: MessageVisibility) => void {
  const lastSent = useRef(0);
  const idRef = useRef(ticketId);
  idRef.current = ticketId;

  const pingRef = useRef((visibility: MessageVisibility = "public") => {
    const nowMs = Date.now();
    if (nowMs - lastSent.current < PING_INTERVAL_MS) return;
    lastSent.current = nowMs;
    apiSend(`/tickets/${idRef.current}/typing`, "POST", { visibility }).catch(() => {
      // Best-effort: typing signals are cosmetic.
    });
  });

  return pingRef.current;
}
