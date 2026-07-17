import type { LucideIcon, LucideProps } from "lucide-react";

// =============================================================================
// Icon — one consistent icon system (lucide) with app-wide defaults.
//
// Usage: <Icon icon={Search} /> or <Icon icon={Bell} size={20} />
// Defaults to 18px / 1.75 stroke / aria-hidden so icons read as decorative and
// stay visually consistent everywhere.
// =============================================================================

export function Icon({
  icon: Glyph,
  size = 18,
  strokeWidth = 1.75,
  ...rest
}: { icon: LucideIcon } & LucideProps) {
  return <Glyph size={size} strokeWidth={strokeWidth} aria-hidden {...rest} />;
}
