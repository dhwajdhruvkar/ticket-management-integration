"use client";

// =============================================================================
// Persona — the signed-in identity context + user-menu switcher.
//
// usePersona() exposes the current user (id, role, email, initials) derived
// from the NextAuth session so any client component can branch on role without
// re-fetching. PersonaSwitcher renders the top-bar user menu and, in demo mode,
// lets you sign in as a seeded user via the demo credentials provider. This is
// the single source of client-side identity — no localStorage.
// =============================================================================

import { User, LogOut, Settings } from "lucide-react";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { signIn, signOut, useSession } from "next-auth/react";
import { apiGet } from "@/lib/api";
import type { Role, UserRow } from "@/server/domain/models";

// =============================================================================
// Identity context: the signed-in user, backed by the NextAuth session.
//
// Replaces the old localStorage persona layer. The session (JWT cookie)
// carries id/role/tenant; the provider enriches it with the user's profile
// from /api/v1/me. `role` is the layout role (agents get the workspace,
// requesters the portal views); `serverRole` is the exact RBAC role.
// =============================================================================

export interface Persona {
  id: string;
  name: string;
  /** Layout role: anything above requester gets the agent workspace. */
  role: "agent" | "requester";
  serverRole: Role;
  initials: string;
  title?: string;
  email: string;
}

interface PersonaApi {
  persona: Persona;
  ready: boolean;
  /** Demo mode (server-reported): enables the demo identity switcher. */
  demoMode: boolean;
}

const PersonaContext = createContext<PersonaApi | null>(null);

const FALLBACK: Persona = {
  id: "",
  name: "—",
  role: "agent",
  serverRole: "agent",
  initials: "·",
  email: "",
};

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "·";
}

export function PersonaProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const [profile, setProfile] = useState<{
    initials?: string | null;
    title?: string | null;
    demoMode?: boolean;
  } | null>(null);

  const sessionUserId = session?.user?.id;
  useEffect(() => {
    if (!sessionUserId) {
      setProfile(null);
      return;
    }
    apiGet<{ initials?: string | null; title?: string | null; demoMode?: boolean }>("/me")
      .then(setProfile)
      .catch(() => setProfile(null));
  }, [sessionUserId]);

  const value = useMemo<PersonaApi>(() => {
    if (status !== "authenticated" || !session?.user) {
      return { persona: FALLBACK, ready: status !== "loading", demoMode: false };
    }
    const serverRole = (session.user.role ?? "requester") as Role;
    const name = session.user.name ?? session.user.email ?? "User";
    return {
      persona: {
        id: session.user.id ?? "",
        name,
        role: serverRole === "requester" ? "requester" : "agent",
        serverRole,
        initials: profile?.initials ?? initialsOf(name),
        title: profile?.title ?? undefined,
        email: session.user.email ?? "",
      },
      ready: true,
      demoMode: profile?.demoMode ?? false,
    };
  }, [session, status, profile]);

  return <PersonaContext.Provider value={value}>{children}</PersonaContext.Provider>;
}

export function usePersona(): PersonaApi {
  const ctx = useContext(PersonaContext);
  if (!ctx) {
    throw new Error("usePersona() must be used inside <PersonaProvider>");
  }
  return ctx;
}

/**
 * User menu: shows the signed-in user, profile/settings shortcuts, demo user
 * switching (demo mode only — a real credentials sign-in), and sign out.
 */
