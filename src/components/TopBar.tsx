"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Menu, Search, Plus, Bell, CheckCheck, Mail, MessageSquare, Webhook, ChevronRight } from "lucide-react";
import { usePersona, PersonaSwitcher } from "./Persona";
import { useShell } from "./AppShell";
import { apiGet, apiSend } from "@/lib/api";
import { timeAgo } from "./ui";
import type { NotificationRow } from "@/server/domain/models";

// =============================================================================
// TopBar — workspace top chrome.
//
// Layout: hamburger (mobile) · section title · global search (collapses to an
// icon below 900px) · action cluster (+ New, notifications, user menu). The
// bell is a live feed of the signed-in user's notifications.
// =============================================================================

const ROW_HEIGHT = 36;

export default function TopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { persona, ready } = usePersona();
  const { railMode, openDrawer } = useShell();
  const isAgent = persona.role === "agent";
  const [q, setQ] = useState("");
  const [mobileSearch, setMobileSearch] = useState(false);

  const title = sectionTitle(pathname, isAgent);
  const parent = sectionParent(pathname, isAgent);

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    const term = q.trim();
    setMobileSearch(false);
    router.push(term ? `/tickets?q=${encodeURIComponent(term)}` : "/tickets");
  }

  return (
    <header
      style={{
        flexShrink: 0,
        background: "var(--surface)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div
        style={{
          height: 60,
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "0 16px 0 20px",
        }}
      >
        {railMode === "drawer" ? (
          <IconButton label="Open navigation" onClick={openDrawer}>
            <Menu size={18} strokeWidth={1.75} aria-hidden />
          </IconButton>
        ) : null}

        {/* Breadcrumb trail */}
        <nav
          aria-label="Breadcrumb"
          className="tb-title"
          style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}
        >
          {ready ? (
            <>
              {parent ? (
                <>
                  {parent.href ? (
                    <Link href={parent.href} className="crumb">
                      {parent.label}
                    </Link>
                  ) : (
                    <span className="crumb">{parent.label}</span>
                  )}
                  <span className="crumb-sep" aria-hidden>
                    <ChevronRight size={13} strokeWidth={2} aria-hidden />
                  </span>
                </>
              ) : null}
              <span className="crumb crumb-current" aria-current="page">
                {title}
              </span>
            </>
          ) : null}
        </nav>

        {/* Global search (agents only, wide screens) */}
        {isAgent ? (
          <form onSubmit={submitSearch} className="tb-search">
            <div style={{ position: "relative", width: "100%", maxWidth: 560 }}>
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  left: 11,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--muted)",
                  display: "flex",
                  pointerEvents: "none",
                }}
              >
                <Search size={15} strokeWidth={1.9} aria-hidden />
              </span>
              <input
                className="input"
                placeholder="Search tickets, requesters, IDs…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                style={{
                  paddingLeft: 34,
                  height: ROW_HEIGHT,
                  fontSize: "0.85rem",
                }}
              />
            </div>
          </form>
        ) : (
          <div style={{ flex: 1 }} />
        )}
        {isAgent ? <div className="tb-search-toggle" style={{ flex: 1 }} /> : null}

        {/* Action cluster */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, marginLeft: "auto" }}>
          {isAgent ? (
            <span className="tb-search-toggle">
              <IconButton label="Search" onClick={() => setMobileSearch((s) => !s)}>
                <Search size={17} strokeWidth={1.9} aria-hidden />
              </IconButton>
            </span>
          ) : null}

          <button
            type="button"
            onClick={() => router.push(isAgent ? "/tickets?new=1" : "/portal")}
            className="btn btn-primary"
            style={{ height: ROW_HEIGHT, padding: "0 13px" }}
          >
            <Plus size={15} strokeWidth={2.25} aria-hidden />
            <span className="tb-new-label">{isAgent ? "New ticket" : "New request"}</span>
          </button>

          <NotificationsBell active={ready && !!persona.email} />

          <div
            aria-hidden
            style={{
              width: 1,
              height: 26,
              background: "var(--border)",
              flexShrink: 0,
            }}
          />

          <PersonaSwitcher placement="topbar" />
        </div>
      </div>

      {/* Expanding mobile search row */}
      {mobileSearch && isAgent ? (
        <form
          onSubmit={submitSearch}
          className="anim-fade-in"
          style={{ padding: "0 16px 10px", display: "flex", gap: 8 }}
        >
          <input
            className="input"
            autoFocus
            placeholder="Search tickets, requesters, IDs…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ height: ROW_HEIGHT, fontSize: "0.85rem" }}
          />
          <button className="btn btn-ghost" type="submit" style={{ height: ROW_HEIGHT }}>
            Go
          </button>
        </form>
      ) : null}
    </header>
  );
}

