"use client";

// =============================================================================
// Route transition — a subtle fade + rise on every navigation.
//
// template.tsx re-mounts per route (unlike layout.tsx), so it gives the whole
// app a soft page transition. Purely presentational; honors reduced motion.
// =============================================================================

import { motion, useReducedMotion, EASE_OUT } from "@/components/motion";

export default function Template({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();
  if (reduce) return <>{children}</>;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: EASE_OUT }}
      style={{ minHeight: "100%" }}
    >
      {children}
    </motion.div>
  );
}