export function PersonaSwitcher({
  placement = "sidebar",
}: {
  placement?: "sidebar" | "topbar";
}) {
  const { persona, ready, demoMode } = usePersona();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [switching, setSwitching] = useState<string | null>(null);
  const isTopbar = placement === "topbar";

  useEffect(() => {
    // The switch-user list is a demo-mode convenience; production users only
    // ever act as themselves (the demo credentials provider doesn't exist).
    if (!open || !demoMode || users.length > 0) return;
    apiGet<UserRow[]>("/users").then(setUsers).catch(() => {});
  }, [open, demoMode, users.length]);

  async function switchTo(email: string) {
    if (email.toLowerCase() === persona.email.toLowerCase()) {
      setOpen(false);
      return;
    }
    setSwitching(email);
    // A real session change: sign in as the chosen demo user. Requesters land
    // on their requests view since agent pages redirect them anyway.
    await signIn("demo", { email, callbackUrl: "/" });
  }

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  const switchable = demoMode ? users : [];
  const leadership = switchable.filter((u) =>
    ["manager", "tenant_admin", "super_admin"].includes(u.role)
  );
  const agents = switchable.filter((u) => u.role === "agent");
  const requesters = switchable.filter((u) => u.role === "requester");

  const menuStyle: React.CSSProperties = isTopbar
    ? {
        position: "fixed",
        top: 64,
        right: 12,
        width: "min(260px, calc(100vw - 24px))",
        maxHeight: "min(480px, 75vh)",
        overflow: "auto",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--r-lg)",
        boxShadow: "var(--shadow-lg)",
        padding: 6,
        zIndex: 40,
      }
    : {
        position: "absolute",
        bottom: "calc(100% + 8px)",
        left: 0,
        right: 0,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--r-lg)",
        boxShadow: "var(--shadow-lg)",
        padding: 6,
        zIndex: 40,
      };

  return (
    <div style={{ position: "relative" }}>
      {open ? (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 39 }}
            aria-hidden
          />
          <div role="menu" className={isTopbar ? "menu-pop" : "menu-pop-left"} style={menuStyle}>
            {/* Current user header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "0.5rem 0.55rem 0.6rem",
              }}
            >
              <Avatar persona={persona} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontSize: "0.82rem",
                    fontWeight: 700,
                    color: "var(--text)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {persona.name}
                </div>
                <div
                  className="muted"
                  style={{
                    fontSize: "0.68rem",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {persona.email || persona.title || "Signed in"}
                </div>
              </div>
            </div>

            <MenuAction label="View profile" icon={<UserIcon />} onClick={() => go("/profile")} />
            {persona.role === "agent" ? (
              <MenuAction label="Settings" icon={<GearMiniIcon />} onClick={() => go("/settings")} />
            ) : null}

            {switchable.length > 0 ? <Divider /> : null}

            {leadership.length > 0 ? (
              <>
                <MenuGroup label="Switch user · Leadership" />
                {leadership.map((u) => (
                  <UserOption
                    key={u.id}
                    user={u}
                    active={u.email.toLowerCase() === persona.email.toLowerCase()}
                    busy={switching === u.email}
                    onClick={() => void switchTo(u.email)}
                  />
                ))}
              </>
            ) : null}
            {agents.length > 0 ? (
              <>
                <MenuGroup label="Agents" />
                {agents.map((u) => (
                  <UserOption
                    key={u.id}
                    user={u}
                    active={u.email.toLowerCase() === persona.email.toLowerCase()}
                    busy={switching === u.email}
                    onClick={() => void switchTo(u.email)}
                  />
                ))}
              </>
            ) : null}
            {requesters.length > 0 ? (
              <>
                <MenuGroup label="Requesters" />
                {requesters.map((u) => (
                  <UserOption
                    key={u.id}
                    user={u}
                    active={u.email.toLowerCase() === persona.email.toLowerCase()}
                    busy={switching === u.email}
                    onClick={() => void switchTo(u.email)}
                  />
                ))}
              </>
            ) : null}

            <Divider />
            <MenuAction
              label="Sign out"
              icon={<SignOutIcon />}
              onClick={() => void signOut({ callbackUrl: "/signin" })}
            />
          </div>
        </>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          width: isTopbar ? "auto" : "100%",
          height: isTopbar ? 36 : undefined,
          display: "flex",
          alignItems: "center",
          gap: isTopbar ? 8 : 10,
          padding: isTopbar ? "0 10px 0 4px" : "0.6rem 0.7rem",
          borderRadius: isTopbar ? 999 : 10,
          background: "var(--surface-2)",
          border: `1px solid var(--border)`,
          cursor: "pointer",
          transition: "background 0.18s ease, border-color 0.18s ease",
          textAlign: "left",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--brand-50)";
          e.currentTarget.style.borderColor = "var(--brand-100)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "var(--surface-2)";
          e.currentTarget.style.borderColor = "var(--border)";
        }}
      >
        <Avatar persona={persona} size={isTopbar ? 28 : 34} />
        {isTopbar ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6, lineHeight: 1 }}>
            <span
              style={{
                fontSize: "0.82rem",
                fontWeight: 700,
                color: "var(--text)",
                whiteSpace: "nowrap",
              }}
            >
              {ready ? persona.name : "—"}
            </span>
            <span aria-hidden style={{ color: "var(--muted)", fontSize: "0.6rem" }}>
              ▼
            </span>
          </div>
        ) : (
          <>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontSize: "0.82rem",
                  fontWeight: 700,
                  color: "var(--text)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {ready ? persona.name : "—"}
              </div>
              <div
                className="muted"
                style={{
                  fontSize: "0.7rem",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {ready ? persona.title ?? "Requester" : ""}
              </div>
            </div>
            <span aria-hidden style={{ color: "var(--muted)", fontSize: "0.7rem" }}>
              {open ? "▲" : "▼"}
            </span>
          </>
        )}
      </button>
    </div>
  );
}

function UserOption({
  user,
  active,
  busy,
  onClick,
}: {
  user: UserRow;
  active: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={busy}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "0.5rem 0.55rem",
        borderRadius: 9,
        border: "none",
        cursor: "pointer",
        background: active ? "var(--brand-50)" : "transparent",
        textAlign: "left",
        opacity: busy ? 0.6 : 1,
        transition: "background 0.15s ease",
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = "var(--surface-2)";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = "transparent";
      }}
    >
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: 999,
          background: user.role === "requester" ? "var(--surface-3)" : "var(--brand-gradient)",
          color: user.role === "requester" ? "var(--text-secondary)" : "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 700,
          fontSize: "0.7rem",
          flexShrink: 0,
        }}
      >
        {user.initials ?? initialsOf(user.name)}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text)" }}>
          {busy ? "Switching…" : user.name}
        </div>
        <div className="muted" style={{ fontSize: "0.68rem" }}>
          {user.title ?? user.role}
        </div>
      </div>
      <RoleChip role={user.role} />
      {active ? <span style={{ color: "var(--brand-600)", fontWeight: 800 }}>✓</span> : null}
    </button>
  );
}

const ROLE_CHIP: Record<string, { label: string; bg: string; fg: string; border: string }> = {
  super_admin: { label: "Admin", bg: "var(--violet-bg)", fg: "var(--violet-fg)", border: "var(--violet-border)" },
  tenant_admin: { label: "Admin", bg: "var(--brand-50)", fg: "var(--brand-700)", border: "var(--brand-100)" },
  manager: { label: "Manager", bg: "var(--warning-bg)", fg: "var(--warning-fg)", border: "var(--warning-border)" },
  agent: { label: "Agent", bg: "var(--info-bg)", fg: "var(--info-fg)", border: "var(--info-border)" },
};

function RoleChip({ role }: { role: string }) {
  const tone = ROLE_CHIP[role];
  if (!tone) return null;
  return (
    <span
      className="badge"
      style={{
        background: tone.bg,
        color: tone.fg,
        borderColor: tone.border,
        fontSize: "0.58rem",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        flexShrink: 0,
      }}
    >
      {tone.label}
    </span>
  );
}

function MenuGroup({ label }: { label: string }) {
  return (
    <div
      className="label"
      style={{ padding: "0.45rem 0.55rem 0.25rem", fontSize: "0.62rem", color: "var(--muted)" }}
    >
      {label}
    </div>
  );
}

function MenuAction({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "0.5rem 0.55rem",
        borderRadius: 9,
        border: "none",
        cursor: "pointer",
        background: "transparent",
        textAlign: "left",
        color: "var(--text)",
        fontSize: "0.82rem",
        fontWeight: 600,
        transition: "background 0.15s ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--surface-2)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <span style={{ color: "var(--muted)", display: "inline-flex", width: 18, justifyContent: "center" }}>
        {icon}
      </span>
      {label}
    </button>
  );
}

function Divider() {
  return <div aria-hidden style={{ height: 1, background: "var(--border)", margin: "6px 4px" }} />;
}

function UserIcon() {
  return <User size={15} strokeWidth={1.9} aria-hidden />;
}

function SignOutIcon() {
  return <LogOut size={15} strokeWidth={1.9} aria-hidden />;
}

function GearMiniIcon() {
  return <Settings size={15} strokeWidth={1.9} aria-hidden />;
}

function Avatar({ persona, size = 34 }: { persona: Persona; size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        background: persona.role === "agent" ? "var(--brand-gradient)" : "var(--surface-3)",
        color: persona.role === "agent" ? "#fff" : "var(--text-secondary)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 700,
        fontSize: size <= 28 ? "0.7rem" : "0.78rem",
        flexShrink: 0,
        boxShadow: persona.role === "agent" ? "var(--shadow-brand)" : "none",
        border: persona.role === "agent" ? "none" : "1px solid var(--border)",
      }}
    >
      {persona.initials}
    </div>
  );
}
