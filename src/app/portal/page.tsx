"use client";

import Link from "next/link";
import type { CSSProperties, ReactElement } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { usePersona } from "@/components/Persona";
import { InfoHint, LabelWithHint, StatusBadge, timeAgo } from "@/components/ui";
import { CloseButton, Drawer } from "@/components/primitives";
import { HINTS } from "@/lib/hints";
import type { TicketCategory, TicketRow, TicketStatus } from "@/server/domain/models";

// =============================================================================
// Route /portal — the self-service Help Center (requester landing page).
//
// Hero KB search with quick-question chips, the service catalog (pre-fills the
// request form), the user's recent requests, category browsing, and a
// full-article reader — plus the "raise a request" dialog which submits through
// /api/v1/intake (catalog items carry catalogItemId so approval flows trigger).
// =============================================================================

interface Article {
  id: string;
  title: string;
  category: TicketCategory;
  content?: string;
  tags?: string[];
  status?: string;
  updatedAt?: string;
}
interface SearchHit { id: string; title: string; snippet: string; score: number }
interface CatalogItem {
  id: string;
  name: string;
  description: string;
  category: TicketCategory;
  requiresApproval: boolean;
}
interface CreatedTicket { reference: string; status: TicketStatus }

type CategoryFilter = "all" | TicketCategory;

const CATEGORY_ORDER: TicketCategory[] = [
  "IT",
  "Access",
  "Software",
  "Hardware",
  "Network",
  "HR",
  "Billing",
  "Other",
];

const QUICK_CHIPS: { label: string; query: string }[] = [
  { label: "Reset password", query: "reset password" },
  { label: "VPN access", query: "VPN" },
  { label: "New laptop", query: "laptop" },
  { label: "Software install", query: "software install" },
  { label: "Guest Wi-Fi", query: "guest wifi" },
];

