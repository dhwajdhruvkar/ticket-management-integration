"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { signOut } from "next-auth/react";
import { usePersona } from "@/components/Persona";
import { useTheme } from "@/components/Theme";
import { useToast } from "@/components/Toast";
import { StatusBadge, timeAgo } from "@/components/ui";
import { apiGet, apiSend } from "@/lib/api";
import type { TicketRow, TicketStatus, UserPreferences } from "@/server/domain/models";

// =============================================================================
// ProfileView — the signed-in user's account page.
//
// Identity comes from the session; profile fields and notification preferences
// live on the server User record (GET/PATCH /api/v1/me). The activity summary
// is computed from the user's tickets via the API. Every card is a real
// interaction — copyable facts, clickable stat tiles that filter Tickets, a
// live activity timeline, timezone detection, and preferences that persist.
// =============================================================================

const UNSOLVED: TicketStatus[] = ["new", "open", "in_progress", "pending", "pending_agent", "escalated", "reopened"];
const SOLVED: TicketStatus[] = ["auto_resolved", "resolved", "closed"];

const DEFAULT_PREFERENCES: UserPreferences = {
  emailNotifications: true,
  desktopNotifications: false,
  weeklyDigest: true,
  mentionAlerts: true,
  monthlyReport: true,
};

const REPORT_ROLES = ["manager", "tenant_admin", "super_admin"];

interface Me {
  id: string | null;
  name: string;
  email: string | null;
  role: string;
  title: string | null;
  department: string | null;
  initials: string | null;
  phone: string | null;
  location: string | null;
  timezone: string | null;
  bio: string | null;
  preferences: UserPreferences | null;
  memberSince: string | null;
  available?: boolean;
}

interface ProfileForm {
  name: string;
  title: string;
  phone: string;
  department: string;
  location: string;
  timezone: string;
  bio: string;
}

interface StatTile {
  key: string;
  label: string;
  value: string | number;
  hint?: string;
  tone: "info" | "warning" | "success" | "brand";
  icon: React.ReactNode;
  href?: string;
  trend?: string;
}

function toForm(me: Me): ProfileForm {
  return {
    name: me.name,
    title: me.title ?? "",
    phone: me.phone ?? "",
    department: me.department ?? "",
    location: me.location ?? "",
    timezone: me.timezone ?? "",
    bio: me.bio ?? "",
  };
}

