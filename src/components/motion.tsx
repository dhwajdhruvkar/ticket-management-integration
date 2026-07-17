"use client";

// =============================================================================
// Shared motion primitives (framer-motion).
//
// Tasteful, GPU-friendly transforms/opacity only, tuned to the app's Apple-like
// ease-out curve and 120-320ms durations. All helpers respect the user's
// reduced-motion preference.
// =============================================================================

import { motion, AnimatePresence, useReducedMotion, type Variants } from "framer-motion";

export { motion, AnimatePresence, useReducedMotion };

/** Apple-style ease-out, matching --ease-out in globals.css. */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.24, ease: EASE_OUT } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.97, y: -4 },
  show: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.18, ease: EASE_OUT } },
  exit: { opacity: 0, scale: 0.97, y: -4, transition: { duration: 0.12, ease: EASE_OUT } },
};

export const listStagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04, delayChildren: 0.02 } },
};

export const overlayFade: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.18, ease: EASE_OUT } },
  exit: { opacity: 0, transition: { duration: 0.14 } },
};

/**
 * Reveal — mounts children with a subtle fade-up, honoring reduced motion.
 * Drop-in wrapper for cards/sections without changing their markup semantics.
 */
export function Reveal({
  children,
  delay = 0,
  y = 8,
  className,
  style,
}: {
  children: React.ReactNode;
  delay?: number;
  y?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const reduce = useReducedMotion();
  if (reduce) {
    return (
      <div className={className} style={style}>
        {children}
      </div>
    );
  }
  return (
    <motion.div
      className={className}
      style={style}
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: EASE_OUT, delay }}
    >
      {children}
    </motion.div>
  );
}
