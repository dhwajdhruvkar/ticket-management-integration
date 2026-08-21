"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";

// =============================================================================
// SignIn — split-screen entrance (client half).
//
// Left: brand panel with animated gradient, logo, headline, and feature bullets
// so the app feels like a proper product from the first frame.
// Right: focused CTA hierarchy. The server page passes which providers exist:
//   - ssoEnabled  -> "Sign in with Microsoft" (Entra ID)
//   - demoMode    -> passwordless email sign-in + demo persona cards
// In production mode with SSO unset, an operator notice explains what to
// configure instead of rendering buttons that would fail.
// =============================================================================

interface DemoUser {
  email: string;
  name: string;
  role: string;
  tint: "brand" | "info" | "warning" | "muted" | "violet" | "success";
}

const DEMO_USERS: DemoUser[] = [
  { email: "vikram.rao@netlink.com", name: "Vikram Rao", role: "Platform admin", tint: "violet" },
  { email: "priya.sharma@netlink.com", name: "Priya Sharma", role: "Tenant admin", tint: "brand" },
  { email: "meera.nair@netlink.com", name: "Meera Nair", role: "Manager", tint: "warning" },
  { email: "arjun.mehta@netlink.com", name: "Arjun Mehta", role: "Service desk agent", tint: "info" },
  { email: "anita.desai@netlink.com", name: "Anita Desai", role: "HR operations", tint: "success" },
  { email: "dana.lee@netlink.com", name: "Dana Lee", role: "Requester", tint: "muted" },
];

const FEATURES = [
  { title: "AI triage on every intake", body: "Auto-classification, RAG resolution, and safety guardrails." },
  { title: "ITIL-aligned workflows", body: "Incidents, requests, problems, changes, and CMDB in one place." },
  { title: "Live SLA & CSAT", body: "Staged escalation, at-risk warnings, and reporting out of the box." },
];

const TINT_CLASSES: Record<DemoUser["tint"], { bg: string; fg: string; border: string }> = {
  brand: { bg: "var(--brand-50)", fg: "var(--brand-700)", border: "var(--brand-100)" },
  info: { bg: "var(--info-bg)", fg: "var(--info-fg)", border: "var(--info-border)" },
  warning: { bg: "var(--warning-bg)", fg: "var(--warning-fg)", border: "var(--warning-border)" },
  muted: { bg: "var(--surface-3)", fg: "var(--text-secondary)", border: "var(--border)" },
  violet: { bg: "var(--violet-bg)", fg: "var(--violet-fg)", border: "var(--violet-border)" },
  success: { bg: "var(--success-bg)", fg: "var(--success-fg)", border: "var(--success-border)" },
};

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2);
}

function subheading(ssoEnabled: boolean, demoMode: boolean): string {
  if (ssoEnabled && demoMode) {
    return "Sign in with your Microsoft account, or pick a demo identity to explore the workspace.";
  }
  if (ssoEnabled) return "Sign in with your Microsoft work account to continue.";
  if (demoMode) return "Pick a demo identity to explore the workspace.";
  return "Authentication is required to continue.";
}