export default function ProfileView() {
  const router = useRouter();
  const { persona, ready } = usePersona();
  const { theme, toggle } = useTheme();
  const toast = useToast();

  const [me, setMe] = useState<Me | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<ProfileForm | null>(null);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(() => {
    apiGet<Me>("/me")
      .then((m) => {
        setMe(m);
        setForm(toForm(m));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!ready) return;
    load();
    setEditing(false);
    apiGet<TicketRow[]>("/tickets").then(setTickets).catch(() => setTickets([]));
  }, [ready, persona.id, load]);

  const isAgent = persona.role === "agent";

  const stats = useMemo<StatTile[]>(() => {
    if (isAgent) {
      const mine = tickets.filter((t) => t.assigneeId === persona.id);
      const open = mine.filter((t) => UNSOLVED.includes(t.status)).length;
      const resolved = mine.filter((t) => SOLVED.includes(t.status)).length;
      const rated = mine.filter((t) => t.satisfaction);
      const satisfied = rated.filter((t) => t.satisfaction === "satisfied").length;
      const csat = rated.length ? Math.round((satisfied / rated.length) * 100) : null;
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const resolvedThisWeek = mine.filter(
        (t) => SOLVED.includes(t.status) && t.resolvedAt && new Date(t.resolvedAt).getTime() >= weekAgo
      ).length;
      return [
        {
          key: "assigned",
          label: "Assigned to me",
          value: mine.length,
          tone: "brand",
          icon: <InboxIcon />,
          href: "/tickets",
          trend: mine.length === 0 ? undefined : `${open} unsolved`,
        },
        {
          key: "open",
          label: "Open",
          value: open,
          tone: "info",
          icon: <FolderIcon />,
          href: "/tickets",
          trend: open === 0 ? "All clear" : undefined,
        },
        {
          key: "resolved",
          label: "Resolved",
          value: resolved,
          tone: "success",
          icon: <CheckIcon />,
          href: "/tickets",
          trend: resolvedThisWeek ? `+${resolvedThisWeek} this week` : undefined,
        },
        {
          key: "csat",
          label: "CSAT",
          value: csat === null ? "—" : `${csat}%`,
          hint: rated.length ? `${rated.length} rated` : "no ratings yet",
          tone: "warning",
          icon: <StarIcon />,
        },
      ];
    }
    // The server already scopes requester ticket lists to their own records.
    const open = tickets.filter((t) => UNSOLVED.includes(t.status)).length;
    const resolved = tickets.filter((t) => SOLVED.includes(t.status)).length;
    const auto = tickets.filter((t) => t.status === "auto_resolved").length;
    return [
      { key: "raised", label: "Requests raised", value: tickets.length, tone: "brand", icon: <InboxIcon />, href: "/tickets" },
      { key: "open", label: "Open", value: open, tone: "info", icon: <FolderIcon />, href: "/tickets" },
      { key: "resolved", label: "Resolved", value: resolved, tone: "success", icon: <CheckIcon />, href: "/tickets" },
      { key: "auto", label: "Instantly solved", value: auto, hint: "by the assistant", tone: "warning", icon: <SparklesIcon /> },
    ];
  }, [tickets, isAgent, persona.id]);

  const activity = useMemo(() => {
    return [...tickets]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 6);
  }, [tickets]);

  if (!ready || !me || !form) {
    return (
      <div className="page-pad">
        <div className="skel" style={{ height: 200, borderRadius: 20, marginBottom: 20 }} />
        <div className="skel" style={{ height: 340, borderRadius: 20 }} />
      </div>
    );
  }

  const preferences = me.preferences ?? DEFAULT_PREFERENCES;

  function startEdit() {
    if (me) setForm(toForm(me));
    setEditing(true);
  }

  function cancelEdit() {
    if (me) setForm(toForm(me));
    setEditing(false);
  }

  async function save() {
    if (!form) return;
    if (!form.name.trim()) {
      toast.error({ title: "Name is required" });
      return;
    }
    setSaving(true);
    try {
      await apiSend("/me", "PATCH", {
        name: form.name.trim(),
        title: form.title.trim() || null,
        phone: form.phone.trim() || null,
        department: form.department.trim() || null,
        location: form.location.trim() || null,
        timezone: form.timezone.trim() || null,
        bio: form.bio.trim() || null,
      });
      load();
      setEditing(false);
      toast.success({ title: "Profile updated", description: "Your changes have been saved." });
    } catch (err) {
      toast.error({ title: "Could not save profile", description: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  }

  async function setPref(key: keyof UserPreferences, value: boolean) {
    const next = { ...preferences, [key]: value };
    setMe((m) => (m ? { ...m, preferences: next } : m));
    try {
      await apiSend("/me", "PATCH", { preferences: next });
    } catch (err) {
      load();
      toast.error({ title: "Could not save preference", description: err instanceof Error ? err.message : String(err) });
    }
  }

  async function setAvailable(value: boolean) {
    setMe((m) => (m ? { ...m, available: value } : m));
    try {
      await apiSend("/me", "PATCH", { available: value });
      toast.success({ title: value ? "You're now Available" : "You're now Away", description: value ? "You can be assigned new tickets." : "Dispatchers will see you as unavailable." });
    } catch (err) {
      load();
      toast.error({ title: "Could not update availability", description: err instanceof Error ? err.message : String(err) });
    }
  }

  const update = (key: keyof ProfileForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => (f ? { ...f, [key]: e.target.value } : f));

  async function copy(value: string, key: string) {
    if (!value || value === "—") return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600);
    } catch {
      toast.error({ title: "Could not copy", description: "Clipboard access denied." });
    }
  }

  function detectTimezone() {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      setForm((f) => (f ? { ...f, timezone: tz } : f));
      toast.info({ title: "Timezone detected", description: tz });
    } catch {
      toast.error({ title: "Could not detect timezone" });
    }
  }

  const initials = me.initials ?? persona.initials;
  const profileCompleteness = computeCompleteness(me);

  return (
    <div className="page-pad anim-fade-up">
      <div style={{ maxWidth: 1120, margin: "0 auto" }}>
        {/* Hero ---------------------------------------------------------- */}
        <section
          style={{
            position: "relative",
            borderRadius: 20,
            overflow: "hidden",
            marginBottom: 20,
            border: "1px solid var(--border)",
            background: "var(--surface)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <div
            style={{
              height: 110,
              background:
                "radial-gradient(120% 100% at 0% 0%, rgba(59,130,246,0.5), transparent 55%), linear-gradient(120deg, var(--brand-600), var(--brand-500) 55%, var(--brand-300))",
              position: "relative",
            }}
          >
            <div
              aria-hidden
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "radial-gradient(70% 100% at 100% 100%, rgba(255,255,255,0.18), transparent 60%)",
              }}
            />
          </div>
          <div style={{ padding: "0 1.5rem 1.4rem" }}>
            {/* Only the avatar straddles the banner; the action buttons sit
                bottom-aligned beside it, fully inside the white area. */}
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "space-between",
                gap: 16,
                marginTop: -46,
                flexWrap: "wrap",
              }}
            >
              <BigAvatar initials={initials} isAgent={isAgent} />

              <div style={{ display: "flex", gap: 8, paddingBottom: 6, flexShrink: 0, flexWrap: "wrap" }}>
                {editing ? (
                  <>
                    <button className="btn btn-ghost" onClick={cancelEdit} disabled={saving}>
                      Cancel
                    </button>
                    <button className="btn btn-primary" onClick={save} disabled={saving}>
                      {saving ? "Saving…" : "Save changes"}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => void copy(shareUrl(me), "share")}
                      title="Copy profile link"
                    >
                      <LinkIcon />
                      <span style={{ marginLeft: 6 }}>{copied === "share" ? "Copied!" : "Share"}</span>
                    </button>
                    <button className="btn btn-primary" onClick={startEdit}>
                      <EditIcon />
                      <span style={{ marginLeft: 6 }}>Edit profile</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Identity block in normal flow, below the banner, so the name
                and badges never clip into the gradient at any width. */}
            <div style={{ marginTop: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <h1
                  style={{
                    fontSize: "1.6rem",
                    fontWeight: 800,
                    letterSpacing: "-0.025em",
                    color: "var(--text)",
                    margin: 0,
                    lineHeight: 1.15,
                  }}
                >
                  {me.name}
                </h1>
                <RoleBadge role={me.role} />
                {isAgent ? <PresenceChip available={me.available !== false} /> : null}
              </div>
              <div className="muted" style={{ fontSize: "0.9rem", marginTop: 4 }}>
                {me.title ?? "—"}
                {me.department ? ` · ${me.department}` : ""}
              </div>
            </div>

            {/* Copyable contact chips */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                marginTop: 16,
                paddingTop: 16,
                borderTop: "1px solid var(--border)",
              }}
            >
              <CopyChip
                icon={<MailIcon />}
                value={me.email ?? "—"}
                onClick={() => void copy(me.email ?? "", "email")}
                copied={copied === "email"}
              />
              <CopyChip
                icon={<PhoneIcon />}
                value={me.phone ?? "—"}
                onClick={() => void copy(me.phone ?? "", "phone")}
                copied={copied === "phone"}
              />
              <Chip icon={<PinIcon />} value={me.location ?? "—"} />
              <Chip icon={<ClockIcon />} value={me.timezone ?? "—"} />
              <Chip icon={<CalendarIcon />} value={`Joined ${formatJoined(me.memberSince)}`} />
            </div>

            {profileCompleteness < 100 && !editing ? (
              <CompletenessNudge pct={profileCompleteness} onEdit={startEdit} />
            ) : null}
          </div>
        </section>

        {/* Interactive stat tiles ---------------------------------------- */}
        <div className="grid-kpis stagger" style={{ gap: 12, marginBottom: 20 }}>
          {stats.map((s) => (
            <StatTileCard key={s.key} tile={s} onNav={s.href ? () => router.push(s.href!) : undefined} />
          ))}
        </div>

        {/* Two-column body ----------------------------------------------- */}
        <div className="profile-grid">
          {/* Main column */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* About */}
            <section className="panel" style={{ padding: "1.1rem 1.2rem" }}>
              <SectionHeader title="About" icon={<UserIcon />} />
              {editing ? (
                <textarea
                  className="textarea"
                  rows={4}
                  value={form.bio}
                  onChange={update("bio")}
                  placeholder="Tell your colleagues a little about what you do…"
                />
              ) : (
                <p style={{ margin: 0, fontSize: "0.9rem", lineHeight: 1.6, color: "var(--text-secondary)" }}>
                  {me.bio || "No bio added yet."}
                </p>
              )}
            </section>

            {/* Contact information */}
            <section className="panel" style={{ padding: "1.1rem 1.2rem" }}>
              <SectionHeader title="Contact information" icon={<AddressIcon />} />
              <div className="contact-grid">
                <Field label="Full name" editing={editing} value={form.name} display={me.name} onChange={update("name")} />
                <Field label="Job title" editing={editing} value={form.title} display={me.title ?? ""} onChange={update("title")} />
                <Field
                  label="Email (sign-in identity)"
                  editing={false}
                  value={me.email ?? ""}
                  display={me.email ?? ""}
                  onChange={() => {}}
                  locked
                />
                <Field label="Phone" editing={editing} value={form.phone} display={me.phone ?? ""} onChange={update("phone")} />
                <Field label="Department" editing={editing} value={form.department} display={me.department ?? ""} onChange={update("department")} />
                <Field label="Location" editing={editing} value={form.location} display={me.location ?? ""} onChange={update("location")} />
                <TimezoneField
                  editing={editing}
                  value={form.timezone}
                  display={me.timezone ?? ""}
                  onChange={update("timezone")}
                  onDetect={detectTimezone}
                />
              </div>
            </section>

            {/* Recent activity */}
            <section className="panel" style={{ padding: "1.1rem 1.2rem" }}>
              <SectionHeader
                title="Recent activity"
                icon={<ActivityIcon />}
                right={
                  <Link href="/tickets" className="chip-link" style={{ fontSize: "0.8rem" }}>
                    View all →
                  </Link>
                }
              />
              {activity.length === 0 ? (
                <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>
                  No activity yet. Once you raise or interact with tickets, they&apos;ll show up here.
                </p>
              ) : (
                <ol className="timeline" style={{ margin: 0, padding: 0, listStyle: "none" }}>
                  {activity.map((t) => (
                    <TimelineItem key={t.id} ticket={t} onOpen={() => router.push(`/tickets/${t.id}`)} />
                  ))}
                </ol>
              )}
            </section>
          </div>

          {/* Side column */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Preferences */}
            <section className="panel" style={{ padding: "1.1rem 1.2rem" }}>
              <SectionHeader title="Preferences" icon={<BellIcon />} />
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {isAgent ? (
                  <Toggle
                    label="Available for new tickets"
                    hint="Turn off when away; dispatchers see you as unavailable"
                    icon={<UserIcon />}
                    checked={me.available !== false}
                    onChange={(v) => void setAvailable(v)}
                  />
                ) : null}
                <Toggle
                  label="Email notifications"
                  hint="Ticket updates and replies"
                  icon={<MailIcon />}
                  checked={preferences.emailNotifications}
                  onChange={(v) => void setPref("emailNotifications", v)}
                />
                <Toggle
                  label="Desktop notifications"
                  hint="Browser alerts while you work"
                  icon={<MonitorIcon />}
                  checked={preferences.desktopNotifications}
                  onChange={(v) => void setPref("desktopNotifications", v)}
                />
                {isAgent ? (
                  <Toggle
                    label="@mention alerts"
                    hint="When a teammate mentions you"
                    icon={<AtIcon />}
                    checked={preferences.mentionAlerts}
                    onChange={(v) => void setPref("mentionAlerts", v)}
                  />
                ) : null}
                <Toggle
                  label="Weekly digest"
                  hint="A summary every Monday"
                  icon={<DigestIcon />}
                  checked={preferences.weeklyDigest}
                  onChange={(v) => void setPref("weeklyDigest", v)}
                />
                {REPORT_ROLES.includes(persona.serverRole) ? (
                  <Toggle
                    label="Monthly report"
                    hint="A PDF summary emailed on the 1st"
                    icon={<DigestIcon />}
                    checked={preferences.monthlyReport !== false}
                    onChange={(v) => void setPref("monthlyReport", v)}
                  />
                ) : null}
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingTop: 14,
                  marginTop: 10,
                  borderTop: "1px solid var(--border)",
                  gap: 12,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <IconTile tone="brand">{theme === "dark" ? <MoonIcon /> : <SunIcon />}</IconTile>
                  <div>
                    <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text)" }}>
                      Appearance
                    </div>
                    <div className="muted" style={{ fontSize: "0.72rem" }}>
                      Currently {theme} mode
                    </div>
                  </div>
                </div>
                <ThemeToggle theme={theme} onToggle={toggle} />
              </div>
            </section>

            {/* Account */}
            <section className="panel" style={{ padding: "1.1rem 1.2rem" }}>
              <SectionHeader title="Account" icon={<ShieldIcon />} />
              <Row k="User ID" v={me.id ?? "—"} mono />
              <Row k="Role" v={me.role.replace("_", " ")} />
              <Row k="Member since" v={formatJoined(me.memberSince)} />
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  paddingTop: 12,
                  marginTop: 6,
                  borderTop: "1px solid var(--border)",
                  flexWrap: "wrap",
                }}
              >
                <Link href="/settings" className="btn btn-ghost" style={{ flex: 1, minWidth: 120 }}>
                  <SettingsIcon /> <span style={{ marginLeft: 6 }}>Settings</span>
                </Link>
                <button
                  type="button"
                  onClick={() => void signOut({ callbackUrl: "/signin" })}
                  className="btn btn-ghost"
                  style={{ flex: 1, minWidth: 120, color: "var(--danger-fg)" }}
                >
                  <SignOutIcon /> <span style={{ marginLeft: 6 }}>Sign out</span>
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>

      <style jsx>{`
        .profile-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
          gap: 20px;
          align-items: start;
        }
        .contact-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 14px;
        }
        @media (max-width: 860px) {
          .profile-grid {
            grid-template-columns: 1fr;
          }
        }
        .timeline {
          position: relative;
        }
        .timeline::before {
          content: "";
          position: absolute;
          left: 10px;
          top: 6px;
          bottom: 6px;
          width: 2px;
          background: var(--border);
          border-radius: 2px;
        }
      `}</style>
    </div>
  );
}