export default function PortalPage() {
  const { persona, ready } = usePersona();
  const isRequester = persona.role === "requester";
  const [articles, setArticles] = useState<Article[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [recent, setRecent] = useState<TicketRow[]>([]);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [selectedCatalog, setSelectedCatalog] = useState<CatalogItem | null>(null);
  const [email, setEmail] = useState("");
  const [created, setCreated] = useState<CreatedTicket | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState<Article | null>(null);
  const [readingBusy, setReadingBusy] = useState(false);
  const [readingError, setReadingError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    apiGet<Article[]>("/kb?public=1").then(setArticles).catch(() => setArticles([]));
    apiGet<CatalogItem[]>("/catalog").then(setCatalog).catch(() => setCatalog([]));
  }, []);

  useEffect(() => {
    if (!ready || !persona.email) return;
    setEmail(persona.email);
    apiGet<TicketRow[]>("/tickets")
      .then((all) => setRecent(all.slice(0, 3)))
      .catch(() => setRecent([]));
  }, [ready, persona.email]);

  async function runSearch(value: string) {
    setQ(value);
    if (value.trim().length < 3) return setHits([]);
    try {
      const res = await apiGet<{ hits: SearchHit[] }>(`/kb/search?q=${encodeURIComponent(value)}`);
      setHits(res.hits);
    } catch {
      setHits([]);
    }
  }

  /**
   * Open the reader. List and search payloads are trimmed (no body, or only a
   * snippet), so the full article is fetched on demand and the drawer shows the
   * summary it already has while that is in flight.
   */
  async function openArticle(seed: Article) {
    setReading(seed);
    setReadingError(null);
    if (seed.content) return;
    setReadingBusy(true);
    try {
      setReading(await apiGet<Article>(`/kb/${seed.id}`));
    } catch (err) {
      setReadingError(err instanceof Error ? err.message : String(err));
    } finally {
      setReadingBusy(false);
    }
  }

  function openDialog(item: CatalogItem | null) {
    setSelectedCatalog(item);
    if (item) {
      setSubject(item.name);
      setBody(`Requesting: ${item.name}.\n\nDetails:\n`);
    } else if (!subject && !body) {
      setSubject("");
      setBody("");
    }
    setCreated(null);
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
  }

  async function submit() {
    if (!subject.trim() || !body.trim()) return;
    setBusy(true);
    try {
      const t = await apiSend<CreatedTicket>("/intake", "POST", {
        channel: "portal",
        subject,
        body,
        requesterEmail: email,
        source: "portal",
        catalogItemId: selectedCatalog?.id,
      });
      setCreated(t);
      setSubject("");
      setBody("");
      setSelectedCatalog(null);
      apiGet<TicketRow[]>("/tickets")
        .then((all) => setRecent(all.slice(0, 3)))
        .catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  const articlesByCategory = useMemo(() => {
    const map = new Map<TicketCategory, Article[]>();
    for (const a of articles) {
      if (!map.has(a.category)) map.set(a.category, []);
      map.get(a.category)!.push(a);
    }
    return map;
  }, [articles]);

  const filteredArticles = useMemo(() => {
    if (activeCategory === "all") return articles;
    return articles.filter((a) => a.category === activeCategory);
  }, [articles, activeCategory]);

  const categoryCounts = useMemo(() => {
    const counts: Partial<Record<TicketCategory, number>> = {};
    for (const a of articles) counts[a.category] = (counts[a.category] ?? 0) + 1;
    return counts;
  }, [articles]);

  const showHits = q.trim().length >= 3 && hits.length > 0;

  return (
    <div className="page-pad" style={{ maxWidth: 1120, margin: "0 auto" }}>
      {/* Hero ------------------------------------------------------------- */}
      <section
        className="anim-fade-up"
        style={{
          position: "relative",
          borderRadius: "var(--r-xl)",
          overflow: "hidden",
          padding: "clamp(1.75rem, 4vw, 2.75rem) clamp(1.25rem, 3vw, 2rem)",
          background: "var(--brand-gradient-soft)",
          border: "1px solid var(--border)",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <div style={{ position: "relative", maxWidth: 720, margin: "0 auto", textAlign: "center" }}>
          <span
            className="badge"
            style={{
              background: "var(--info-bg)",
              color: "var(--info-fg)",
              borderColor: "var(--info-border)",
              marginBottom: 12,
            }}
          >
            <span
              aria-hidden
              style={{
                width: 6,
                height: 6,
                borderRadius: 999,
                background: "var(--info-solid)",
                display: "inline-block",
                marginRight: 6,
                animation: "pulse-soft 2.2s var(--ease-in-out) infinite",
              }}
            />
            Netlink Support · Self-service portal
          </span>
          <h1
            style={{
              fontSize: "clamp(1.8rem, 3.4vw, 2.45rem)",
              fontWeight: 800,
              letterSpacing: "-0.03em",
              margin: 0,
              lineHeight: 1.12,
            }}
          >
            How can we help?
          </h1>
          <p className="muted" style={{ marginTop: 10, fontSize: "0.95rem", lineHeight: 1.55 }}>
            Search the knowledge base, browse the service catalog, or ask us directly —
            the assistant may resolve your request instantly.
          </p>

          {/* Search */}
          <div
            style={{
              position: "relative",
              maxWidth: 560,
              margin: "18px auto 0",
            }}
          >
            <SearchIcon />
            <input
              ref={searchRef}
              className="input"
              style={{
                height: 52,
                paddingLeft: 44,
                paddingRight: 16,
                fontSize: "0.95rem",
                borderRadius: 12,
                boxShadow: "var(--shadow-sm)",
              }}
              placeholder="Search help articles (e.g. reset password, VPN, laptop)…"
              value={q}
              onChange={(e) => runSearch(e.target.value)}
            />
          </div>

          {/* Quick chips */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              justifyContent: "center",
              marginTop: 14,
            }}
          >
            {QUICK_CHIPS.map((c) => (
              <button
                key={c.label}
                type="button"
                onClick={() => {
                  runSearch(c.query);
                  searchRef.current?.focus();
                }}
                className="hover-lift"
                style={chipStyle}
              >
                {c.label}
              </button>
            ))}
          </div>

          {/* Created banner surfaces here too */}
          {created ? (
            <div
              className="anim-scale-in"
              style={{
                marginTop: 18,
                padding: "0.85rem 1rem",
                background: "var(--success-bg)",
                color: "var(--success-fg)",
                border: "1px solid var(--success-border)",
                borderRadius: 12,
                fontSize: "0.9rem",
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
                textAlign: "left",
              }}
            >
              <CheckCircleIcon />
              <span>
                Request <strong>{created.reference}</strong>{" "}
                {created.status === "auto_resolved"
                  ? "was resolved instantly by the assistant. Check your email."
                  : created.status === "pending"
                  ? "is awaiting manager approval before fulfilment."
                  : "was received — an agent will follow up shortly."}
              </span>
            </div>
          ) : null}
        </div>
      </section>

      {/* Search hits ------------------------------------------------------ */}
      {showHits ? (
        <section
          className="panel anim-fade-up"
          style={{ padding: "1rem 1.2rem", marginTop: 16 }}
        >
          <div className="label" style={{ marginBottom: 8 }}>
            Top matches for “{q}”
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            {hits.map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() =>
                  void openArticle(
                    articles.find((a) => a.id === h.id) ?? {
                      id: h.id,
                      title: h.title,
                      category: "Other",
                    }
                  )
                }
                style={{
                  padding: "0.55rem 0.65rem",
                  borderRadius: 10,
                  transition: "background var(--dur-1) var(--ease)",
                  textAlign: "left",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: "inherit",
                  font: "inherit",
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 10,
                }}
                className="hit-row"
              >
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 700, fontSize: "0.9rem", display: "block" }}>{h.title}</span>
                  <span className="muted" style={{ fontSize: "0.8rem", display: "block", marginTop: 2 }}>
                    {h.snippet}
                  </span>
                </span>
                <span className="muted" aria-hidden style={{ fontSize: "0.9rem", flexShrink: 0 }}>
                  →
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {/* Recent requests -------------------------------------------------- */}
      {recent.length > 0 ? (
        <section className="anim-fade-up" style={{ marginTop: 22 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 10,
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <h2 style={sectionTitle}>Your recent requests</h2>
            <Link
              href="/tickets"
              className="chip-link"
              style={{ fontSize: "0.82rem", fontWeight: 600 }}
            >
              View all →
            </Link>
          </div>
          <div className="grid-thirds stagger" style={{ gap: 12 }}>
            {recent.map((t) => (
              <Link
                key={t.id}
                href={`/tickets/${t.id}`}
                className="panel hover-lift"
                style={{
                  padding: "0.95rem 1rem",
                  textDecoration: "none",
                  color: "inherit",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span className="mono" style={{ fontSize: "0.72rem", color: "var(--muted)" }}>
                    {t.reference}
                  </span>
                  <StatusBadge status={t.status} />
                </div>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: "0.92rem",
                    lineHeight: 1.35,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {t.subject}
                </div>
                <div className="muted" style={{ fontSize: "0.75rem" }}>
                  Updated {timeAgo(t.updatedAt)}
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* Service catalog -------------------------------------------------- */}
      {catalog.length > 0 ? (
        <section className="anim-fade-up" style={{ marginTop: 26 }}>
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
              marginBottom: 10,
            }}
          >
            <div>
              <h2 style={sectionTitle}>What do you need?</h2>
              <p className="muted" style={{ margin: "2px 0 0", fontSize: "0.85rem" }}>
                Pick a common request — we&apos;ll pre-fill the form for you.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => openDialog(null)}
              style={{ height: 38 }}
            >
              <PencilIcon /> <span style={{ marginLeft: 6 }}>Submit a custom request</span>
            </button>
          </div>
          <div className="grid-catalog stagger" style={{ gap: 12 }}>
            {catalog.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => openDialog(c)}
                className="hover-lift"
                style={{
                  textAlign: "left",
                  padding: "1rem 1.05rem",
                  border: "1px solid var(--border)",
                  borderRadius: 14,
                  background: "var(--surface)",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  transition:
                    "border-color var(--dur-2) var(--ease), box-shadow var(--dur-2) var(--ease), transform var(--dur-2) var(--ease-out)",
                  boxShadow: "var(--shadow-xs, 0 1px 2px rgba(15,23,42,0.04))",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <CategoryTile category={c.category} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: "0.95rem", lineHeight: 1.2 }}>
                      {c.name}
                    </div>
                    <div className="muted" style={{ fontSize: "0.72rem", marginTop: 2 }}>
                      {c.category}
                      {c.requiresApproval ? " · needs approval" : ""}
                    </div>
                  </div>
                </div>
                <p
                  className="muted"
                  style={{
                    fontSize: "0.82rem",
                    lineHeight: 1.45,
                    margin: 0,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {c.description}
                </p>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: "0.8rem",
                    fontWeight: 600,
                    color: "var(--brand-700)",
                    marginTop: "auto",
                  }}
                >
                  Request
                  <ArrowRightIcon />
                </div>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {/* Browse the help center ------------------------------------------ */}
      {articles.length > 0 ? (
        <section className="anim-fade-up" style={{ marginTop: 30 }}>
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
              marginBottom: 12,
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div>
              <h2 style={sectionTitle}>Browse the help center</h2>
              <p className="muted" style={{ margin: "2px 0 0", fontSize: "0.85rem" }}>
                {articles.length} articles across {articlesByCategory.size} topics.
              </p>
            </div>
          </div>

          {/* Category filter chips */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
            <FilterChip
              active={activeCategory === "all"}
              onClick={() => setActiveCategory("all")}
              icon={<SparklesIcon />}
              label="All topics"
              count={articles.length}
            />
            {CATEGORY_ORDER.filter((c) => (categoryCounts[c] ?? 0) > 0).map((c) => (
              <FilterChip
                key={c}
                active={activeCategory === c}
                onClick={() => setActiveCategory(c)}
                icon={<CategoryGlyph category={c} />}
                label={c}
                count={categoryCounts[c] ?? 0}
              />
            ))}
          </div>

          <div className="grid-articles" style={{ gap: 10 }}>
            {filteredArticles.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => void openArticle(a)}
                className="article-card"
                style={{
                  textAlign: "left",
                  padding: "0.85rem 0.95rem",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  background: "var(--surface)",
                  cursor: "pointer",
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                  transition:
                    "border-color var(--dur-2) var(--ease), transform var(--dur-2) var(--ease-out), box-shadow var(--dur-2) var(--ease)",
                }}
              >
                <div style={{ marginTop: 2, flexShrink: 0 }}>
                  <CategoryGlyph category={a.category} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: "0.9rem",
                      lineHeight: 1.35,
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {a.title}
                  </div>
                  <div
                    className="muted"
                    style={{ fontSize: "0.72rem", marginTop: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}
                  >
                    {a.category}
                  </div>
                </div>
              </button>
            ))}
          </div>

          {filteredArticles.length === 0 ? (
            <div
              className="panel"
              style={{
                padding: "1rem 1.2rem",
                textAlign: "center",
                color: "var(--muted)",
                fontSize: "0.88rem",
              }}
            >
              No articles in this topic yet.
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Still stuck CTA ------------------------------------------------- */}
      <section
        className="anim-fade-up"
        style={{
          marginTop: 32,
          marginBottom: 20,
          padding: "1.4rem clamp(1.1rem, 3vw, 1.75rem)",
          borderRadius: 16,
          border: "1px solid var(--border)",
          background:
            "linear-gradient(120deg, var(--surface-2) 0%, var(--surface) 60%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: "1rem" }}>Can&apos;t find what you need?</div>
          <div className="muted" style={{ fontSize: "0.85rem", marginTop: 2 }}>
            Describe the problem in your own words — we&apos;ll route it to the right team.
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => openDialog(null)}>
          <PencilIcon /> <span style={{ marginLeft: 6 }}>Submit a request</span>
        </button>
      </section>

      {/* Request dialog --------------------------------------------------- */}
      {dialogOpen ? (
        <RequestDialog
          onClose={closeDialog}
          onSubmit={submit}
          busy={busy}
          email={email}
          setEmail={setEmail}
          emailLocked={isRequester}
          subject={subject}
          setSubject={setSubject}
          body={body}
          setBody={setBody}
          selectedCatalog={selectedCatalog}
          onClearCatalog={() => setSelectedCatalog(null)}
          created={created}
        />
      ) : null}

      {/* Article reader ---------------------------------------------------- */}
      <ArticleReader
        article={reading}
        loading={readingBusy}
        error={readingError}
        onClose={() => {
          setReading(null);
          setReadingError(null);
        }}
        onRaiseRequest={(a) => {
          setReading(null);
          setSelectedCatalog(null);
          setSubject(`Help with: ${a.title}`);
          setBody(`I read “${a.title}” in the help center and still need help.\n\nWhat I tried:\n`);
          setCreated(null);
          setDialogOpen(true);
        }}
      />

      <style jsx>{`
        .grid-thirds {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
        .grid-catalog {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        }
        .grid-articles {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        }
        @media (max-width: 820px) {
          .grid-thirds {
            grid-template-columns: 1fr;
          }
        }
        .hit-row:hover {
          background: var(--surface-2);
        }
        .article-card:hover {
          border-color: var(--brand-300);
          transform: translateY(-2px);
          box-shadow: var(--shadow-md);
        }
        @keyframes pulse-soft {
          0%,
          100% {
            opacity: 0.55;
            transform: scale(1);
          }
          50% {
            opacity: 1;
            transform: scale(1.35);
          }
        }
      `}</style>
    </div>
  );
}

/* ==============================================================
   Sub-components
   ============================================================== */

/** Read a help-center article without leaving the portal. */
function ArticleReader({
  article,
  loading,
  error,
  onClose,
  onRaiseRequest,
}: {
  article: Article | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onRaiseRequest: (article: Article) => void;
}) {
  return (
    <Drawer open={article !== null} onClose={onClose} ariaLabel={article?.title ?? "Article"} width={640}>
      {article ? (
        <div style={{ display: "flex", flexDirection: "column", minHeight: "100%" }}>
          <header
            style={{
              padding: "1.1rem 1.35rem",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                <span
                  className="badge"
                  style={{ background: "var(--brand-50)", color: "var(--brand-700)", borderColor: "var(--brand-100)" }}
                >
                  {article.category}
                </span>
                {article.updatedAt ? (
                  <span className="muted" style={{ fontSize: "0.72rem" }}>
                    updated {timeAgo(article.updatedAt)}
                  </span>
                ) : null}
              </div>
              <h2 style={{ fontSize: "1.15rem", fontWeight: 800, letterSpacing: "-0.02em", margin: 0, lineHeight: 1.3 }}>
                {article.title}
              </h2>
            </div>
            <CloseButton onClick={onClose} />
          </header>

          <div style={{ flex: 1, padding: "1.25rem 1.35rem" }}>
            {loading ? (
              <p className="muted" style={{ fontSize: "0.88rem", margin: 0 }}>
                Loading the full article…
              </p>
            ) : error ? (
              <p style={{ fontSize: "0.88rem", margin: 0, color: "var(--danger-fg)" }}>
                This article could not be loaded: {error}
              </p>
            ) : (
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
            )}
            {article.tags?.length ? (
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

          <footer
            style={{
              padding: "0.9rem 1.35rem",
              borderTop: "1px solid var(--border)",
              background: "var(--surface-2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <span className="muted" style={{ fontSize: "0.8rem" }}>
              Did this solve it?
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-ghost" onClick={onClose}>
                Yes, thanks
              </button>
              <button className="btn btn-primary" onClick={() => onRaiseRequest(article)}>
                Still need help
              </button>
            </div>
          </footer>
        </div>
      ) : null}
    </Drawer>
  );
}

function RequestDialog(props: {
  onClose: () => void;
  onSubmit: () => void;
  busy: boolean;
  email: string;
  setEmail: (v: string) => void;
  emailLocked: boolean;
  subject: string;
  setSubject: (v: string) => void;
  body: string;
  setBody: (v: string) => void;
  selectedCatalog: CatalogItem | null;
  onClearCatalog: () => void;
  created: CreatedTicket | null;
}) {
  const {
    onClose, onSubmit, busy,
    email, setEmail, emailLocked,
    subject, setSubject, body, setBody,
    selectedCatalog, onClearCatalog, created,
  } = props;

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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Submit a request"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--scrim)",
        backdropFilter: "var(--backdrop-blur)",
        WebkitBackdropFilter: "var(--backdrop-blur)",
        zIndex: 60,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        padding: "0",
        animation: "fade-in var(--dur-2) var(--ease-out) both",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="anim-scale-in"
        style={{
          width: "100%",
          maxWidth: 620,
          margin: "auto",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 16,
          boxShadow: "var(--shadow-lg, 0 24px 60px rgba(15,23,42,0.24))",
          padding: "1.25rem 1.35rem 1.35rem",
          maxHeight: "calc(100vh - 32px)",
          overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start", minWidth: 0 }}>
            {selectedCatalog ? <CategoryTile category={selectedCatalog.category} /> : null}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: "1.05rem", fontWeight: 750, letterSpacing: "-0.015em" }}>
                {selectedCatalog ? `Request ${selectedCatalog.name}` : "Submit a request"}
              </div>
              <div className="muted" style={{ fontSize: "0.82rem", marginTop: 2 }}>
                {selectedCatalog
                  ? selectedCatalog.description
                  : "Include as much detail as you can — screenshots and error messages help us resolve it faster."}
              </div>
            </div>
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

        {selectedCatalog ? (
          <div
            className="panel-2"
            style={{
              marginTop: 14,
              padding: "0.8rem 0.95rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div className="label" style={{ marginBottom: 4 }}>
                <LabelWithHint info={HINTS.fulfilmentDetails} side="right">
                  Fulfilment details
                </LabelWithHint>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span
                  className="badge"
                  style={{
                    background: "var(--brand-50)",
                    color: "var(--brand-700)",
                    borderColor: "var(--brand-100)",
                  }}
                >
                  {selectedCatalog.category}
                </span>
                {selectedCatalog.requiresApproval ? (
                  <span
                    className="badge"
                    style={{
                      background: "var(--warning-bg)",
                      color: "var(--warning-fg)",
                      borderColor: "var(--warning-border)",
                    }}
                  >
                    <WarnMini /> Approval required
                    <InfoHint text={HINTS.needsApproval} side="bottom" size={11} />
                  </span>
                ) : (
                  <span
                    className="badge"
                    style={{
                      background: "var(--success-bg)",
                      color: "var(--success-fg)",
                      borderColor: "var(--success-border)",
                    }}
                  >
                    No approval needed
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={onClearCatalog}
              aria-label="Remove catalog selection"
              className="btn btn-ghost"
              style={{ fontSize: "0.74rem", padding: "0.3rem 0.6rem", flexShrink: 0 }}
            >
              <CloseIcon size={12} /> <span style={{ marginLeft: 4 }}>Clear</span>
            </button>
          </div>
        ) : null}

        {created ? (
          <div
            className="anim-scale-in"
            style={{
              marginTop: 12,
              padding: "0.75rem 0.9rem",
              background: "var(--success-bg)",
              color: "var(--success-fg)",
              border: "1px solid var(--success-border)",
              borderRadius: 10,
              fontSize: "0.85rem",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <CheckCircleIcon />
            <span>
              Request <strong>{created.reference}</strong> created — you can close this dialog.
            </span>
          </div>
        ) : null}

        <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
          <div>
            <label className="label" htmlFor="portal-email" style={{ marginBottom: 4 }}>
              Your email
            </label>
            <input
              id="portal-email"
              className="input"
              type="email"
              placeholder="you@company.com"
              value={email}
              disabled={emailLocked}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="portal-subject" style={{ marginBottom: 4 }}>
              Subject
            </label>
            <input
              id="portal-subject"
              className="input"
              placeholder="Briefly summarise the issue"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label className="label" htmlFor="portal-body" style={{ marginBottom: 4 }}>
              Describe your issue
            </label>
            <textarea
              id="portal-body"
              className="textarea"
              rows={6}
              placeholder="What are you trying to do? What did you expect vs. what happened?"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 16,
          }}
        >
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={onSubmit}
            disabled={busy || !subject.trim() || !body.trim()}
          >
            {busy ? "Submitting…" : "Submit request"}
          </button>
        </div>
      </div>

      <style jsx>{`
        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  );
}

function FilterChip(props: {
  active: boolean;
  onClick: () => void;
  icon: ReactElement;
  label: string;
  count: number;
}) {
  const { active, onClick, icon, label, count } = props;
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
      {icon}
      <span>{label}</span>
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

function CategoryTile({ category }: { category: TicketCategory }) {
  const { bg, fg } = CATEGORY_STYLE[category];
  return (
    <div
      aria-hidden
      style={{
        width: 40,
        height: 40,
        borderRadius: 10,
        background: bg,
        color: fg,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <CategoryGlyph category={category} size={20} />
    </div>
  );
}

/* ==============================================================
   Icons and category styling
   ============================================================== */

const CATEGORY_STYLE: Record<TicketCategory, { bg: string; fg: string }> = {
  IT: { bg: "var(--info-bg)", fg: "var(--info-fg)" },
  Access: { bg: "var(--violet-bg)", fg: "var(--violet-fg)" },
  Software: { bg: "var(--success-bg)", fg: "var(--success-fg)" },
  Hardware: { bg: "var(--brand-50)", fg: "var(--brand-700)" },
  Network: { bg: "var(--info-bg)", fg: "var(--info-fg)" },
  HR: { bg: "var(--pink-bg)", fg: "var(--pink-fg)" },
  Billing: { bg: "var(--warning-bg)", fg: "var(--warning-fg)" },
  Other: { bg: "var(--surface-3)", fg: "var(--muted)" },
};

const chipStyle: CSSProperties = {
  padding: "0.42rem 0.9rem",
  borderRadius: 999,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text-secondary)",
  fontSize: "0.82rem",
  fontWeight: 600,
  cursor: "pointer",
  boxShadow: "var(--shadow-xs, 0 1px 2px rgba(15,23,42,0.04))",
};

const sectionTitle: CSSProperties = {
  fontSize: "1.05rem",
  fontWeight: 700,
  letterSpacing: "-0.015em",
  margin: 0,
};

/* Inline SVGs — keeps the bundle lean and lets us reuse CSS vars */

function SearchIcon() {
  return (
    <svg
      aria-hidden
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        position: "absolute",
        left: 14,
        top: "50%",
        transform: "translateY(-50%)",
        color: "var(--muted)",
        pointerEvents: "none",
      }}
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
      <path d="M22 4L12 14.01l-3-3" />
    </svg>
  );
}

function CloseIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function SparklesIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M16 16l2 2M6 18l2-2M16 8l2-2" />
    </svg>
  );
}

function WarnMini() {
  return (
    <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 9v4M12 17h.01" />
      <path d="M10.29 3.86l-8.14 14a2 2 0 001.71 3h16.28a2 2 0 001.71-3l-8.14-14a2 2 0 00-3.42 0z" />
    </svg>
  );
}

function CategoryGlyph({ category, size = 16 }: { category: TicketCategory; size?: number }) {
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
  switch (category) {
    case "IT":
      return (
        <svg {...p}>
          <rect x="3" y="4" width="18" height="12" rx="2" />
          <path d="M8 20h8M12 16v4" />
        </svg>
      );
    case "Access":
      return (
        <svg {...p}>
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 018 0v4" />
        </svg>
      );
    case "Software":
      return (
        <svg {...p}>
          <path d="M4 4h16v12H4z" />
          <path d="M2 20h20M9 16v4M15 16v4" />
        </svg>
      );
    case "Hardware":
      return (
        <svg {...p}>
          <rect x="6" y="6" width="12" height="12" rx="2" />
          <path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" />
        </svg>
      );
    case "Network":
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 000 20" />
        </svg>
      );
    case "HR":
      return (
        <svg {...p}>
          <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 00-3-3.87M17 3.13a4 4 0 010 7.75" />
        </svg>
      );
    case "Billing":
      return (
        <svg {...p}>
          <rect x="2" y="6" width="20" height="12" rx="2" />
          <path d="M2 10h20M6 15h4" />
        </svg>
      );
    default:
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9.5a2.5 2.5 0 015 0c0 1.5-2.5 2-2.5 3.5M12 17h.01" />
        </svg>
      );
  }
}
