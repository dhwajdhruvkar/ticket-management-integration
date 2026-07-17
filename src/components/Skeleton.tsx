// =============================================================================
// Loading skeletons.
//
// Shimmer placeholders shown while data loads, plus page-shaped composites
// (DashboardSkeleton, TableSkeleton, TicketDetailSkeleton, ...) so first paint
// matches the real layout and avoids content-shift. Purely presentational.
// =============================================================================

import type { CSSProperties } from "react";

/**
 * A shimmering placeholder block. Renders an invisible character so it has
 * the correct line-height when used inline.
 *
 *   <Skel w={120} h={14} />          // a single line block
 *   <Skel w="40%" h={20} radius={8}> // custom rounded rect
 */
export function Skel({
  w,
  h = 14,
  radius = 6,
  style,
}: {
  w?: number | string;
  h?: number | string;
  radius?: number;
  style?: CSSProperties;
}) {
  return (
    <span
      className="skel"
      style={{
        display: "inline-block",
        width: typeof w === "number" ? `${w}px` : w ?? "100%",
        height: typeof h === "number" ? `${h}px` : h,
        borderRadius: radius,
        ...style,
      }}
    >
      &nbsp;
    </span>
  );
}

/** Pre-baked layouts for common pages so callers don't repeat themselves. */

export function DashboardSkeleton() {
  return (
    <div>
      <header style={{ marginBottom: "1.5rem" }}>
        <Skel w={420} h={28} />
        <div style={{ marginTop: 8 }}>
          <Skel w={560} h={14} />
        </div>
      </header>

      <section className="grid-kpis" style={{ marginBottom: "1.5rem" }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="panel" style={{ padding: "1rem 1.1rem" }}>
            <Skel w={140} h={10} />
            <div style={{ marginTop: 12 }}>
              <Skel w={90} h={26} />
            </div>
            <div style={{ marginTop: 10 }}>
              <Skel w={170} h={12} />
            </div>
          </div>
        ))}
      </section>

      <section className="grid-kpis" style={{ marginBottom: "1.5rem" }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="panel" style={{ padding: "1.1rem 1.2rem" }}>
            <Skel w={120} h={10} />
            <div style={{ marginTop: 12 }}>
              <Skel w={70} h={26} />
            </div>
          </div>
        ))}
      </section>

      <div className="grid-2col">
        <div className="panel" style={{ padding: "1.1rem 1.2rem" }}>
          <Skel w={150} h={16} />
          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="panel-2" style={{ padding: "0.75rem 0.85rem" }}>
                <Skel w={"60%"} h={14} />
                <div style={{ marginTop: 6 }}>
                  <Skel w={"35%"} h={10} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="panel" style={{ padding: "1.1rem 1.2rem" }}>
          <Skel w={200} h={16} />
          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i}>
                <Skel w={"45%"} h={12} />
                <div style={{ marginTop: 6 }}>
                  <Skel w={"100%"} h={8} radius={999} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function TableSkeleton({
  title = 220,
  rows = 6,
  columns = 6,
}: {
  title?: number;
  rows?: number;
  columns?: number;
}) {
  return (
    <div>
      <header style={{ marginBottom: "1.5rem" }}>
        <Skel w={title} h={26} />
        <div style={{ marginTop: 8 }}>
          <Skel w={480} h={12} />
        </div>
      </header>
      <div className="panel" style={{ overflow: "hidden" }}>
        <div
          style={{
            padding: "0.85rem 1rem",
            borderBottom: "1px solid var(--border)",
            display: "grid",
            gridTemplateColumns: `repeat(${columns}, 1fr)`,
            gap: 14,
          }}
        >
          {Array.from({ length: columns }).map((_, i) => (
            <Skel key={i} w={"60%"} h={10} />
          ))}
        </div>
        {Array.from({ length: rows }).map((_, r) => (
          <div
            key={r}
            style={{
              padding: "0.9rem 1rem",
              borderBottom: "1px solid var(--border)",
              display: "grid",
              gridTemplateColumns: `repeat(${columns}, 1fr)`,
              gap: 14,
            }}
          >
            {Array.from({ length: columns }).map((_, c) => (
              <Skel key={c} w={c === 0 ? "80%" : "55%"} h={14} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function CardGridSkeleton({
  title = 240,
  count = 6,
  columns = 2,
}: {
  title?: number;
  count?: number;
  columns?: number;
}) {
  return (
    <div>
      <header style={{ marginBottom: "1.5rem" }}>
        <Skel w={title} h={26} />
        <div style={{ marginTop: 8 }}>
          <Skel w={520} h={12} />
        </div>
      </header>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(auto-fit, minmax(280px, 1fr))`,
          gap: "1rem",
        }}
      >
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="panel" style={{ padding: "1.1rem 1.2rem" }}>
            <Skel w={70} h={18} radius={999} />
            <div style={{ marginTop: 12 }}>
              <Skel w={"70%"} h={16} />
            </div>
            <div style={{ marginTop: 10 }}>
              <Skel w={"100%"} h={10} />
            </div>
            <div style={{ marginTop: 6 }}>
              <Skel w={"95%"} h={10} />
            </div>
            <div style={{ marginTop: 6 }}>
              <Skel w={"60%"} h={10} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AuditSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div>
      <header style={{ marginBottom: "1.25rem" }}>
        <Skel w={220} h={26} />
        <div style={{ marginTop: 8 }}>
          <Skel w={500} h={12} />
        </div>
      </header>
      <div className="panel" style={{ padding: "1.1rem 1.3rem", marginBottom: "1.25rem" }}>
        <Skel w={300} h={16} />
        <div style={{ marginTop: 8 }}>
          <Skel w={220} h={10} />
        </div>
      </div>
      <div className="panel" style={{ padding: "0.4rem 0" }}>
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            style={{ padding: "0.95rem 1.3rem", borderBottom: "1px solid var(--border)" }}
          >
            <Skel w={"55%"} h={14} />
            <div style={{ marginTop: 6 }}>
              <Skel w={"35%"} h={10} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TicketDetailSkeleton() {
  return (
    <div>
      <Skel w={120} h={12} />
      <div style={{ margin: "0.75rem 0 1.25rem" }}>
        <Skel w={"60%"} h={26} />
        <div style={{ marginTop: 8 }}>
          <Skel w={"40%"} h={12} />
        </div>
      </div>
      <div className="grid-2col">
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="panel" style={{ padding: "1.1rem 1.2rem" }}>
              <Skel w={140} h={12} />
              <div style={{ marginTop: 10 }}>
                <Skel w={"100%"} h={14} />
              </div>
              <div style={{ marginTop: 6 }}>
                <Skel w={"95%"} h={14} />
              </div>
              <div style={{ marginTop: 6 }}>
                <Skel w={"60%"} h={14} />
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="panel" style={{ padding: "1.1rem 1.2rem" }}>
              <Skel w={140} h={14} />
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                {Array.from({ length: 4 }).map((_, j) => (
                  <Skel key={j} w={"100%"} h={12} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