// ------------------------------------------------------------- Notifications

function NotificationsBell({ active }: { active: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(() => {
    if (!active) return;
    apiGet<{ items: NotificationRow[]; unread: number }>("/notifications")
      .then((r) => {
        setItems(r.items);
        setUnread(r.unread);
      })
      .catch(() => {});
  }, [active]);

  // Live updates via SSE, with slow polling as the safety net.
  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 120_000);

    let source: EventSource | null = null;
    if (active && typeof EventSource !== "undefined") {
      source = new EventSource("/api/v1/events");
      source.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data) as { type?: string };
          if (event.type === "notification") refresh();
        } catch {
          // Ignore malformed frames.
        }
      };
      source.onerror = () => {
        // Browser retries automatically; polling covers the gap.
      };
    }
    return () => {
      clearInterval(interval);
      source?.close();
    };
  }, [refresh, active]);

  async function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next) {
      refresh();
      if (unread > 0) {
        try {
          await apiSend("/notifications", "POST", { op: "mark_read" });
          setUnread(0);
        } catch {
          // non-fatal
        }
      }
    }
  }

  return (
    <div style={{ position: "relative" }}>
      {open ? (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 39 }} aria-hidden />
          <div
            role="menu"
            className="menu-pop"
            style={{
              position: "fixed",
              top: 64,
              right: 12,
              width: "min(360px, calc(100vw - 24px))",
              maxHeight: "min(440px, 70vh)",
              overflow: "auto",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--r-lg)",
              boxShadow: "var(--shadow-lg)",
              padding: 6,
              zIndex: 40,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0.45rem 0.55rem 0.35rem",
              }}
            >
              <span className="label" style={{ margin: 0 }}>Notifications</span>
              {unread > 0 ? (
                <span
                  className="badge"
                  style={{
                    background: "var(--brand-50)",
                    color: "var(--brand-700)",
                    borderColor: "var(--brand-100)",
                    fontSize: "0.64rem",
                  }}
                >
                  {unread} new
                </span>
              ) : null}
            </div>
            {items.length === 0 ? (
              <div style={{ padding: "1.2rem 0.55rem", textAlign: "center" }}>
                <div
                  aria-hidden
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    background: "var(--success-bg)",
                    color: "var(--success-fg)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 8,
                  }}
                >
                  <CheckCheck size={18} strokeWidth={1.9} aria-hidden />
                </div>
                <p className="muted" style={{ fontSize: "0.8rem", margin: 0 }}>
                  You&apos;re all caught up — no notifications yet.
                </p>
              </div>
            ) : (
              items.map((n) => {
                const clickable = !!n.link;
                return (
                  <button
                    key={n.id}
                    type="button"
                    role="menuitem"
                    disabled={!clickable}
                    onClick={() => {
                      if (!n.link) return;
                      setOpen(false);
                      router.push(n.link);
                    }}
                    title={clickable ? "Open" : undefined}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      border: "none",
                      font: "inherit",
                      display: "flex",
                      gap: 10,
                      padding: "0.55rem 0.55rem",
                      borderRadius: "var(--r-md)",
                      background: n.readAt ? "transparent" : "var(--brand-50)",
                      marginBottom: 2,
                      cursor: clickable ? "pointer" : "default",
                      transition: "background var(--dur-2) var(--ease)",
                    }}
                    onMouseEnter={(e) => {
                      if (clickable) e.currentTarget.style.background = "var(--surface-2)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = n.readAt ? "transparent" : "var(--brand-50)";
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 8,
                        flexShrink: 0,
                        background: n.readAt ? "var(--surface-3)" : "var(--brand-100)",
                        color: n.readAt ? "var(--muted)" : "var(--brand-700)",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        marginTop: 2,
                      }}
                    >
                      <ChannelIcon channel={n.channel} />
                    </span>
                    <span style={{ minWidth: 0, flex: 1, display: "block" }}>
                      <span style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "var(--text)" }}>
                        {n.subject}
                      </span>
                      <span
                        className="muted"
                        style={{
                          fontSize: "0.72rem",
                          marginTop: 2,
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {n.body}
                      </span>
                      <span className="muted" style={{ display: "block", fontSize: "0.66rem", marginTop: 3 }}>
                        {n.channel} · {timeAgo(n.createdAt)}
                        {clickable ? " · click to open" : ""}
                      </span>
                    </span>
                    {!n.readAt ? (
                      <span
                        aria-hidden
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: 999,
                          background: "var(--brand-500)",
                          flexShrink: 0,
                          marginTop: 6,
                        }}
                      />
                    ) : clickable ? (
                      <span aria-hidden style={{ color: "var(--muted-soft)", marginTop: 4, flexShrink: 0 }}>
                        <ChevronRight size={14} strokeWidth={2} aria-hidden />
                      </span>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </>
      ) : null}

      <IconButton label="Notifications" onClick={() => void toggleOpen()}>
        <Bell size={17} strokeWidth={1.75} aria-hidden />
        {unread > 0 ? (
          <span
            className="anim-scale-in"
            style={{
              position: "absolute",
              top: 4,
              right: 4,
              minWidth: 15,
              height: 15,
              borderRadius: 999,
              background: "var(--danger-solid)",
              color: "#fff",
              fontSize: "0.6rem",
              fontWeight: 800,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 3px",
            }}
          >
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </IconButton>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{
        width: ROW_HEIGHT,
        height: ROW_HEIGHT,
        borderRadius: "var(--r-md)",
        border: "1px solid transparent",
        background: "transparent",
        color: "var(--text-secondary)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        position: "relative",
        transition:
          "background var(--dur-1) var(--ease), color var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease)",
        flexShrink: 0,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--surface-2)";
        e.currentTarget.style.borderColor = "var(--border)";
        e.currentTarget.style.color = "var(--text)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.borderColor = "transparent";
        e.currentTarget.style.color = "var(--text-secondary)";
      }}
    >
      {children}
    </button>
  );
}

