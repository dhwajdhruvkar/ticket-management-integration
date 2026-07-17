"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { apiGet, apiSend } from "@/lib/api";
import type {
  AssignmentGroupRow,
  ImpactLevel,
  TicketCategory,
  TicketRow,
  TicketStatus,
  UserRow,
} from "@/server/domain/models";
import { PRIORITY_ORDER } from "@/server/domain/priority";
import { Avatar, IMPACT_LEVELS, PriorityBadge, SlaBadge, StatusBadge, timeAgo } from "./ui";
import { usePersona } from "./Persona";
import { useToast } from "./Toast";
import { TableSkeleton } from "./Skeleton";

// =============================================================================
// TicketsExplorer — the primary ticket workspace (route: /tickets).
//
// Renders two distinct experiences from one component based on the signed-in
// role:
//   - Agents/managers get the queue: saved views (sidebar), search, bulk
//     actions, and a dense sortable table.
//   - Requesters get "My requests": their own tickets as friendly status cards.
// Data is loaded from /api/v1/tickets (+ users/groups for agent labels) and
// every row links into the ticket detail. All mutations go through the API and
// surface toasts; nothing here writes to the store directly.
// =============================================================================

const UNSOLVED: TicketStatus[] = ["new", "open", "in_progress", "pending", "pending_agent", "escalated", "reopened"];
const SOLVED: TicketStatus[] = ["auto_resolved", "resolved", "closed"];
const CATEGORIES: TicketCategory[] = ["IT", "HR", "Access", "Software", "Hardware", "Network", "Billing", "Other"];

type ViewIcon = "user" | "inbox" | "stack" | "pause" | "clock" | "check" | "grid";

interface ViewDef {
  id: string;
  label: string;
  desc: string;
  icon: ViewIcon;
  predicate: (t: TicketRow, meId: string) => boolean;
  sort?: (a: TicketRow, b: TicketRow) => number;
}

const VIEWS: ViewDef[] = [
  {
    id: "your_unsolved",
    label: "Your unsolved tickets",
    desc: "Assigned to you and still open",
    icon: "user",
    predicate: (t, me) => t.assigneeId === me && UNSOLVED.includes(t.status),
  },
  {
    id: "unassigned",
    label: "Unassigned tickets",
    desc: "Waiting for an owner",
    icon: "inbox",
    predicate: (t) => !t.assigneeId && UNSOLVED.includes(t.status),
  },
  {
    id: "all_unsolved",
    label: "All unsolved tickets",
    desc: "The full open backlog",
    icon: "stack",
    predicate: (t) => UNSOLVED.includes(t.status),
  },
  {
    id: "pending",
    label: "Pending",
    desc: "On hold or awaiting review",
    icon: "pause",
    predicate: (t) => t.status === "pending_agent" || t.status === "pending",
  },
  {
    id: "recently_updated",
    label: "Recently updated",
    desc: "Everything, newest activity first",
    icon: "clock",
    predicate: () => true,
    sort: (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  },
  {
    id: "recently_solved",
    label: "Recently solved",
    desc: "Resolved and closed work",
    icon: "check",
    predicate: (t) => SOLVED.includes(t.status),
    sort: (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  },
  {
    id: "all",
    label: "All tickets",
    desc: "No filter applied",
    icon: "grid",
    predicate: () => true,
  },
];

function ViewGlyph({ icon, size = 15 }: { icon: ViewIcon; size?: number }) {
  const p = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (icon) {
    case "user":
      return (
        <svg {...p}>
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      );
    case "inbox":
      return (
        <svg {...p}>
          <path d="M22 12h-6l-2 3h-4l-2-3H2" />
          <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
        </svg>
      );
    case "stack":
      return (
        <svg {...p}>
          <path d="M12 2L2 7l10 5 10-5-10-5z" />
          <path d="M2 17l10 5 10-5M2 12l10 5 10-5" />
        </svg>
      );
    case "pause":
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" />
          <path d="M10 9v6M14 9v6" />
        </svg>
      );
    case "clock":
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case "check":
      return (
        <svg {...p}>
          <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
          <path d="M22 4L12 14.01l-3-3" />
        </svg>
      );
    default:
      return (
        <svg {...p}>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      );
  }
}

export default function TicketsExplorer() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { persona, ready } = usePersona();
  const isAgent = persona.role === "agent";

  const q = searchParams.get("q") ?? "";
  const newFlag = searchParams.get("new") === "1";

  const [tickets, setTickets] = useState<TicketRow[] | null>(null);

  const refresh = useCallback(() => {
    apiGet<TicketRow[]>("/tickets").then(setTickets).catch(() => setTickets([]));
  }, []);

  useEffect(() => {
    if (ready) refresh();
  }, [ready, persona.id, refresh]);

  // Requesters raise requests through the portal.
  useEffect(() => {
    if (newFlag && !isAgent && ready) router.replace("/portal");
  }, [newFlag, isAgent, ready, router]);

  if (!isAgent) {
    return <MyRequestsView tickets={tickets} query={q} refresh={refresh} />;
  }
  return (
    <AgentExplorer
      tickets={tickets}
      query={q}
      openFormOnMount={newFlag}
      refresh={refresh}
    />
  );
}

