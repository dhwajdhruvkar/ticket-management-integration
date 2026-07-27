"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// =============================================================================
// The small circled "i" with a hover/focus explanation bubble.
//
// The bubble is portalled to <body> and positioned in viewport coordinates
// rather than being absolutely positioned inside the trigger. Most hints live
// in the ticket properties rail, the context pane and the settings panels, all
// of which are `overflow: auto` scroll containers that would otherwise clip an
// absolutely positioned child. Escaping to the body also lets the bubble flip
// to whichever side actually has room instead of running off-screen.
// =============================================================================

export type HintSide = "top" | "right" | "bottom" | "left";

/** Space between the glyph and the bubble. */
const GAP = 8;
/** Smallest allowed distance between the bubble and the viewport edge. */
const EDGE = 8;
const MAX_WIDTH = 260;

interface Placement {
  top: number;
  left: number;
  side: HintSide;
}

const OPPOSITE: Record<HintSide, HintSide> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * Pick the first side with room for the bubble, preferring the caller's choice,
 * then its opposite, then the perpendicular pair. Along the free axis the
 * bubble is centred on the trigger and then clamped into the viewport.
 */
function place(anchor: DOMRect, bubble: { width: number; height: number }, preferred: HintSide): Placement {
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;

  const fits: Record<HintSide, boolean> = {
    top: anchor.top - bubble.height - GAP >= EDGE,
    bottom: anchor.bottom + bubble.height + GAP <= vh - EDGE,
    left: anchor.left - bubble.width - GAP >= EDGE,
    right: anchor.right + bubble.width + GAP <= vw - EDGE,
  };

  const perpendicular: HintSide[] =
    preferred === "top" || preferred === "bottom" ? ["right", "left"] : ["bottom", "top"];
  const order: HintSide[] = [preferred, OPPOSITE[preferred], ...perpendicular];
  const side = order.find((s) => fits[s]) ?? preferred;

  if (side === "top" || side === "bottom") {
    const top = side === "top" ? anchor.top - bubble.height - GAP : anchor.bottom + GAP;
    const left = anchor.left + anchor.width / 2 - bubble.width / 2;
    return { side, top: clamp(top, EDGE, vh - bubble.height - EDGE), left: clamp(left, EDGE, vw - bubble.width - EDGE) };
  }

  const left = side === "left" ? anchor.left - bubble.width - GAP : anchor.right + GAP;
  const top = anchor.top + anchor.height / 2 - bubble.height / 2;
  return { side, top: clamp(top, EDGE, vh - bubble.height - EDGE), left: clamp(left, EDGE, vw - bubble.width - EDGE) };
}

export function InfoHint({
  text,
  side = "top",
  size = 13,
  nested = false,
}: {
  text: string;
  /** Preferred side; the bubble flips automatically when there is no room. */
  side?: HintSide;
  size?: number;
  /**
   * Set when the hint sits inside a button or link. Interactive content cannot
   * legally nest, so the hint drops out of the tab order and the accessible
   * name; the parent control is expected to fold the text into its aria-label.
   */
  nested?: boolean;
}) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement | null>(null);

  const reposition = useCallback(() => {
    const trigger = triggerRef.current;
    const bubble = bubbleRef.current;
    if (!trigger || !bubble) return;
    const rect = bubble.getBoundingClientRect();
    setPlacement(place(trigger.getBoundingClientRect(), { width: rect.width, height: rect.height }, side));
  }, [side]);

  // Measure once the bubble is in the DOM, before the browser paints it, so it
  // never appears at the pre-measurement position first.
  useLayoutEffect(() => {
    if (open) reposition();
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => reposition();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    // A tap-opened bubble gets no pointerleave, so dismiss it on the next press.
    const onPointerDown = (e: PointerEvent) => {
      if (!triggerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    // Capture phase so the bubble tracks any scrolling ancestor, not just the page.
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, reposition]);

  const hide = () => {
    setOpen(false);
    setPlacement(null);
  };

  return (
    <span
      ref={triggerRef}
      className="info-hint"
      tabIndex={nested ? undefined : 0}
      role={nested ? undefined : "note"}
      aria-label={nested ? undefined : text}
      aria-hidden={nested || undefined}
      onPointerEnter={(e) => {
        // Touch is handled by the click toggle below; a synthetic pointerenter
        // on tap would otherwise open and immediately close the bubble.
        if (e.pointerType !== "touch") setOpen(true);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== "touch") hide();
      }}
      onFocus={() => setOpen(true)}
      onBlur={hide}
      // Coarse pointers cannot hover, so a tap opens the bubble instead. Nested
      // hints stay transparent to clicks so the button they sit in still fires.
      onClick={
        nested
          ? undefined
          : (e) => {
              e.stopPropagation();
              e.preventDefault();
              setOpen((v) => !v);
            }
      }
    >
      <svg
        aria-hidden
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="9.5" />
        <path d="M12 11v5" />
        <path d="M12 7.75h.01" />
      </svg>
      {open && typeof document !== "undefined"
        ? createPortal(
            <span
              ref={bubbleRef}
              className={`info-hint-bubble info-hint-${placement?.side ?? side}`}
              style={{
                top: placement?.top ?? 0,
                left: placement?.left ?? 0,
                maxWidth: MAX_WIDTH,
                // Hidden for the measuring pass only.
                visibility: placement ? "visible" : "hidden",
              }}
            >
              {text}
            </span>,
            document.body
          )
        : null}
    </span>
  );
}
