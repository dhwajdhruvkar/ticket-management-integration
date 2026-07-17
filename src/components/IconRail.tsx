"use client";

// =============================================================================
// IconRail — the left navigation sidebar (workspace chrome).
//
// Role-aware, grouped nav (agents get the full ITSM set: tickets, problems,
// changes, assets, KB, insights, audit, admin; requesters get a slim self-
// service set). Renders full, collapsed (icon-only), or inside the mobile
// drawer depending on the shell breakpoint, with the active route highlighted.
// Navigation only — no data mutations.
// =============================================================================

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Home,
  Ticket,
  ListFilter,
  Bug,
  GitBranch,
  Boxes,
  BookOpen,
  BarChart3,
  ShieldCheck,
  PlusCircle,
  Plus,
  Settings,
} from "lucide-react";
import { usePersona } from "./Persona";
import { ThemeToggle } from "./Theme";

// =============================================================================
// IconRail — the left navigation sidebar.
//
// Graphite enterprise rail with labelled nav rows, an active indicator (CSS
// ::before accent bar), and role-aware items. Renders full-width, icon-only
// (collapsed), or inside the mobile drawer (AppShell decides).
// =============================================================================

const NAV_ICON = { size: 18, strokeWidth: 1.75, "aria-hidden": true } as const;

interface RailItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  match: (p: string) => boolean;
}

interface RailGroup {
  caption?: string;
  items: RailItem[];
}