function ChannelIcon({ channel }: { channel: string }) {
  const p = { size: 14, strokeWidth: 1.9, "aria-hidden": true } as const;
  switch (channel) {
    case "email":
      return <Mail {...p} />;
    case "teams":
    case "chat":
      return <MessageSquare {...p} />;
    case "webhook":
      return <Webhook {...p} />;
    default:
      return <Bell {...p} />;
  }
}

function sectionTitle(pathname: string, isAgent: boolean): string {
  if (pathname === "/") return "Home";
  if (pathname.startsWith("/tickets/")) return isAgent ? "Ticket" : "Request";
  if (pathname.startsWith("/tickets")) return isAgent ? "Tickets" : "My Requests";
  if (pathname.startsWith("/knowledge-base")) return isAgent ? "Knowledge Base" : "Help Center";
  if (pathname.startsWith("/problems")) return "Problems";
  if (pathname.startsWith("/changes")) return "Changes";
  if (pathname.startsWith("/assets")) return "Assets & CMDB";
  if (pathname.startsWith("/analytics")) return "Insights";
  if (pathname.startsWith("/portal")) return "Help Center";
  if (pathname.startsWith("/audit")) return "Audit Trail";
  if (pathname.startsWith("/settings")) return "Settings";
  if (pathname.startsWith("/profile")) return "Your Profile";
  return "Netlink Support";
}

/** Parent crumb for the breadcrumb trail; mirrors the IconRail groupings. */
function sectionParent(
  pathname: string,
  isAgent: boolean
): { label: string; href?: string } | null {
  if (!isAgent) {
    if (pathname.startsWith("/tickets/")) return { label: "My Requests", href: "/tickets" };
    return null;
  }
  if (pathname === "/") return { label: "Dashboard" };
  if (pathname.startsWith("/tickets/")) return { label: "Tickets", href: "/tickets" };
  if (
    pathname.startsWith("/tickets") ||
    pathname.startsWith("/problems") ||
    pathname.startsWith("/changes")
  ) {
    return { label: "Operations" };
  }
  if (
    pathname.startsWith("/assets") ||
    pathname.startsWith("/knowledge-base") ||
    pathname.startsWith("/analytics") ||
    pathname.startsWith("/audit")
  ) {
    return { label: "Resources" };
  }
  if (pathname.startsWith("/settings") || pathname.startsWith("/profile")) {
    return { label: "Workspace" };
  }
  return null;
}