/* =============================================================================
   AgentExplorer — saved views, dense-but-rich table, sectioned intake form.
   ============================================================================= */

function AgentExplorer({
  tickets,
  query,
  openFormOnMount,
  refresh,
}: {
  tickets: TicketRow[] | null;
  query: string;
  openFormOnMount: boolean;
  refresh: () => void;
}) {
  const router = useRouter();
  const { persona, ready } = usePersona();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [groups, setGroups] = useState<AssignmentGroupRow[]>([]);
  const [activeView, setActiveView] = useState("your_unsolved");
  const [showForm, setShowForm] = useState(openFormOnMount);

  useEffect(() => {
    if (!ready) return;
    apiGet<UserRow[]>("/users").then(setUsers).catch(() => {});
    apiGet<AssignmentGroupRow[]>("/groups").then(setGroups).catch(() => {});
  }, [ready, persona.id]);

  useEffect(() => {
    if (openFormOnMount) setShowForm(true);
  }, [openFormOnMount]);

  const view = VIEWS.find((v) => v.id === activeView) ?? VIEWS[0];

  const userName = useCallback(
    (id: string | null | undefined) => users.find((u) => u.id === id)?.name ?? "Unassigned",
    [users]
  );
  const groupName = useCallback(
    (id: string | null | undefined) => groups.find((g) => g.id === id)?.name ?? "—",
    [groups]
  );

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    const all = tickets ?? [];
    for (const v of VIEWS) map[v.id] = all.filter((t) => v.predicate(t, persona.id)).length;
    return map;
  }, [tickets, persona.id]);

  const rows = useMemo(() => {
    let list = (tickets ?? []).filter((t) => view.predicate(t, persona.id));
    if (view.sort) list = [...list].sort(view.sort);
    if (query) {
      const needle = query.toLowerCase();
      list = list.filter(
        (t) =>
          t.subject.toLowerCase().includes(needle) ||
          t.requesterEmail.toLowerCase().includes(needle) ||
          t.reference.toLowerCase().includes(needle)
      );
    }
    return list;
  }, [tickets, persona.id, view, query]);

  if (tickets === null || !ready)
    return (
      <div className="page-pad">
        <TableSkeleton title={180} rows={8} columns={6} />
      </div>
    );

  return (
    <div style={{ height: "100%", display: "flex", minHeight: 0 }}>
      <ViewsSidebar activeView={activeView} counts={counts} onSelect={setActiveView} />

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
        {/* Header */}
        <div
          className="flex items-center justify-between"
          style={{
            padding: "0.85rem 1.25rem",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
            gap: 12,
            flexWrap: "wrap",
            background: "var(--surface)",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div className="flex items-center" style={{ gap: 10 }}>
              <span
                aria-hidden
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  background: "var(--brand-50)",
                  color: "var(--brand-700)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <ViewGlyph icon={view.icon} />
              </span>
              <h1 style={{ fontSize: "1.1rem", fontWeight: 800, color: "var(--text)", whiteSpace: "nowrap", margin: 0 }}>
                {view.label}
              </h1>
              <span
                className="badge"
                style={{
                  background: "var(--brand-50)",
                  color: "var(--brand-700)",
                  borderColor: "var(--brand-100)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {rows.length}
              </span>
            </div>
            <div className="muted" style={{ fontSize: "0.76rem", marginTop: 3, marginLeft: 40 }}>
              {view.desc}
              {query ? (
                <>
                  {" "}· matching “{query}”{" "}
                  <Link href="/tickets" className="chip-link" style={{ fontSize: "0.76rem" }}>
                    clear
                  </Link>
                </>
              ) : null}
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => setShowForm((s) => !s)}>
            {showForm ? "Close" : "+ New ticket"}
          </button>
        </div>

        {/* Compact view switcher for narrow screens */}
        <div
          className="show-md"
          style={{
            gap: 6,
            padding: "0.6rem 1rem",
            borderBottom: "1px solid var(--border)",
            overflowX: "auto",
            flexShrink: 0,
          }}
        >
          {VIEWS.map((v) => {
            const active = v.id === activeView;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setActiveView(v.id)}
                style={{
                  flexShrink: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: "0.76rem",
                  fontWeight: 600,
                  padding: "0.3rem 0.7rem",
                  borderRadius: 999,
                  border: `1px solid ${active ? "var(--brand-500)" : "var(--border-strong)"}`,
                  cursor: "pointer",
                  background: active ? "var(--brand-50)" : "var(--surface)",
                  color: active ? "var(--brand-600)" : "var(--text-secondary)",
                  transition: "all var(--dur-1) var(--ease)",
                  whiteSpace: "nowrap",
                }}
              >
                <ViewGlyph icon={v.icon} size={12} />
                {v.label}
                <span
                  style={{
                    fontSize: "0.68rem",
                    fontWeight: 700,
                    padding: "0 5px",
                    borderRadius: 999,
                    background: active ? "var(--brand-500)" : "var(--surface-3)",
                    color: active ? "#fff" : "var(--muted)",
                  }}
                >
                  {counts[v.id] ?? 0}
                </span>
              </button>
            );
          })}
        </div>

        {showForm ? (
          <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)", flexShrink: 0, overflow: "auto", maxHeight: "60%" }}>
            <NewTicketForm
              isAgent
              defaultRequester=""
              lockRequester={false}
              onCreated={() => {
                setShowForm(false);
                refresh();
              }}
            />
          </div>
        ) : null}

        <div className="table-scroll anim-fade-in" style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
          {rows.length === 0 ? (
            <AgentEmptyState
              hasAny={(tickets?.length ?? 0) > 0}
              onShowAll={() => setActiveView("all")}
              onCreate={() => setShowForm(true)}
            />
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
              <thead>
                <tr
                  style={{
                    textAlign: "left",
                    color: "var(--muted)",
                    position: "sticky",
                    top: 0,
                    background: "var(--surface)",
                    zIndex: 1,
                    boxShadow: "inset 0 -1px 0 var(--border)",
                  }}
                >
                  <Th>Status</Th>
                  <Th>Subject</Th>
                  <Th className="hide-sm">Requester</Th>
                  <Th>Priority</Th>
                  <Th className="hide-md">Group</Th>
                  <Th className="hide-md">Assignee</Th>
                  <Th className="hide-sm">SLA</Th>
                  <Th>Updated</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const assignee = userName(t.assigneeId);
                  return (
                    <tr
                      key={t.id}
                      className="row-hover"
                      style={{ borderTop: "1px solid var(--border)", cursor: "pointer" }}
                      onClick={() => router.push(`/tickets/${t.id}`)}
                    >
                      <Td>
                        <StatusBadge status={t.status} />
                      </Td>
                      <Td>
                        <Link
                          href={`/tickets/${t.id}`}
                          style={{ color: "inherit", textDecoration: "none" }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div
                            style={{
                              fontWeight: 600,
                              maxWidth: 420,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {t.subject}
                          </div>
                          <div className="muted" style={{ fontSize: "0.72rem", marginTop: 2 }}>
                            <span className="mono">{t.reference}</span> · {t.category}
                            {t.subcategory ? ` › ${t.subcategory}` : ""}
                          </div>
                        </Link>
                      </Td>
                      <Td className="hide-sm">
                        <PersonCell name={t.requesterEmail} />
                      </Td>
                      <Td>
                        <PriorityBadge priority={t.priority} />
                      </Td>
                      <Td className="hide-md">
                        <span className="muted" style={{ fontSize: "0.8rem" }}>
                          {groupName(t.assignmentGroupId)}
                        </span>
                      </Td>
                      <Td className="hide-md">
                        {t.assigneeId ? (
                          <PersonCell name={assignee} tone="info" />
                        ) : (
                          <span
                            className="badge"
                            style={{
                              background: "var(--surface-3)",
                              color: "var(--muted)",
                              borderColor: "var(--border)",
                              fontSize: "0.7rem",
                            }}
                          >
                            Unassigned
                          </span>
                        )}
                      </Td>
                      <Td className="hide-sm">
                        <SlaLevelCell ticket={t} />
                      </Td>
                      <Td>
                        <span
                          className="muted"
                          style={{ fontSize: "0.78rem", whiteSpace: "nowrap" }}
                          title={new Date(t.updatedAt).toLocaleString()}
                        >
                          {timeAgo(t.updatedAt)}
                        </span>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function PersonCell({ name }: { name: string; tone?: "brand" | "info" }) {
  const display = name.includes("@") ? name.split("@")[0].replace(/[._-]+/g, " ") : name;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, maxWidth: 200 }}>
      <Avatar name={display} size={24} />
      <span
        className="muted"
        style={{
          fontSize: "0.8rem",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {name}
      </span>
    </span>
  );
}

function AgentEmptyState({
  hasAny,
  onShowAll,
  onCreate,
}: {
  hasAny: boolean;
  onShowAll: () => void;
  onCreate: () => void;
}) {
  return (
    <div
      className="anim-scale-in"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
        padding: "3.5rem 1.5rem",
        textAlign: "center",
      }}
    >
      <div
        aria-hidden
        style={{
          width: 56,
          height: 56,
          borderRadius: 14,
          background: "var(--brand-50)",
          color: "var(--brand-600)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ViewGlyph icon="inbox" size={28} />
      </div>
      <div>
        <div style={{ fontSize: "1rem", fontWeight: 700 }}>
          {hasAny ? "Nothing in this view" : "No tickets yet"}
        </div>
        <p className="muted" style={{ fontSize: "0.85rem", margin: "4px 0 0", maxWidth: 380 }}>
          {hasAny
            ? "This queue is clear. Switch views or create a ticket on behalf of a requester."
            : "Create the first ticket, or wait for intake from email, Teams, or the portal."}
        </p>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {hasAny ? (
          <button className="btn btn-ghost" onClick={onShowAll}>
            Show all tickets
          </button>
        ) : null}
        <button className="btn btn-primary" onClick={onCreate}>
          + New ticket
        </button>
      </div>
    </div>
  );
}

/* =============================================================================
   MyRequestsView — the requester's "My requests" experience.

   Rich, interactive alternative to a dense agent table: KPI filter cards, live
   search, sort, quick reopen, and card-based rows with a colored status spine.
   ============================================================================= */

type BucketKey = "open" | "waiting" | "resolved" | "escalated" | "closed";
type FilterKey = "all" | BucketKey;
type SortKey = "recent" | "oldest" | "priority";

function bucketOf(status: TicketStatus): BucketKey {
  if (status === "auto_resolved" || status === "resolved") return "resolved";
  if (status === "closed" || status === "cancelled") return "closed";
  if (status === "escalated") return "escalated";
  if (status === "pending" || status === "pending_agent") return "waiting";
  return "open";
}

const STATUS_SPINE: Record<TicketStatus, string> = {
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

function MyRequestsView({
  tickets,
  query,
  refresh,
}: {
  tickets: TicketRow[] | null;
  query: string;
  refresh: () => void;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sort, setSort] = useState<SortKey>("recent");
  const [search, setSearch] = useState(query);
  const toast = useToast();
  const [reopeningId, setReopeningId] = useState<string | null>(null);

  useEffect(() => {
    setSearch(query);
  }, [query]);

  const buckets = useMemo(() => {
    const counts: Record<FilterKey, number> = {
      all: 0,
      open: 0,
      waiting: 0,
      resolved: 0,
      escalated: 0,
      closed: 0,
    };
    for (const t of tickets ?? []) {
      counts.all += 1;
      counts[bucketOf(t.status)] += 1;
    }
    return counts;
  }, [tickets]);

  const rows = useMemo(() => {
    let list = tickets ?? [];
    if (filter !== "all") list = list.filter((t) => bucketOf(t.status) === filter);
    const s = search.trim().toLowerCase();
    if (s) {
      list = list.filter(
        (t) =>
          t.subject.toLowerCase().includes(s) ||
          t.reference.toLowerCase().includes(s) ||
          (t.subcategory ?? "").toLowerCase().includes(s) ||
          t.category.toLowerCase().includes(s)
      );
    }
    const cmpRecent = (a: TicketRow, b: TicketRow) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    const cmpOldest = (a: TicketRow, b: TicketRow) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    const cmpPriority = (a: TicketRow, b: TicketRow) =>
      PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority);
    list = [...list].sort(
      sort === "oldest" ? cmpOldest : sort === "priority" ? cmpPriority : cmpRecent
    );
    return list;
  }, [tickets, filter, search, sort]);

  async function reopen(ticket: TicketRow) {
    setReopeningId(ticket.id);
    try {
      await apiSend(`/tickets/${ticket.id}/actions`, "POST", {
        action: "reopen",
        note: "Reopened from My Requests.",
      });
      toast.success({
        title: "Request reopened",
        description: `${ticket.reference} is back with the team.`,
      });
      refresh();
    } catch (err) {
      toast.error({
        title: "Could not reopen",
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setReopeningId(null);
    }
  }

  if (tickets === null) {
    return (
      <div className="page-pad">
        <TableSkeleton title={180} rows={6} columns={3} />
      </div>
    );
  }

  return (
    <div className="page-pad anim-fade-up" style={{ maxWidth: 1120, margin: "0 auto" }}>
      {/* Header ------------------------------------------------------------ */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 18,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h1 className="page-title" style={{ margin: 0 }}>
            My requests
          </h1>
          <p className="muted" style={{ fontSize: "0.88rem", margin: "4px 0 0" }}>
            {buckets.all === 0
              ? "You haven't raised any requests yet."
              : `${buckets.all} total · ${buckets.open + buckets.waiting + buckets.escalated} active`}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={refresh}
            aria-label="Refresh list"
            title="Refresh"
          >
            <RefreshIcon /> <span style={{ marginLeft: 6 }}>Refresh</span>
          </button>
          <Link href="/portal" className="btn btn-primary">
            <PlusIcon /> <span style={{ marginLeft: 6 }}>New request</span>
          </Link>
        </div>
      </div>

      {/* KPI strip (clickable filters) ------------------------------------ */}
      <div className="grid-kpis stagger" style={{ gap: 12, marginBottom: 14 }}>
        <KpiCard
          label="Active"
          count={buckets.open}
          tone="danger"
          icon={<AlertGlyph />}
          active={filter === "open"}
          onClick={() => setFilter(filter === "open" ? "all" : "open")}
          hint="Being worked on"
        />
        <KpiCard
          label="Waiting"
          count={buckets.waiting}
          tone="warning"
          icon={<HourglassGlyph />}
          active={filter === "waiting"}
          onClick={() => setFilter(filter === "waiting" ? "all" : "waiting")}
          hint="On hold or awaiting you"
        />
        <KpiCard
          label="Resolved"
          count={buckets.resolved}
          tone="success"
          icon={<CheckGlyph />}
          active={filter === "resolved"}
          onClick={() => setFilter(filter === "resolved" ? "all" : "resolved")}
          hint="Solutions delivered"
        />
        <KpiCard
          label="Escalated"
          count={buckets.escalated}
          tone="danger"
          icon={<UpArrowGlyph />}
          active={filter === "escalated"}
          onClick={() => setFilter(filter === "escalated" ? "all" : "escalated")}
          hint="Priority attention"
        />
      </div>

      {/* Toolbar ---------------------------------------------------------- */}
      <div
        style={{
          display: "flex",
          gap: 10,
          marginBottom: 12,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <div style={{ position: "relative", flex: 1, minWidth: 220 }}>
          <span
            aria-hidden
            style={{
              position: "absolute",
              left: 12,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--muted)",
              pointerEvents: "none",
              display: "inline-flex",
            }}
          >
            <SearchGlyph />
          </span>
          <input
            className="input"
            placeholder="Search by subject, reference, or category…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: 36, height: 40 }}
          />
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(["all", "open", "waiting", "resolved", "closed"] as FilterKey[]).map((k) => (
            <FilterPill
              key={k}
              active={filter === k}
              count={buckets[k]}
              onClick={() => setFilter(k)}
            >
              {FILTER_LABEL[k]}
            </FilterPill>
          ))}
        </div>
        <select
          className="select"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          style={{ height: 40, minWidth: 160 }}
          aria-label="Sort"
        >
          <option value="recent">Recently updated</option>
          <option value="oldest">Oldest first</option>
          <option value="priority">By priority</option>
        </select>
      </div>

      {/* List ------------------------------------------------------------ */}
      {rows.length === 0 ? (
        <EmptyMyRequests
          hasAny={buckets.all > 0}
          onClear={() => {
            setFilter("all");
            setSearch("");
          }}
        />
      ) : (
        <div className="stagger" style={{ display: "grid", gap: 10 }}>
          {rows.map((t) => (
            <RequestCard
              key={t.id}
              ticket={t}
              onOpen={() => router.push(`/tickets/${t.id}`)}
              onReopen={() => reopen(t)}
              reopening={reopeningId === t.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const FILTER_LABEL: Record<FilterKey, string> = {
  all: "All",
  open: "Active",
  waiting: "Waiting",
  resolved: "Resolved",
  escalated: "Escalated",
  closed: "Closed",
};

type KpiTone = "danger" | "warning" | "success" | "info";

function KpiCard({
  label,
  count,
  tone,
  icon,
  active,
  onClick,
  hint,
}: {
  label: string;
  count: number;
  tone: KpiTone;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  hint?: string;
}) {
  const t = KPI_TONE[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="hover-lift"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "0.95rem 1.05rem",
        textAlign: "left",
        borderRadius: 14,
        border: `1px solid ${active ? t.solid : "var(--border)"}`,
        background: active
          ? `linear-gradient(180deg, ${t.bg} 0%, var(--surface) 100%)`
          : "var(--surface)",
        cursor: "pointer",
        transition:
          "border-color var(--dur-2) var(--ease), box-shadow var(--dur-2) var(--ease), background var(--dur-2) var(--ease)",
        boxShadow: active ? "var(--shadow-md)" : "var(--shadow-sm)",
      }}
    >
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
        {icon}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 8,
          }}
        >
          <span
            style={{
              fontSize: "1.55rem",
              fontWeight: 800,
              letterSpacing: "-0.02em",
              lineHeight: 1,
              color: "var(--text)",
            }}
          >
            {count}
          </span>
          <span
            style={{
              fontSize: "0.85rem",
              fontWeight: 700,
              color: active ? t.fg : "var(--text-secondary)",
            }}
          >
            {label}
          </span>
        </div>
        {hint ? (
          <div className="muted" style={{ fontSize: "0.72rem", marginTop: 4 }}>
            {hint}
          </div>
        ) : null}
      </div>
    </button>
  );
}

const KPI_TONE: Record<KpiTone, { bg: string; fg: string; solid: string }> = {
  danger: { bg: "var(--danger-bg)", fg: "var(--danger-fg)", solid: "var(--danger-solid)" },
  warning: { bg: "var(--warning-bg)", fg: "var(--warning-fg)", solid: "var(--warning-solid)" },
  success: { bg: "var(--success-bg)", fg: "var(--success-fg)", solid: "var(--success-solid)" },
  info: { bg: "var(--info-bg)", fg: "var(--info-fg)", solid: "var(--info-solid)" },
};

function FilterPill({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "0.4rem 0.7rem",
        borderRadius: 999,
        border: `1px solid ${active ? "var(--brand-500)" : "var(--border)"}`,
        background: active ? "var(--brand-50)" : "var(--surface)",
        color: active ? "var(--brand-700)" : "var(--text-secondary)",
        fontSize: "0.8rem",
        fontWeight: 600,
        cursor: "pointer",
        transition:
          "background var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease), color var(--dur-1) var(--ease)",
      }}
    >
      <span>{children}</span>
      <span
        style={{
          fontSize: "0.7rem",
          fontWeight: 700,
          padding: "1px 6px",
          borderRadius: 999,
          background: active ? "var(--brand-500)" : "var(--surface-3)",
          color: active ? "#fff" : "var(--muted)",
        }}
      >
        {count}
      </span>
    </button>
  );
}

function RequestCard({
  ticket,
  onOpen,
  onReopen,
  reopening,
}: {
  ticket: TicketRow;
  onOpen: () => void;
  onReopen: () => void;
  reopening: boolean;
}) {
  const spine = STATUS_SPINE[ticket.status];
  const bucket = bucketOf(ticket.status);
  // Cancelled (e.g. approval-rejected) requests cannot be reopened by the
  // requester — the server rejects it; raise a new request instead.
  const canReopen = (bucket === "resolved" || bucket === "closed") && ticket.status !== "cancelled";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="req-card"
      style={{
        position: "relative",
        display: "grid",
        gridTemplateColumns: "6px minmax(0, 1fr) auto",
        gap: 0,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        overflow: "hidden",
        cursor: "pointer",
        transition:
          "border-color var(--dur-2) var(--ease), box-shadow var(--dur-2) var(--ease), transform var(--dur-2) var(--ease-out)",
      }}
    >
      <div style={{ background: spine }} aria-hidden />
      <div style={{ padding: "0.95rem 1.1rem", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <StatusBadge status={ticket.status} />
          <span
            className="mono"
            style={{ fontSize: "0.72rem", color: "var(--muted)" }}
          >
            {ticket.reference}
          </span>
          <span
            className="badge"
            style={{
              background: "var(--surface-3)",
              color: "var(--text-secondary)",
              borderColor: "var(--border)",
              fontSize: "0.68rem",
            }}
          >
            {ticket.category}
            {ticket.subcategory ? ` › ${ticket.subcategory}` : ""}
          </span>
          <PriorityBadge priority={ticket.priority} />
        </div>
        <div
          style={{
            fontWeight: 700,
            fontSize: "0.98rem",
            lineHeight: 1.35,
            marginTop: 8,
            display: "-webkit-box",
            WebkitLineClamp: 1,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {ticket.subject}
        </div>
        <p
          className="muted"
          style={{
            fontSize: "0.83rem",
            lineHeight: 1.5,
            margin: "6px 0 0",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {ticket.body}
        </p>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: 8,
          padding: "0.95rem 1.1rem 0.95rem 0.4rem",
          minWidth: 150,
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: "0.76rem",
            color: "var(--muted)",
            whiteSpace: "nowrap",
          }}
        >
          <ClockGlyph />
          {timeAgo(ticket.updatedAt)}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
            justifyContent: "flex-end",
          }}
        >
          {canReopen ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onReopen();
              }}
              className="btn btn-ghost"
              style={{ fontSize: "0.78rem", height: 32, padding: "0 10px" }}
              disabled={reopening}
            >
              {reopening ? "Reopening…" : "Reopen"}
            </button>
          ) : null}
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              color: "var(--brand-700)",
              fontWeight: 600,
              fontSize: "0.82rem",
            }}
          >
            View
            <ArrowRightGlyph />
          </span>
        </div>
      </div>
      <style jsx>{`
        .req-card:hover {
          border-color: var(--brand-300);
          box-shadow: var(--shadow-md);
          transform: translateY(-1px);
        }
        .req-card:focus-visible {
          outline: none;
          border-color: var(--brand-500);
          box-shadow: 0 0 0 3px var(--ring);
        }
      `}</style>
    </div>
  );
}

function EmptyMyRequests({ hasAny, onClear }: { hasAny: boolean; onClear: () => void }) {
  return (
    <div
      className="panel anim-scale-in"
      style={{
        padding: "2.5rem 1.5rem",
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
      }}
    >
      <div
        aria-hidden
        style={{
          width: 56,
          height: 56,
          borderRadius: 14,
          background: "var(--brand-50)",
          color: "var(--brand-600)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <InboxGlyph />
      </div>
      <div>
        <div style={{ fontSize: "1rem", fontWeight: 700 }}>
          {hasAny ? "Nothing matches this filter" : "You have no requests yet"}
        </div>
        <p className="muted" style={{ fontSize: "0.85rem", margin: "4px 0 0" }}>
          {hasAny
            ? "Try clearing the filter or search term."
            : "Raise a request from the Help Center — the assistant might resolve it instantly."}
        </p>
      </div>
      {hasAny ? (
        <button className="btn btn-ghost" onClick={onClear}>
          Show all requests
        </button>
      ) : (
        <Link href="/portal" className="btn btn-primary">
          Go to Help Center
        </Link>
      )}
    </div>
  );
}

/* Inline glyphs used only by the requester view */
const glyph = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function AlertGlyph() {
  return (
    <svg {...glyph}>
      <path d="M12 9v4M12 17h.01" />
      <path d="M10.29 3.86l-8.14 14a2 2 0 001.71 3h16.28a2 2 0 001.71-3l-8.14-14a2 2 0 00-3.42 0z" />
    </svg>
  );
}
function HourglassGlyph() {
  return (
    <svg {...glyph}>
      <path d="M6 2h12M6 22h12M6 2v4a6 6 0 006 6 6 6 0 006-6V2M6 22v-4a6 6 0 016-6 6 6 0 016 6v4" />
    </svg>
  );
}
function CheckGlyph() {
  return (
    <svg {...glyph}>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}
function UpArrowGlyph() {
  return (
    <svg {...glyph}>
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}
function SearchGlyph() {
  return (
    <svg {...glyph} width={16} height={16}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}
function ClockGlyph() {
  return (
    <svg {...glyph} width={13} height={13}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
function ArrowRightGlyph() {
  return (
    <svg {...glyph} width={13} height={13}>
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  );
}
function InboxGlyph() {
  return (
    <svg {...glyph} width={28} height={28}>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
    </svg>
  );
}
function RefreshIcon() {
  return (
    <svg {...glyph} width={14} height={14}>
      <path d="M23 4v6h-6M1 20v-6h6" />
      <path d="M20.49 9A9 9 0 005.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 013.51 15" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg {...glyph} width={14} height={14} strokeWidth={2.5}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/* =========================================================================
   Agent-only helpers below.
   ========================================================================= */

/** Lightweight client-side mirror of the server SLA level for list rows. */
function SlaLevelCell({ ticket }: { ticket: TicketRow }) {
  const resolved = SOLVED.includes(ticket.status) || !!ticket.resolvedAt;
  const paused = !!ticket.slaPausedAt;
  const now = Date.now();
  const responded = !!ticket.firstRespondedAt;
  const nextDue = !responded ? ticket.dueResponseAt : ticket.dueResolveAt;

  let level: "met" | "on_track" | "at_risk" | "breached" = "on_track";
  if (resolved) {
    const over =
      ticket.dueResolveAt && ticket.resolvedAt
        ? new Date(ticket.resolvedAt).getTime() > new Date(ticket.dueResolveAt).getTime()
        : false;
    level = over ? "breached" : "met";
  } else if (nextDue) {
    const due = new Date(nextDue).getTime();
    const created = new Date(ticket.createdAt).getTime();
    const ref = paused && ticket.slaPausedAt ? new Date(ticket.slaPausedAt).getTime() : now;
    if (ref > due) level = "breached";
    else if (due - created > 0 && (ref - created) / (due - created) >= 0.8) level = "at_risk";
  }
  return <SlaBadge level={level} paused={paused && !resolved} />;
}

function ViewsSidebar({
  activeView,
  counts,
  onSelect,
}: {
  activeView: string;
  counts: Record<string, number>;
  onSelect: (id: string) => void;
}) {
  return (
    <aside
      className="hide-md"
      style={{
        width: 264,
        flexShrink: 0,
        borderRight: "1px solid var(--border)",
        background: "var(--surface)",
        overflow: "auto",
        padding: "0.9rem 0.65rem",
      }}
    >
      <div className="label" style={{ padding: "0.25rem 0.6rem 0.55rem" }}>
        Saved views
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {VIEWS.map((v) => {
          const active = v.id === activeView;
          const count = counts[v.id] ?? 0;
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => onSelect(v.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "0.5rem 0.6rem",
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
                textAlign: "left",
                fontSize: "0.84rem",
                fontWeight: active ? 700 : 500,
                color: active ? "var(--brand-700)" : "var(--text-secondary)",
                background: active ? "var(--brand-50)" : "transparent",
                boxShadow: active ? "inset 3px 0 0 var(--brand-600)" : "none",
                transition: "background var(--dur-1) var(--ease), color var(--dur-1) var(--ease)",
              }}
              onMouseEnter={(e) => {
                if (!active) e.currentTarget.style.background = "var(--surface-2)";
              }}
              onMouseLeave={(e) => {
                if (!active) e.currentTarget.style.background = "transparent";
              }}
            >
              <span
                aria-hidden
                style={{
                  display: "inline-flex",
                  color: active ? "var(--brand-600)" : "var(--muted)",
                  flexShrink: 0,
                  transition: "color var(--dur-1) var(--ease)",
                }}
              >
                <ViewGlyph icon={v.icon} />
              </span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {v.label}
              </span>
              <span
                style={{
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  padding: "1px 7px",
                  borderRadius: 999,
                  background: active ? "var(--brand-500)" : "var(--surface-3)",
                  color: active ? "#fff" : "var(--muted)",
                  fontVariantNumeric: "tabular-nums",
                  transition: "background var(--dur-1) var(--ease), color var(--dur-1) var(--ease)",
                }}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function NewTicketForm({
  isAgent,
  defaultRequester,
  lockRequester,
  onCreated,
}: {
  isAgent: boolean;
  defaultRequester: string;
  lockRequester: boolean;
  onCreated: () => void;
}) {
  const [type, setType] = useState<"incident" | "service_request">("incident");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [requester, setRequester] = useState(defaultRequester);
  const [category, setCategory] = useState<string>("IT");
  const [subcategory, setSubcategory] = useState("");
  const [impact, setImpact] = useState<ImpactLevel>("medium");
  const [urgency, setUrgency] = useState<ImpactLevel>("medium");
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

  async function submit() {
    if (!subject || !body || !requester) return;
    setSubmitting(true);
    try {
      const ticket = await apiSend<TicketRow>("/tickets", "POST", {
        type,
        subject,
        body,
        requesterEmail: requester,
        category: category as TicketCategory,
        subcategory: subcategory.trim() || undefined,
        // Requesters don't pick impact/urgency — AI classification fills them.
        ...(isAgent ? { impact, urgency } : {}),
      });
      setSubject("");
      setBody("");
      setSubcategory("");
      onCreated();
      if (ticket.status === "auto_resolved") {
        toast.success({
          title: isAgent ? "Ticket auto-resolved" : "Answer ready",
          description: isAgent ? `Reply delivered to ${ticket.requesterEmail}.` : "We found an answer for you.",
        });
      } else if (ticket.status === "pending_agent") {
        toast.info({
          title: isAgent ? "Draft ready for an agent" : "Request received",
          description: isAgent ? "Open the ticket to review." : "An agent will follow up shortly.",
        });
      } else if (ticket.status === "pending") {
        toast.info({
          title: "Awaiting approval",
          description: `${ticket.reference} needs a manager's approval before fulfilment.`,
        });
      } else {
        toast.info({
          title: isAgent ? "Routed to a person" : "Request received",
          description: isAgent ? "Sent to the human queue." : "An agent will follow up shortly.",
        });
      }
    } catch (err) {
      toast.error({
        title: "Could not create ticket",
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="panel anim-fade-up" style={{ padding: "1.1rem 1.2rem" }}>
      <div className="flex items-center" style={{ gap: 8, marginBottom: 14 }}>
        <span
          aria-hidden
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: "var(--brand-50)",
            color: "var(--brand-700)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 5v14M5 12h14" />
          </svg>
        </span>
        <span style={{ fontSize: "0.95rem", fontWeight: 700 }}>
          {isAgent ? "New ticket" : "New request"}
        </span>
      </div>
      <div style={{ display: "grid", gap: 14 }}>
        <section>
          <div className="label" style={{ marginBottom: 6 }}>What happened?</div>
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
              <select className="select" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
                <option value="incident">Incident (something is broken)</option>
                <option value="service_request">Service request (I need something)</option>
              </select>
              <input className="input" placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
            <textarea
              className="textarea"
              rows={3}
              placeholder="Describe the issue — error messages and steps to reproduce help"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
        </section>

        <section>
          <div className="label" style={{ marginBottom: 6 }}>Who and where</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
            <input
              className="input"
              placeholder="requester@netlink.com"
              value={requester}
              disabled={lockRequester}
              onChange={(e) => setRequester(e.target.value)}
            />
            <select className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input
              className="input"
              placeholder="Subcategory (e.g. VPN)"
              value={subcategory}
              onChange={(e) => setSubcategory(e.target.value)}
            />
          </div>
        </section>

        {isAgent ? (
          <section>
            <div className="label" style={{ marginBottom: 6 }}>Prioritisation</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
              <div>
                <div className="muted" style={{ fontSize: "0.72rem", marginBottom: 4 }}>Impact (scope of effect)</div>
                <select className="select" value={impact} onChange={(e) => setImpact(e.target.value as ImpactLevel)}>
                  {IMPACT_LEVELS.map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </div>
              <div>
                <div className="muted" style={{ fontSize: "0.72rem", marginBottom: 4 }}>Urgency (time sensitivity)</div>
                <select className="select" value={urgency} onChange={(e) => setUrgency(e.target.value as ImpactLevel)}>
                  {IMPACT_LEVELS.map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </div>
            </div>
            <p className="muted" style={{ fontSize: "0.74rem", margin: "8px 0 0" }}>
              Priority is derived from impact × urgency (ITIL matrix).
            </p>
          </section>
        ) : null}

        <div className="flex items-center" style={{ gap: 10 }}>
          <button
            className="btn btn-primary"
            onClick={submit}
            disabled={submitting || !subject || !body || !requester}
          >
            {submitting ? "Finding an answer…" : isAgent ? "Create & answer" : "Submit request"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={className}
      style={{
        padding: "0.65rem 0.9rem",
        fontWeight: 700,
        fontSize: "0.68rem",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  );
}
function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={className} style={{ padding: "0.68rem 0.9rem", verticalAlign: "middle" }}>
      {children}
    </td>
  );
}