export default function IconRail({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { persona, ready } = usePersona();
  const isAgent = persona.role === "agent";
  const canTriage = ["manager", "tenant_admin", "super_admin"].includes(persona.serverRole);

  const groups: RailGroup[] = isAgent
    ? [
        {
          items: [{ href: "/", label: "Home", icon: <Home {...NAV_ICON} />, match: (p) => p === "/" }],
        },
        {
          caption: "Operations",
          items: [
            { href: "/tickets", label: "Tickets", icon: <Ticket {...NAV_ICON} />, match: (p) => p.startsWith("/tickets") },
            ...(canTriage
              ? [{ href: "/triage", label: "Triage", icon: <ListFilter {...NAV_ICON} />, match: (p: string) => p.startsWith("/triage") }]
              : []),
            { href: "/problems", label: "Problems", icon: <Bug {...NAV_ICON} />, match: (p) => p.startsWith("/problems") },
            { href: "/changes", label: "Changes", icon: <GitBranch {...NAV_ICON} />, match: (p) => p.startsWith("/changes") },
          ],
        },
        {
          caption: "Resources",
          items: [
            { href: "/assets", label: "Assets & CMDB", icon: <Boxes {...NAV_ICON} />, match: (p) => p.startsWith("/assets") },
            { href: "/knowledge-base", label: "Knowledge", icon: <BookOpen {...NAV_ICON} />, match: (p) => p.startsWith("/knowledge-base") },
            { href: "/analytics", label: "Insights", icon: <BarChart3 {...NAV_ICON} />, match: (p) => p.startsWith("/analytics") },
            { href: "/audit", label: "Audit", icon: <ShieldCheck {...NAV_ICON} />, match: (p) => p.startsWith("/audit") },
          ],
        },
      ]
    : [
        {
          items: [
            { href: "/tickets", label: "My Requests", icon: <Ticket {...NAV_ICON} />, match: (p) => p.startsWith("/tickets") },
            { href: "/portal", label: "Raise a Request", icon: <PlusCircle {...NAV_ICON} />, match: (p) => p.startsWith("/portal") },
            { href: "/knowledge-base", label: "Help Center", icon: <BookOpen {...NAV_ICON} />, match: (p) => p.startsWith("/knowledge-base") },
          ],
        },
      ];

  return (
    <aside
      className={`rail${collapsed ? " collapsed" : ""}`}
      style={{
        width: collapsed ? 64 : 234,
        flexShrink: 0,
        background: "var(--chrome)",
        color: "var(--chrome-fg)",
        display: "flex",
        flexDirection: "column",
        padding: collapsed ? "14px 10px" : "16px 14px",
        gap: 6,
        height: "100%",
        borderRight: "1px solid var(--chrome-border)",
        transition: "width var(--dur-3) var(--ease)",
      }}
    >
      {/* Brand */}
      <Link
        href={isAgent ? "/" : "/tickets"}
        aria-label="Netlink Support"
        onClick={onNavigate}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: collapsed ? "center" : "flex-start",
          gap: 10,
          padding: collapsed ? "4px 0 10px" : "4px 4px 12px",
          textDecoration: "none",
          color: "inherit",
          minWidth: 0,
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: "var(--r-sm)",
            background: "var(--brand-gradient)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 800,
            color: "#fff",
            fontSize: "0.95rem",
            flexShrink: 0,
            boxShadow: "var(--shadow-brand), inset 0 1px 0 rgba(255,255,255,0.18)",
          }}
        >
          N
        </div>
        {!collapsed ? (
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: "0.9rem",
                fontWeight: 700,
                letterSpacing: "-0.015em",
                color: "var(--chrome-fg)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              Netlink Support
            </div>
            <div
              style={{
                fontSize: "0.62rem",
                fontWeight: 600,
                color: "var(--chrome-muted)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                letterSpacing: "0.09em",
                textTransform: "uppercase",
                marginTop: 1,
              }}
            >
              {isAgent ? "Enterprise ITSM" : "Self-Service Portal"}
            </div>
          </div>
        ) : null}
      </Link>

      {/* Primary create action */}
      {ready ? (
        <button
          type="button"
          className="btn btn-primary"
          aria-label={isAgent ? "Create ticket" : "Raise a request"}
          title={collapsed ? (isAgent ? "Create ticket" : "Raise a request") : undefined}
          onClick={() => {
            onNavigate?.();
            router.push(isAgent ? "/tickets?new=1" : "/portal");
          }}
          style={{
            margin: collapsed ? "4px 0 6px" : "2px 0 6px",
            padding: collapsed ? "0.55rem 0" : undefined,
            width: collapsed ? "100%" : "auto",
          }}
        >
          <Plus size={15} strokeWidth={2.25} aria-hidden />
          {!collapsed ? <span>{isAgent ? "Create Ticket" : "New Request"}</span> : null}
        </button>
      ) : null}

      <div style={{ height: 1, background: "var(--chrome-border)", margin: "4px 0 6px" }} />

      {/* Nav */}
      <nav style={{ display: "flex", flexDirection: "column", gap: 2, overflow: "hidden auto" }}>
        {ready
          ? groups.map((group, gi) => (
              <div key={group.caption ?? gi} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {group.caption ? (
                  collapsed ? (
                    <div
                      aria-hidden
                      style={{ height: 1, background: "var(--chrome-border)", margin: "8px 6px" }}
                    />
                  ) : (
                    <div className="rail-group">{group.caption}</div>
                  )
                ) : null}
                {group.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-label={item.label}
                    title={collapsed ? item.label : undefined}
                    className={`rail-item${item.match(pathname) ? " active" : ""}`}
                    onClick={onNavigate}
                  >
                    <span style={{ display: "inline-flex", width: 20, justifyContent: "center", flexShrink: 0 }}>
                      {item.icon}
                    </span>
                    <span className="rail-label">{item.label}</span>
                  </Link>
                ))}
              </div>
            ))
          : null}
      </nav>

      {/* Footer */}
      <div
        style={{
          marginTop: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 2,
          paddingTop: 8,
          borderTop: "1px solid var(--chrome-border)",
        }}
      >
        {ready && isAgent ? (
          <button
            type="button"
            aria-label="Settings"
            title={collapsed ? "Settings" : undefined}
            className={`rail-item${pathname.startsWith("/settings") ? " active" : ""}`}
            onClick={() => {
              onNavigate?.();
              router.push("/settings");
            }}
          >
            <span style={{ display: "inline-flex", width: 20, justifyContent: "center", flexShrink: 0 }}>
              <Settings {...NAV_ICON} />
            </span>
            <span className="rail-label">Settings</span>
          </button>
        ) : null}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: collapsed ? "center" : "space-between",
            padding: collapsed ? "6px 0" : "6px 8px",
            color: "var(--chrome-muted)",
            fontSize: "0.78rem",
            fontWeight: 600,
          }}
        >
          {!collapsed ? <span>Theme</span> : null}
          <ThemeToggle size={32} />
        </div>
      </div>
    </aside>
  );
}
