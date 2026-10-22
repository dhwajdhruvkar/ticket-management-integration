/* Stroke icons shared by the dashboard and analytics pages (24px grid, 2px stroke). */

const svgBase = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function AlertIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...svgBase}>
      <path d="M12 9v4M12 17h.01" />
      <path d="M10.29 3.86l-8.14 14a2 2 0 001.71 3h16.28a2 2 0 001.71-3l-8.14-14a2 2 0 00-3.42 0z" />
    </svg>
  );
}

export function BankIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...svgBase}>
      <path d="M3 21h18M4 21V10M20 21V10M6 21V10M18 21V10M10 21V10M14 21V10M2 10l10-7 10 7" />
    </svg>
  );
}

export function BoltIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...svgBase}>
      <path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z" />
    </svg>
  );
}

export function CheckIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...svgBase}>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

export function FolderIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...svgBase}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function GaugeIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...svgBase}>
      <path d="M12 14l4-4" />
      <path d="M3 12a9 9 0 0 1 18 0" />
      <circle cx="12" cy="14" r="1.5" />
    </svg>
  );
}

export function HeartIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...svgBase}>
      <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
    </svg>
  );
}

export function HourglassIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...svgBase}>
      <path d="M6 2h12M6 22h12M6 2v4a6 6 0 006 6 6 6 0 006-6V2M6 22v-4a6 6 0 016-6 6 6 0 016 6v4" />
    </svg>
  );
}

export function ShieldIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...svgBase}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

export function SparkIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...svgBase}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M16 16l2 2M6 18l2-2M16 8l2-2" />
    </svg>
  );
}

export function TagIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...svgBase}>
      <path d="M20.59 13.41l-8.17 8.17a2 2 0 0 1-2.83 0L2 13.83V2h11.83l7.83 7.83a2 2 0 0 1 0 2.83z" />
      <circle cx="7" cy="7" r="1.5" />
    </svg>
  );
}

export function TimerIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...svgBase}>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l3 2M9 2h6" />
    </svg>
  );
}

export function TrophyIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...svgBase}>
      <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4z" />
      <path d="M17 4h3v3a3 3 0 01-3 3M7 4H4v3a3 3 0 003 3" />
    </svg>
  );
}