/* =========================================================================
   Sub-components
   ========================================================================= */

function shareUrl(me: Me): string {
  if (typeof window === "undefined") return me.email ?? "";
  const url = new URL(window.location.href);
  return `${url.origin}/profile`;
}

function computeCompleteness(me: Me): number {
  const fields: Array<string | null | undefined> = [
    me.name,
    me.title,
    me.phone,
    me.department,
    me.location,
    me.timezone,
    me.bio,
  ];
  const filled = fields.filter((f) => (f ?? "").toString().trim().length > 0).length;
  return Math.round((filled / fields.length) * 100);
}

function formatJoined(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function CompletenessNudge({ pct, onEdit }: { pct: number; onEdit: () => void }) {
  return (
    <div
      style={{
        marginTop: 16,
        padding: "0.7rem 0.9rem",
        borderRadius: 12,
        border: "1px dashed var(--brand-300)",
        background: "var(--brand-50)",
        color: "var(--brand-700)",
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 220 }}>
        <div
          aria-hidden
          style={{
            width: 36,
            height: 36,
            borderRadius: 999,
            background: "var(--brand-100)",
            color: "var(--brand-700)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <SparklesIcon />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: "0.85rem", fontWeight: 700 }}>
            Your profile is {pct}% complete
          </div>
          <div
            aria-hidden
            style={{
              width: "100%",
              height: 6,
              borderRadius: 999,
              background: "var(--brand-100)",
              marginTop: 6,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${pct}%`,
                height: "100%",
                background: "var(--brand-gradient)",
                borderRadius: 999,
                transition: "width var(--dur-3) var(--ease-out)",
              }}
            />
          </div>
        </div>
      </div>
      <button className="btn btn-ghost" onClick={onEdit} style={{ borderColor: "var(--brand-300)" }}>
        Complete profile
      </button>
    </div>
  );
}

function StatTileCard({ tile, onNav }: { tile: StatTile; onNav?: () => void }) {
  const tone = TONES[tile.tone];
  const clickable = !!onNav;
  return (
    <button
      type="button"
      onClick={onNav}
      disabled={!clickable}
      className={clickable ? "hover-lift stat-tile" : "stat-tile"}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "0.95rem 1.05rem",
        borderRadius: 14,
        border: "1px solid var(--border)",
        background: "var(--surface)",
        cursor: clickable ? "pointer" : "default",
        textAlign: "left",
        transition:
          "border-color var(--dur-2) var(--ease), box-shadow var(--dur-2) var(--ease), transform var(--dur-2) var(--ease-out)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <IconTile tone={tile.tone}>{tile.icon}</IconTile>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontSize: "1.55rem",
            fontWeight: 800,
            letterSpacing: "-0.025em",
            lineHeight: 1,
            color: "var(--text)",
          }}
        >
          {tile.value}
        </div>
        <div
          style={{
            fontSize: "0.78rem",
            fontWeight: 600,
            color: "var(--text-secondary)",
            marginTop: 6,
          }}
        >
          {tile.label}
        </div>
        {tile.trend || tile.hint ? (
          <div
            style={{
              fontSize: "0.7rem",
              marginTop: 4,
              color: tile.trend ? tone.fg : "var(--muted)",
              fontWeight: tile.trend ? 600 : 500,
            }}
          >
            {tile.trend ?? tile.hint}
          </div>
        ) : null}
      </div>
    </button>
  );
}

function IconTile({ tone, children }: { tone: StatTile["tone"]; children: React.ReactNode }) {
  const t = TONES[tone];
  return (
    <div
      aria-hidden
      style={{
        width: 40,
        height: 40,
        borderRadius: 10,
        background: t.bg,
        color: t.fg,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {children}
    </div>
  );
}

const TONES: Record<StatTile["tone"], { bg: string; fg: string }> = {
  brand: { bg: "var(--brand-50)", fg: "var(--brand-700)" },
  info: { bg: "var(--info-bg)", fg: "var(--info-fg)" },
  success: { bg: "var(--success-bg)", fg: "var(--success-fg)" },
  warning: { bg: "var(--warning-bg)", fg: "var(--warning-fg)" },
};

function SectionHeader({
  title,
  icon,
  right,
}: {
  title: string;
  icon?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 12,
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {icon ? <span style={{ color: "var(--muted)", display: "inline-flex" }}>{icon}</span> : null}
        <span
          className="label"
          style={{ fontSize: "0.7rem", letterSpacing: "0.06em", margin: 0 }}
        >
          {title}
        </span>
      </div>
      {right}
    </div>
  );
}

function TimelineItem({ ticket, onOpen }: { ticket: TicketRow; onOpen: () => void }) {
  return (
    <li
      style={{
        position: "relative",
        paddingLeft: 34,
        paddingBottom: 12,
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: 4,
          top: 4,
          width: 14,
          height: 14,
          borderRadius: 999,
          border: "3px solid var(--surface)",
          background: STATUS_DOT_COLOR[ticket.status] ?? "var(--muted-soft)",
          boxShadow: "0 0 0 1px var(--border)",
        }}
      />
      <button
        type="button"
        onClick={onOpen}
        style={{
          display: "block",
          width: "100%",
          textAlign: "left",
          background: "transparent",
          border: "1px solid transparent",
          borderRadius: 8,
          padding: "0.35rem 0.5rem",
          cursor: "pointer",
          transition: "background var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease)",
        }}
        className="timeline-btn"
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <StatusBadge status={ticket.status} />
          <span className="mono" style={{ fontSize: "0.72rem", color: "var(--muted)" }}>
            {ticket.reference}
          </span>
          <span
            className="muted"
            style={{ fontSize: "0.72rem", marginLeft: "auto" }}
          >
            {timeAgo(ticket.updatedAt)}
          </span>
        </div>
        <div
          style={{
            fontSize: "0.85rem",
            fontWeight: 600,
            color: "var(--text)",
            marginTop: 4,
            display: "-webkit-box",
            WebkitLineClamp: 1,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {ticket.subject}
        </div>
      </button>
      <style jsx>{`
        .timeline-btn:hover {
          background: var(--surface-2);
          border-color: var(--border);
        }
      `}</style>
    </li>
  );
}

const STATUS_DOT_COLOR: Record<TicketStatus, string> = {
  new: "var(--danger-solid)",
  open: "var(--danger-solid)",
  in_progress: "var(--info-solid)",
  pending: "var(--warning-solid)",
  pending_agent: "var(--info-solid)",
  escalated: "var(--danger-solid)",
  reopened: "var(--warning-solid)",
  auto_resolved: "var(--success-solid)",
  resolved: "var(--success-solid)",
  closed: "var(--muted-soft)",
  cancelled: "var(--muted-soft)",
};

function Field({
  label,
  value,
  display,
  editing,
  onChange,
  type = "text",
  locked,
}: {
  label: string;
  value: string;
  display: string;
  editing: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  type?: string;
  locked?: boolean;
}) {
  return (
    <div>
      <div
        className="label"
        style={{ marginBottom: 6, fontSize: "0.62rem", display: "flex", alignItems: "center", gap: 6 }}
      >
        {label}
        {locked ? <LockIcon /> : null}
      </div>
      {editing && !locked ? (
        <input className="input" type={type} value={value} onChange={onChange} />
      ) : (
        <div style={{ fontSize: "0.88rem", fontWeight: 500, color: "var(--text)" }}>{display || "—"}</div>
      )}
    </div>
  );
}

function TimezoneField({
  editing,
  value,
  display,
  onChange,
  onDetect,
}: {
  editing: boolean;
  value: string;
  display: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDetect: () => void;
}) {
  return (
    <div>
      <div
        className="label"
        style={{
          marginBottom: 6,
          fontSize: "0.62rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 6,
        }}
      >
        <span>Time zone</span>
        {editing ? (
          <button
            type="button"
            onClick={onDetect}
            className="chip-link"
            style={{ fontSize: "0.62rem", fontWeight: 600 }}
          >
            Detect ↻
          </button>
        ) : null}
      </div>
      {editing ? (
        <input className="input" value={value} onChange={onChange} placeholder="e.g. Asia/Kolkata" />
      ) : (
        <div style={{ fontSize: "0.88rem", fontWeight: 500, color: "var(--text)" }}>{display || "—"}</div>
      )}
    </div>
  );
}

function Toggle({
  label,
  hint,
  icon,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "0.55rem 0",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        {icon ? (
          <IconTile tone="brand">{icon}</IconTile>
        ) : null}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text)" }}>{label}</div>
          {hint ? <div className="muted" style={{ fontSize: "0.72rem" }}>{hint}</div> : null}
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        style={{
          position: "relative",
          width: 42,
          height: 24,
          borderRadius: 999,
          border: "none",
          cursor: "pointer",
          flexShrink: 0,
          background: checked ? "var(--brand-gradient)" : "var(--surface-3)",
          transition: "background 0.22s var(--ease)",
          boxShadow: checked ? "inset 0 0 0 1px rgba(255,255,255,0.15)" : "none",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 2.5,
            left: checked ? 21 : 2.5,
            width: 19,
            height: 19,
            borderRadius: "50%",
            background: "#fff",
            boxShadow: "var(--shadow-sm)",
            transition: "left 0.22s var(--ease)",
          }}
        />
      </button>
    </div>
  );
}

function ThemeToggle({ theme, onToggle }: { theme: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label="Toggle theme"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: 3,
        borderRadius: 999,
        background: "var(--surface-3)",
        border: "1px solid var(--border)",
        cursor: "pointer",
      }}
    >
      <span
        style={{
          padding: "0.3rem 0.6rem",
          borderRadius: 999,
          background: theme === "light" ? "var(--surface)" : "transparent",
          color: theme === "light" ? "var(--text)" : "var(--muted)",
          boxShadow: theme === "light" ? "var(--shadow-sm)" : "none",
          transition: "background var(--dur-2) var(--ease)",
          fontSize: "0.75rem",
          fontWeight: 600,
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        <SunIcon /> Light
      </span>
      <span
        style={{
          padding: "0.3rem 0.6rem",
          borderRadius: 999,
          background: theme === "dark" ? "var(--surface)" : "transparent",
          color: theme === "dark" ? "var(--text)" : "var(--muted)",
          boxShadow: theme === "dark" ? "var(--shadow-sm)" : "none",
          transition: "background var(--dur-2) var(--ease)",
          fontSize: "0.75rem",
          fontWeight: 600,
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        <MoonIcon /> Dark
      </span>
    </button>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "0.4rem 0" }}>
      <span className="muted" style={{ fontSize: "0.8rem" }}>{k}</span>
      <span
        style={{
          fontSize: "0.82rem",
          fontWeight: 600,
          color: "var(--text)",
          fontFamily: mono ? "var(--font-mono, ui-monospace, monospace)" : undefined,
        }}
      >
        {v}
      </span>
    </div>
  );
}

function BigAvatar({ initials, isAgent }: { initials: string; isAgent: boolean }) {
  return (
    <div style={{ position: "relative" }}>
      <div
        style={{
          width: 92,
          height: 92,
          borderRadius: 22,
          background: isAgent ? "var(--brand-gradient)" : "var(--surface-3)",
          color: isAgent ? "#fff" : "var(--text-secondary)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 800,
          fontSize: "1.85rem",
          flexShrink: 0,
          border: "4px solid var(--surface)",
          boxShadow: "var(--shadow-md)",
          letterSpacing: "-0.02em",
        }}
      >
        {initials}
      </div>
      <span
        aria-hidden
        style={{
          position: "absolute",
          bottom: 6,
          right: 6,
          width: 16,
          height: 16,
          borderRadius: 999,
          background: "var(--success-solid)",
          border: "3px solid var(--surface)",
          boxShadow: "0 0 0 1px var(--border)",
        }}
      />
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  const isRequester = role === "requester";
  return (
    <span
      className="badge"
      style={{
        background: isRequester ? "var(--surface-3)" : "var(--brand-50)",
        color: isRequester ? "var(--text-secondary)" : "var(--brand-700)",
        borderColor: isRequester ? "var(--border)" : "var(--brand-100)",
      }}
    >
      {role.replace("_", " ")}
    </span>
  );
}

function PresenceChip({ available }: { available: boolean }) {
  return (
    <span
      className="badge"
      style={{
        background: available ? "var(--success-bg)" : "var(--surface-3)",
        color: available ? "var(--success-fg)" : "var(--text-secondary)",
        borderColor: available ? "var(--success-border)" : "var(--border)",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: available ? "var(--success-solid)" : "var(--muted-soft)",
          display: "inline-block",
          animation: available ? "pulse-dot 2s var(--ease-in-out) infinite" : "none",
        }}
      />
      {available ? "Available" : "Away"}
      <style jsx>{`
        @keyframes pulse-dot {
          0%,
          100% {
            opacity: 0.65;
            transform: scale(1);
          }
          50% {
            opacity: 1;
            transform: scale(1.4);
          }
        }
      `}</style>
    </span>
  );
}

function CopyChip({
  icon,
  value,
  onClick,
  copied,
}: {
  icon: React.ReactNode;
  value: string;
  onClick: () => void;
  copied: boolean;
}) {
  const hasValue = value && value !== "—";
  return (
    <button
      type="button"
      onClick={hasValue ? onClick : undefined}
      title={hasValue ? "Copy" : undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "0.35rem 0.7rem",
        borderRadius: 999,
        border: "1px solid var(--border)",
        background: copied ? "var(--success-bg)" : "var(--surface)",
        color: copied ? "var(--success-fg)" : "var(--text-secondary)",
        fontSize: "0.82rem",
        cursor: hasValue ? "pointer" : "default",
        transition:
          "background var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease), color var(--dur-1) var(--ease)",
      }}
    >
      <span style={{ color: copied ? "var(--success-fg)" : "var(--muted)", display: "inline-flex" }}>
        {copied ? <CheckIcon /> : icon}
      </span>
      <span>{copied ? "Copied!" : value}</span>
    </button>
  );
}

function Chip({ icon, value }: { icon: React.ReactNode; value: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "0.35rem 0.7rem",
        borderRadius: 999,
        border: "1px solid var(--border)",
        background: "var(--surface)",
        color: "var(--text-secondary)",
        fontSize: "0.82rem",
      }}
    >
      <span style={{ color: "var(--muted)", display: "inline-flex" }}>{icon}</span>
      <span>{value}</span>
    </span>
  );
}

/* ==================== icons ==================== */

const ic = {
  width: 15,
  height: 15,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function MailIcon() {
  return (
    <svg {...ic}>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-10 6L2 7" />
    </svg>
  );
}
function PhoneIcon() {
  return (
    <svg {...ic}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}
function PinIcon() {
  return (
    <svg {...ic}>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg {...ic}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
function CalendarIcon() {
  return (
    <svg {...ic}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}
function EditIcon() {
  return (
    <svg {...ic} width={14} height={14}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}
function LinkIcon() {
  return (
    <svg {...ic} width={14} height={14}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}
function InboxIcon() {
  return (
    <svg {...ic} width={18} height={18}>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
    </svg>
  );
}
function FolderIcon() {
  return (
    <svg {...ic} width={18} height={18}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg {...ic} width={18} height={18}>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}
function StarIcon() {
  return (
    <svg {...ic} width={18} height={18}>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}
function SparklesIcon() {
  return (
    <svg {...ic} width={16} height={16}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M16 16l2 2M6 18l2-2M16 8l2-2" />
    </svg>
  );
}
function UserIcon() {
  return (
    <svg {...ic}>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
function AddressIcon() {
  return (
    <svg {...ic}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 10h8M8 14h5" />
    </svg>
  );
}
function ActivityIcon() {
  return (
    <svg {...ic}>
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}
function BellIcon() {
  return (
    <svg {...ic}>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}
function MonitorIcon() {
  return (
    <svg {...ic} width={16} height={16}>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}
function AtIcon() {
  return (
    <svg {...ic} width={16} height={16}>
      <circle cx="12" cy="12" r="4" />
      <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94" />
    </svg>
  );
}
function DigestIcon() {
  return (
    <svg {...ic} width={16} height={16}>
      <path d="M4 4h16v16H4z" />
      <path d="M4 8h16M8 4v16" />
    </svg>
  );
}
function ShieldIcon() {
  return (
    <svg {...ic}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}
function SettingsIcon() {
  return (
    <svg {...ic} width={14} height={14}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
function SignOutIcon() {
  return (
    <svg {...ic} width={14} height={14}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}
function LockIcon() {
  return (
    <svg {...ic} width={11} height={11}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 018 0v4" />
    </svg>
  );
}
function SunIcon() {
  return (
    <svg {...ic} width={13} height={13}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg {...ic} width={13} height={13}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
