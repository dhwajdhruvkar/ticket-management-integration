"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiGet, apiSend } from "@/lib/api";
import type { ArticleRow, TicketCategory } from "@/server/domain/models";
import { usePersona } from "./Persona";
import { useToast } from "./Toast";
import { CardGridSkeleton } from "./Skeleton";
import { timeAgo } from "./ui";

// =============================================================================
// KBManager — knowledge base browser + editor.
//
// Requesters get a readable help center: hero search, category chips, and a
// full-article reader drawer. Agents additionally create, edit, and delete
// articles from the same drawer. All persistence stays on /api/v1/kb.
// =============================================================================

const CATEGORIES: TicketCategory[] = ["IT", "HR", "Access", "Software", "Hardware", "Network", "Billing", "Other"];

type DrawerState =
  | { mode: "read"; article: ArticleRow }
  | { mode: "edit"; article: ArticleRow }
  | { mode: "create" }
  | null;

export default function KBManager() {
  const searchParams = useSearchParams();
  const focusId = searchParams.get("focus") ?? undefined;
  const { persona, ready } = usePersona();
  const isAgent = persona.role === "agent";
  const [articles, setArticles] = useState<ArticleRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | TicketCategory>("all");
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const toast = useToast();

  const refresh = useCallback(() => {
    apiGet<ArticleRow[]>("/kb").then(setArticles).catch(() => setArticles([]));
  }, []);

  useEffect(() => {
    if (ready) refresh();
  }, [ready, persona.id, refresh]);

  // Deep-link (?focus=<id>) opens the reader once articles arrive.
  useEffect(() => {
    if (!focusId || !articles) return;
    const target = articles.find((a) => a.id === focusId);
    if (target) setDrawer({ mode: "read", article: target });
  }, [focusId, articles]);

  const counts = useMemo(() => {
    const map: Partial<Record<TicketCategory, number>> = {};
    for (const a of articles ?? []) map[a.category] = (map[a.category] ?? 0) + 1;
    return map;
  }, [articles]);

  const filtered = useMemo(() => {
    let all = articles ?? [];
    if (category !== "all") all = all.filter((a) => a.category === category);
    if (query) {
      const q = query.toLowerCase();
      all = all.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          a.content.toLowerCase().includes(q) ||
          a.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    return all;
  }, [articles, query, category]);

  async function remove(id: string) {
    if (!confirm("Delete this article? It will be removed from the vector index.")) return;
    try {
      await apiSend(`/kb/${id}`, "DELETE");
      setDrawer(null);
      refresh();
      toast.info({ title: "Article deleted", description: "Removed from the search index." });
    } catch (err) {
      toast.error({
        title: "Could not delete article",
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (articles === null)
    return (
      <div className="page-pad">
        <CardGridSkeleton title={240} count={6} columns={2} />
      </div>
    );

  return (
    <div className="page-pad anim-fade-up">
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        {/* Hero ---------------------------------------------------------- */}
        <section
          style={{
            position: "relative",
            borderRadius: "var(--r-xl)",
            overflow: "hidden",
            padding: "clamp(1.3rem, 3vw, 1.9rem)",
            border: "1px solid var(--border)",
            background: "var(--surface)",
            boxShadow: "var(--shadow-sm)",
            marginBottom: 16,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-end",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  padding: "0.25rem 0.6rem",
                  borderRadius: 999,
                  color: "var(--brand-700)",
                  background: "var(--brand-50)",
                  border: "1px solid var(--brand-100)",
                  marginBottom: 10,
                }}
              >
                <BookIcon size={12} /> {articles.length} articles indexed
              </div>
              <h1
                style={{
                  fontSize: "clamp(1.5rem, 2.6vw, 1.85rem)",
                  fontWeight: 800,
                  letterSpacing: "-0.03em",
                  margin: 0,
                  lineHeight: 1.1,
                }}
              >
                {isAgent ? "Knowledge Base" : "Help Center"}
              </h1>
              <p className="muted" style={{ fontSize: "0.9rem", margin: "6px 0 0", maxWidth: 560 }}>
                {isAgent
                  ? "Everything the assistant retrieves from. Well-written articles directly raise auto-resolution."
                  : "Search guides and answers to common questions — most answers are a click away."}
              </p>

              {/* Search */}
              <div style={{ position: "relative", maxWidth: 460, marginTop: 14 }}>
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    left: 13,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "var(--muted)",
                    display: "inline-flex",
                    pointerEvents: "none",
                  }}
                >
                  <SearchIcon />
                </span>
                <input
                  className="input"
                  placeholder="Search titles, content, or #tags…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  style={{ paddingLeft: 38, height: 44, borderRadius: 12 }}
                />
              </div>
            </div>
            {isAgent ? (
              <button className="btn btn-primary" style={{ height: 40 }} onClick={() => setDrawer({ mode: "create" })}>
                <PlusIcon />
                <span style={{ marginLeft: 6 }}>Add article</span>
              </button>
            ) : null}
          </div>
        </section>

        {/* Category chips ------------------------------------------------- */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
          <CategoryChip
            active={category === "all"}
            label="All topics"
            count={articles.length}
            onClick={() => setCategory("all")}
          />
          {CATEGORIES.filter((c) => (counts[c] ?? 0) > 0).map((c) => (
            <CategoryChip
              key={c}
              active={category === c}
              label={c}
              count={counts[c] ?? 0}
              onClick={() => setCategory(category === c ? "all" : c)}
            />
          ))}
        </div>

        {/* Cards ---------------------------------------------------------- */}
        {filtered.length === 0 ? (
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
              <BookIcon size={26} />
            </div>
            <div>
              <div style={{ fontWeight: 700 }}>
                {articles.length === 0 ? "No articles yet" : "Nothing matches"}
              </div>
              <p className="muted" style={{ fontSize: "0.85rem", margin: "4px 0 0" }}>
                {articles.length === 0
                  ? isAgent
                    ? "Add the first article to start powering AI answers."
                    : "Check back soon."
                  : "Try a different search term or clear the category filter."}
              </p>
            </div>
            {articles.length === 0 && isAgent ? (
              <button className="btn btn-primary" onClick={() => setDrawer({ mode: "create" })}>
                + Add article
              </button>
            ) : filtered.length === 0 && articles.length > 0 ? (
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setQuery("");
                  setCategory("all");
                }}
              >
                Clear filters
              </button>
            ) : null}
          </div>
        ) : (
          <div
            className="stagger"
            style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}
          >
            {filtered.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setDrawer({ mode: "read", article: a })}
                className="kb-card hover-lift"
                style={{
                  textAlign: "left",
                  padding: "1.05rem 1.15rem",
                  borderRadius: 14,
                  border: `1px solid ${focusId === a.id ? "var(--brand-500)" : "var(--border)"}`,
                  background: "var(--surface)",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  boxShadow: "var(--shadow-sm)",
                  transition:
                    "border-color var(--dur-2) var(--ease), box-shadow var(--dur-2) var(--ease), transform var(--dur-2) var(--ease-out)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span
                    className="badge"
                    style={{
                      background: "var(--brand-50)",
                      color: "var(--brand-700)",
                      borderColor: "var(--brand-100)",
                    }}
                  >
                    {a.category}
                  </span>
                  <ArticleStatusChip status={a.status} />
                  <span
                    className="badge mono"
                    style={{
                      marginLeft: "auto",
                      background: "var(--surface-3)",
                      color: "var(--text-secondary)",
                      borderColor: "var(--border)",
                      fontSize: "0.64rem",
                    }}
                  >
                    v{a.version}
                  </span>
                  <span className="muted" style={{ fontSize: "0.68rem" }}>
                    {timeAgo(a.updatedAt)}
                  </span>
                </div>
                <h3 style={{ fontSize: "0.98rem", fontWeight: 700, margin: 0, lineHeight: 1.35 }}>{a.title}</h3>
                <p
                  className="muted"
                  style={{
                    fontSize: "0.82rem",
                    lineHeight: 1.55,
                    margin: 0,
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {a.content}
                </p>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: "auto" }}>
                  {a.tags.slice(0, 4).map((t) => (
                    <span
                      key={t}
                      className="badge"
                      style={{
                        background: "var(--surface-3)",
                        color: "var(--muted)",
                        fontSize: "0.66rem",
                      }}
                    >
                      #{t}
                    </span>
                  ))}
                  <span
                    style={{
                      marginLeft: "auto",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      color: "var(--brand-700)",
                      fontWeight: 600,
                      fontSize: "0.78rem",
                    }}
                  >
                    Read <ArrowRightIcon />
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Drawer ------------------------------------------------------------ */}
      {drawer ? (
        <ArticleDrawer
          state={drawer}
          isAgent={isAgent}
          onClose={() => setDrawer(null)}
          onEdit={(a) => setDrawer({ mode: "edit", article: a })}
          onDelete={(id) => void remove(id)}
          onSaved={() => {
            setDrawer(null);
            refresh();
          }}
        />
      ) : null}

      <style jsx>{`
        .kb-card:hover {
          border-color: var(--brand-300);
        }
      `}</style>
    </div>
  );
}

/** Uppercase status chip with a leading dot (DRAFT / IN REVIEW / PUBLISHED). */
function ArticleStatusChip({ status }: { status: string }) {
  const published = status === "published";
  const tone = published
    ? { bg: "var(--success-bg)", fg: "var(--success-fg)", border: "var(--success-border)", dot: "var(--success-solid)" }
    : { bg: "var(--warning-bg)", fg: "var(--warning-fg)", border: "var(--warning-border)", dot: "var(--warning-solid)" };
  return (
    <span
      className="badge"
      style={{
        background: tone.bg,
        color: tone.fg,
        borderColor: tone.border,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        fontSize: "0.62rem",
      }}
    >
      <span aria-hidden style={{ width: 6, height: 6, borderRadius: 999, background: tone.dot, flexShrink: 0 }} />
      {status.replace(/_/g, " ")}
    </span>
  );
}

/* =========================================================================
   Category chip
   ========================================================================= */

function CategoryChip({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
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
      {label}
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

/* =========================================================================
   Article drawer (read / edit / create)
   ========================================================================= */

function ArticleDrawer({
  state,
  isAgent,
  onClose,
  onEdit,
  onDelete,
  onSaved,
}: {
  state: NonNullable<DrawerState>;
  isAgent: boolean;
  onClose: () => void;
  onEdit: (a: ArticleRow) => void;
  onDelete: (id: string) => void;
  onSaved: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const reading = state.mode === "read";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={reading ? "Article" : state.mode === "edit" ? "Edit article" : "New article"}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--scrim)",
        backdropFilter: "var(--backdrop-blur)",
        WebkitBackdropFilter: "var(--backdrop-blur)",
        zIndex: 60,
        display: "flex",
        justifyContent: "flex-end",
        animation: "drawer-fade var(--dur-2) var(--ease-out) both",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(620px, 100vw)",
          height: "100%",
          background: "var(--surface)",
          borderLeft: "1px solid var(--border)",
          boxShadow: "var(--shadow-lg)",
          display: "flex",
          flexDirection: "column",
          animation: "drawer-slide var(--dur-3) var(--ease-out) both",
        }}
      >
        {reading ? (
          <ArticleReader
            article={state.article}
            isAgent={isAgent}
            onClose={onClose}
            onEdit={() => onEdit(state.article)}
            onDelete={() => onDelete(state.article.id)}
          />
        ) : (
          <ArticleForm
            article={state.mode === "edit" ? state.article : undefined}
            onSaved={onSaved}
            onCancel={onClose}
          />
        )}
      </div>
      <style jsx>{`
        @keyframes drawer-fade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes drawer-slide {
          from { transform: translateX(40px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

function ArticleReader({
  article,
  isAgent,
  onClose,
  onEdit,
  onDelete,
}: {
  article: ArticleRow;
  isAgent: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      {/* Header */}
      <div
        style={{
          padding: "1.1rem 1.35rem",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
          flexShrink: 0,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            <span
              className="badge"
              style={{
                background: "var(--brand-50)",
                color: "var(--brand-700)",
                borderColor: "var(--brand-100)",
              }}
            >
              {article.category}
            </span>
            <ArticleStatusChip status={article.status} />
            <span className="muted" style={{ fontSize: "0.7rem" }}>
              v{article.version} · updated {timeAgo(article.updatedAt)}
            </span>
          </div>
          <h2 style={{ fontSize: "1.15rem", fontWeight: 800, letterSpacing: "-0.02em", margin: 0, lineHeight: 1.3 }}>
            {article.title}
          </h2>
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="btn btn-ghost"
          style={{ width: 32, height: 32, padding: 0, borderRadius: 8, flexShrink: 0 }}
        >
          <CloseIcon />
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: "auto", padding: "1.25rem 1.35rem" }}>
        <div
          style={{
            fontSize: "0.92rem",
            lineHeight: 1.7,
            color: "var(--text-secondary)",
            whiteSpace: "pre-wrap",
          }}
        >
          {article.content}
        </div>
        {article.tags.length > 0 ? (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 20 }}>
            {article.tags.map((t) => (
              <span
                key={t}
                className="badge"
                style={{ background: "var(--surface-3)", color: "var(--muted)", fontSize: "0.7rem" }}
              >
                #{t}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {/* Footer */}
      {isAgent ? (
        <div
          style={{
            padding: "0.9rem 1.35rem",
            borderTop: "1px solid var(--border)",
            display: "flex",
            gap: 8,
            flexShrink: 0,
            background: "var(--surface-2)",
          }}
        >
          <button className="btn btn-primary" onClick={onEdit} style={{ flex: 1 }}>
            <EditIcon /> <span style={{ marginLeft: 6 }}>Edit article</span>
          </button>
          <button className="btn btn-danger" onClick={onDelete}>
            Delete
          </button>
        </div>
      ) : null}
    </>
  );
}

/* =========================================================================
   Article form (create / edit) — lives inside the drawer
   ========================================================================= */

function ArticleForm({
  article,
  onSaved,
  onCancel,
}: {
  article?: ArticleRow;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const isEdit = !!article;
  const [title, setTitle] = useState(article?.title ?? "");
  const [content, setContent] = useState(article?.content ?? "");
  const [category, setCategory] = useState<string>(article?.category ?? "IT");
  const [tags, setTags] = useState((article?.tags ?? []).join(", "));
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

  async function submit() {
    if (!title || !content) return;
    setSubmitting(true);
    try {
      const payload = {
        title,
        content,
        category: category as TicketCategory,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        isPublic: true,
      };
      if (isEdit && article) {
        await apiSend(`/kb/${article.id}`, "PATCH", payload);
      } else {
        await apiSend("/kb", "POST", payload);
      }
      onSaved();
      toast.success({
        title: isEdit ? "Article updated" : "Article saved",
        description: `"${title}" ${isEdit ? "re-indexed" : "indexed"} and ready to answer tickets.`,
      });
    } catch (err) {
      toast.error({
        title: isEdit ? "Could not update article" : "Could not save article",
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div
        style={{
          padding: "1.1rem 1.35rem",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexShrink: 0,
        }}
      >
        <div>
          <h2 style={{ fontSize: "1.05rem", fontWeight: 800, letterSpacing: "-0.02em", margin: 0 }}>
            {isEdit ? "Edit article" : "New article"}
          </h2>
          <p className="muted" style={{ fontSize: "0.76rem", margin: "3px 0 0" }}>
            {isEdit
              ? `Editing ${article!.id} — saving re-embeds it in the vector index.`
              : "New articles are embedded immediately and used for AI answers."}
          </p>
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={onCancel}
          className="btn btn-ghost"
          style={{ width: 32, height: 32, padding: 0, borderRadius: 8, flexShrink: 0 }}
        >
          <CloseIcon />
        </button>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "1.25rem 1.35rem", display: "grid", gap: 14, alignContent: "start" }}>
        <div>
          <label className="label" style={{ marginBottom: 6, display: "block" }}>Title</label>
          <input className="input" placeholder="e.g. Reset your VPN password" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label className="label" style={{ marginBottom: 6, display: "block" }}>Content</label>
          <textarea
            className="textarea"
            rows={14}
            placeholder="Step-by-step instructions. Plain text — keep each step on its own line."
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
          <div>
            <label className="label" style={{ marginBottom: 6, display: "block" }}>Category</label>
            <select className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" style={{ marginBottom: 6, display: "block" }}>Tags</label>
            <input
              className="input"
              placeholder="vpn, remote, password"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div
        style={{
          padding: "0.9rem 1.35rem",
          borderTop: "1px solid var(--border)",
          display: "flex",
          gap: 8,
          flexShrink: 0,
          background: "var(--surface-2)",
        }}
      >
        <button
          className="btn btn-primary"
          onClick={submit}
          disabled={submitting || !title || !content}
          style={{ flex: 1 }}
        >
          {submitting ? "Saving…" : isEdit ? "Save changes" : "Save article"}
        </button>
        <button className="btn btn-ghost" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
      </div>
    </>
  );
}

/* =========================================================================
   Icons
   ========================================================================= */

function BookIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function CloseIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
function EditIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}
function ArrowRightIcon() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  );
}
