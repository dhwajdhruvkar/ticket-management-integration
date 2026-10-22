import type { ReactNode } from "react";
import { LabelWithHint } from "@/components/ui";

export function PanelHeader({
  title,
  icon,
  right,
  info,
}: {
  title: string;
  icon?: ReactNode;
  right?: ReactNode;
  info?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        margin: "-1.1rem -1.2rem 14px",
        padding: "0.8rem 1.2rem",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {icon ? <span style={{ color: "var(--muted)", display: "inline-flex" }}>{icon}</span> : null}
        <h2 style={{ fontSize: "0.95rem", fontWeight: 700, margin: 0, letterSpacing: "-0.01em" }}>
          <LabelWithHint info={info}>{title}</LabelWithHint>
        </h2>
      </div>
      {right}
    </div>
  );
}
