import Link from "next/link";

// =============================================================================
// Shared chrome for the public policy pages (/legal/*).
//
// These render outside AppShell and outside the auth middleware, because the
// sign-in screen links to them: someone has to be able to read the terms before
// they agree to them.
// =============================================================================

export interface LegalSection {
  heading: string;
  paragraphs: string[];
  bullets?: string[];
}

export default function LegalPage({
  title,
  updated,
  intro,
  sections,
  contact,
}: {
  title: string;
  updated: string;
  intro: string;
  sections: LegalSection[];
  contact: string;
}) {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", padding: "clamp(1.5rem, 5vw, 3.5rem) 1.25rem" }}>
      <article style={{ maxWidth: 760, margin: "0 auto" }}>
        <Link href="/signin" className="chip-link" style={{ fontSize: "0.82rem", fontWeight: 600 }}>
          ← Back to sign in
        </Link>

        <header style={{ margin: "1.4rem 0 1.8rem" }}>
          <h1
            style={{
              fontSize: "clamp(1.6rem, 3.2vw, 2.1rem)",
              fontWeight: 800,
              letterSpacing: "-0.03em",
              margin: 0,
            }}
          >
            {title}
          </h1>
          <p className="muted" style={{ fontSize: "0.82rem", margin: "6px 0 0" }}>
            Netlink Software Group America · Last updated {updated}
          </p>
          <p style={{ fontSize: "0.95rem", lineHeight: 1.7, color: "var(--text-secondary)", marginTop: 16 }}>
            {intro}
          </p>
        </header>

        {sections.map((section) => (
          <section key={section.heading} style={{ marginBottom: "1.6rem" }}>
            <h2 style={{ fontSize: "1.02rem", fontWeight: 750, letterSpacing: "-0.01em", margin: "0 0 8px" }}>
              {section.heading}
            </h2>
            {section.paragraphs.map((p) => (
              <p
                key={p.slice(0, 40)}
                style={{ fontSize: "0.92rem", lineHeight: 1.75, color: "var(--text-secondary)", margin: "0 0 10px" }}
              >
                {p}
              </p>
            ))}
            {section.bullets ? (
              <ul
                style={{
                  margin: "0 0 4px",
                  paddingLeft: "1.15rem",
                  fontSize: "0.92rem",
                  lineHeight: 1.75,
                  color: "var(--text-secondary)",
                }}
              >
                {section.bullets.map((b) => (
                  <li key={b.slice(0, 40)} style={{ marginBottom: 4 }}>
                    {b}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}

        <footer
          className="panel"
          style={{ padding: "1rem 1.15rem", marginTop: "2rem", fontSize: "0.88rem", lineHeight: 1.7 }}
        >
          {contact}
        </footer>
      </article>
    </div>
  );
}
