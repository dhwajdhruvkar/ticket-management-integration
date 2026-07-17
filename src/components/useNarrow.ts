"use client";

// =============================================================================
// useNarrow — responsive breakpoint hook.
//
// Returns true when the viewport is narrower than `breakpoint` px and keeps up
// with live resizes. Pages use it to collapse multi-pane layouts (ticket
// detail, problems) into stacked/tabbed views on tablet and mobile.
// =============================================================================

import { useEffect, useState } from "react";

/** True below the given viewport width (tracks live resizes). */
export function useNarrow(breakpoint: number): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < breakpoint);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [breakpoint]);
  return narrow;
}
