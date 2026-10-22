"use client";

// =============================================================================
// Shared motion primitives (framer-motion).
//
// Tasteful, GPU-friendly transforms/opacity only, tuned to the app's Apple-like
// ease-out curve and 120-320ms durations. All helpers respect the user's
// reduced-motion preference.
// =============================================================================

import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

export { motion, AnimatePresence, useReducedMotion };

/** Apple-style ease-out, matching --ease-out in globals.css. */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;