export default function SignInClient({
  ssoEnabled,
  demoMode,
}: {
  ssoEnabled: boolean;
  demoMode: boolean;
}) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function demoSignIn(value: string, key: string) {
    setBusy(key);
    try {
      await signIn("demo", { email: value, callbackUrl: "/" });
    } finally {
      setBusy(null);
    }
  }

  async function ssoSignIn() {
    setBusy("sso");
    try {
      await signIn("microsoft-entra-id", { callbackUrl: "/" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="signin-shell">
      {/* Brand panel */}
      <aside className="signin-brand" aria-hidden>
        <div className="signin-brand-orbs">
          <span className="orb orb-a" />
          <span className="orb orb-b" />
          <span className="orb orb-c" />
        </div>
        <div className="signin-brand-inner">
          <div className="signin-logo">
            <div className="signin-logo-mark">N</div>
            <div>
              <div className="signin-logo-name">Netlink Support</div>
              <div className="signin-logo-tag">Enterprise Service Desk</div>
            </div>
          </div>

          <h1 className="signin-headline">
            The AI service desk your{" "}
            <span className="signin-headline-em">team already knows how to use.</span>
          </h1>
          <p className="signin-lead">
            Omnichannel intake, guardrailed AI resolution, and full ITIL alignment — with
            no swivel-chair between tools.
          </p>

          <ul className="signin-features">
            {FEATURES.map((f) => (
              <li key={f.title}>
                <span className="signin-feature-dot" aria-hidden>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </span>
                <div>
                  <div className="signin-feature-title">{f.title}</div>
                  <div className="signin-feature-body">{f.body}</div>
                </div>
              </li>
            ))}
          </ul>

          <div className="signin-brand-footer">
            <span className="signin-status-dot" aria-hidden />
            All systems operational · SOC 2 · ISO 27001
          </div>
        </div>
      </aside>

      {/* Sign-in panel */}
      <main className="signin-main">
        <div className="signin-card anim-fade-up">
          <div className="signin-card-head">
            <h2 className="signin-card-title">Welcome back</h2>
            <p className="signin-card-sub">{subheading(ssoEnabled, demoMode)}</p>
          </div>

          {ssoEnabled ? (
            <button
              className="btn btn-primary signin-sso"
              onClick={() => void ssoSignIn()}
              disabled={busy === "sso"}
            >
              <MicrosoftLogo />
              <span style={{ marginLeft: 10 }}>
                {busy === "sso" ? "Redirecting…" : "Sign in with Microsoft"}
              </span>
            </button>
          ) : null}

          {!ssoEnabled && !demoMode ? (
            <div className="signin-note" role="alert">
              <strong>API-only deployment.</strong>
              <p>
                Browser sign-in is intentionally disabled while Microsoft Entra ID is
                deferred. Integrations can continue with API keys. To enable UI access
                later, configure{" "}
                <code>AUTH_MICROSOFT_ENTRA_ID_ID</code>,{" "}
                <code>AUTH_MICROSOFT_ENTRA_ID_SECRET</code> and{" "}
                <code>AUTH_MICROSOFT_ENTRA_ID_ISSUER</code>, then restart the server.
              </p>
            </div>
          ) : null}

          {demoMode ? (
            <>
              <div className="signin-divider">
                <span>{ssoEnabled ? "OR CONTINUE WITH EMAIL" : "CONTINUE WITH EMAIL"}</span>
              </div>

              <form
                className="signin-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (email.trim()) void demoSignIn(email.trim(), "email");
                }}
              >
                <label className="signin-label" htmlFor="signin-email">
                  Work email
                </label>
                <div className="signin-input-row">
                  <input
                    id="signin-email"
                    className="input"
                    type="email"
                    placeholder="you@netlink.com"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  <button
                    className="btn btn-ghost signin-input-cta"
                    type="submit"
                    disabled={!email.trim() || busy === "email"}
                  >
                    {busy === "email" ? "Signing in…" : "Continue"}
                    <ArrowRight />
                  </button>
                </div>
                <p className="signin-help">
                  Demo credentials — any seeded email works. In production, this is Entra ID
                  only.
                </p>
              </form>

              <div className="signin-divider signin-divider-alt">
                <span>QUICK DEMO IDENTITIES</span>
              </div>

              <div className="signin-personas stagger">
                {DEMO_USERS.map((u) => {
                  const tint = TINT_CLASSES[u.tint];
                  const key = u.email;
                  const loading = busy === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => void demoSignIn(u.email, key)}
                      disabled={busy !== null}
                      className="signin-persona hover-lift"
                    >
                      <span
                        className="signin-persona-avatar"
                        style={{ background: tint.bg, color: tint.fg, borderColor: tint.border }}
                      >
                        {initialsOf(u.name)}
                      </span>
                      <span className="signin-persona-body">
                        <span className="signin-persona-name">{u.name}</span>
                        <span className="signin-persona-role">{u.role}</span>
                      </span>
                      <span className="signin-persona-cta">
                        {loading ? "Signing in…" : <ArrowRight />}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}

          <p className="signin-legal">
            By signing in you agree to Netlink Support&apos;s{" "}
            <Link href="/legal/acceptable-use" className="signin-legal-link">
              Acceptable Use Policy
            </Link>{" "}
            and{" "}
            <Link href="/legal/privacy" className="signin-legal-link">
              Privacy Notice
            </Link>
            .
          </p>
        </div>
      </main>

      <style jsx>{`
        .signin-shell {
          min-height: 100vh;
          display: grid;
          grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
          background: var(--bg);
        }
        .signin-brand {
          position: relative;
          overflow: hidden;
          background: radial-gradient(120% 100% at 0% 0%, rgba(255, 255, 255, 0.08), transparent 55%),
            linear-gradient(155deg, #0b0b0d 0%, #0a3a86 50%, #0071e3 100%);
          color: #fff;
          display: flex;
          align-items: center;
          padding: clamp(2rem, 5vw, 4rem);
        }
        .signin-brand-orbs {
          position: absolute;
          inset: 0;
          pointer-events: none;
          overflow: hidden;
        }
        .signin-brand-orbs .orb {
          position: absolute;
          border-radius: 50%;
          filter: blur(60px);
          opacity: 0.7;
        }
        .signin-brand-orbs .orb-a {
          width: 320px;
          height: 320px;
          background: #60a5fa;
          top: -120px;
          right: -60px;
          animation: orb-float 14s var(--ease-in-out) infinite;
        }
        .signin-brand-orbs .orb-b {
          width: 260px;
          height: 260px;
          background: #a78bfa;
          bottom: -80px;
          left: 40px;
          opacity: 0.55;
          animation: orb-float 18s var(--ease-in-out) infinite reverse;
        }
        .signin-brand-orbs .orb-c {
          width: 200px;
          height: 200px;
          background: #93c5fd;
          top: 55%;
          right: 32%;
          opacity: 0.35;
          animation: orb-float 22s var(--ease-in-out) infinite;
        }
        @keyframes orb-float {
          0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
          50% { transform: translate3d(-24px, 32px, 0) scale(1.08); }
        }
        .signin-brand-inner {
          position: relative;
          z-index: 1;
          max-width: 520px;
          animation: fade-up var(--dur-3) var(--ease-out) both;
        }
        .signin-logo {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 44px;
        }
        .signin-logo-mark {
          width: 44px;
          height: 44px;
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.14);
          border: 1px solid rgba(255, 255, 255, 0.25);
          display: grid;
          place-items: center;
          font-weight: 800;
          font-size: 1.15rem;
          letter-spacing: -0.02em;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.25);
        }
        .signin-logo-name {
          font-weight: 700;
          font-size: 1rem;
          letter-spacing: -0.01em;
        }
        .signin-logo-tag {
          font-size: 0.72rem;
          opacity: 0.75;
          margin-top: 2px;
          letter-spacing: 0.02em;
        }
        .signin-headline {
          font-size: clamp(1.85rem, 3.2vw, 2.6rem);
          font-weight: 800;
          letter-spacing: -0.03em;
          line-height: 1.1;
          margin: 0 0 18px;
        }
        .signin-headline-em {
          background: linear-gradient(120deg, #ffffff 0%, #c7d2fe 100%);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
        }
        .signin-lead {
          font-size: 1.02rem;
          line-height: 1.55;
          opacity: 0.85;
          margin: 0 0 34px;
          max-width: 480px;
        }
        .signin-features {
          list-style: none;
          padding: 0;
          margin: 0 0 44px;
          display: flex;
          flex-direction: column;
          gap: 18px;
        }
        .signin-features li {
          display: flex;
          gap: 14px;
          align-items: flex-start;
        }
        .signin-feature-dot {
          width: 26px;
          height: 26px;
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.15);
          border: 1px solid rgba(255, 255, 255, 0.28);
          display: inline-grid;
          place-items: center;
          flex-shrink: 0;
          color: #ffffff;
        }
        .signin-feature-title {
          font-weight: 600;
          font-size: 0.95rem;
        }
        .signin-feature-body {
          font-size: 0.82rem;
          opacity: 0.75;
          line-height: 1.5;
          margin-top: 2px;
        }
        .signin-brand-footer {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 0.75rem;
          opacity: 0.7;
          letter-spacing: 0.02em;
        }
        .signin-status-dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: var(--success-solid);
          box-shadow: 0 0 0 3px rgba(52, 211, 153, 0.22);
          animation: pulse-live 2.4s var(--ease-in-out) infinite;
          display: inline-block;
        }
        @keyframes pulse-live {
          0%, 100% { opacity: 0.85; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.2); }
        }

        .signin-main {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: clamp(1.5rem, 5vw, 3rem);
        }
        .signin-card {
          width: 100%;
          max-width: 440px;
          padding: clamp(1.4rem, 3vw, 2rem);
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 20px;
          box-shadow: var(--shadow-lg);
        }
        .signin-card-head {
          margin-bottom: 22px;
        }
        .signin-card-title {
          font-size: 1.4rem;
          font-weight: 800;
          letter-spacing: -0.025em;
          margin: 0;
        }
        .signin-card-sub {
          color: var(--muted);
          font-size: 0.87rem;
          margin: 6px 0 0;
          line-height: 1.5;
        }
        .signin-sso {
          width: 100%;
          height: 44px;
          font-weight: 600;
          font-size: 0.9rem;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .signin-note {
          border: 1px solid var(--warning-border);
          background: var(--warning-bg);
          color: var(--warning-fg);
          border-radius: 12px;
          padding: 0.85rem 1rem;
          font-size: 0.85rem;
          line-height: 1.55;
        }
        .signin-note p {
          margin: 6px 0 0;
        }
        .signin-note code {
          font-size: 0.78rem;
          background: rgba(0, 0, 0, 0.06);
          padding: 1px 4px;
          border-radius: 4px;
        }
        .signin-divider {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 22px 0 16px;
        }
        .signin-divider::before,
        .signin-divider::after {
          content: "";
          flex: 1;
          height: 1px;
          background: var(--border);
        }
        .signin-divider span {
          font-size: 0.68rem;
          font-weight: 700;
          letter-spacing: 0.14em;
          color: var(--muted);
          padding: 0 12px;
        }
        .signin-divider-alt {
          margin: 24px 0 12px;
        }

        .signin-form {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .signin-label {
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .signin-input-row {
          display: flex;
          gap: 8px;
        }
        .signin-input-row .input {
          flex: 1;
          height: 40px;
        }
        .signin-input-cta {
          height: 40px;
          padding: 0 12px;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 0.85rem;
        }
        .signin-help {
          font-size: 0.72rem;
          color: var(--muted);
          margin: 4px 0 0;
        }

        .signin-personas {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }
        .signin-persona {
          display: grid;
          grid-template-columns: 36px 1fr auto;
          align-items: center;
          gap: 10px;
          padding: 0.6rem 0.7rem;
          border-radius: 12px;
          border: 1px solid var(--border);
          background: var(--surface);
          cursor: pointer;
          text-align: left;
          transition:
            border-color var(--dur-2) var(--ease),
            background var(--dur-2) var(--ease),
            transform var(--dur-2) var(--ease-out),
            box-shadow var(--dur-2) var(--ease);
          box-shadow: var(--shadow-sm);
        }
        .signin-persona:hover:not(:disabled) {
          border-color: var(--brand-300);
          background: var(--brand-50);
          box-shadow: var(--shadow-md);
        }
        .signin-persona:disabled {
          opacity: 0.6;
          cursor: default;
        }
        .signin-persona-avatar {
          width: 36px;
          height: 36px;
          border-radius: 10px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-weight: 800;
          font-size: 0.85rem;
          letter-spacing: -0.02em;
          border: 1px solid transparent;
        }
        .signin-persona-body {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        .signin-persona-name {
          font-weight: 600;
          font-size: 0.85rem;
          color: var(--text);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .signin-persona-role {
          font-size: 0.7rem;
          color: var(--muted);
          margin-top: 2px;
        }
        .signin-persona-cta {
          color: var(--muted);
          display: inline-flex;
          align-items: center;
          font-size: 0.72rem;
        }
        .signin-persona:hover:not(:disabled) .signin-persona-cta {
          color: var(--brand-600);
        }

        .signin-legal {
          font-size: 0.72rem;
          color: var(--muted);
          margin: 22px 0 0;
          text-align: center;
          line-height: 1.5;
        }
        .signin-legal-link {
          color: var(--brand-600);
          text-decoration: none;
        }
        .signin-legal-link:hover {
          text-decoration: underline;
        }

        @media (max-width: 960px) {
          .signin-shell {
            grid-template-columns: 1fr;
          }
          .signin-brand {
            display: none;
          }
          .signin-main {
            padding: 1.5rem 1rem;
          }
        }
        @media (max-width: 520px) {
          .signin-personas {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}

/* ---------- inline icons ---------- */

function MicrosoftLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <path fill="#F25022" d="M2 2h9.4v9.4H2z" />
      <path fill="#7FBA00" d="M12.6 2H22v9.4h-9.4z" />
      <path fill="#00A4EF" d="M2 12.6h9.4V22H2z" />
      <path fill="#FFB900" d="M12.6 12.6H22V22h-9.4z" />
    </svg>
  );
}

function ArrowRight() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  );
}
