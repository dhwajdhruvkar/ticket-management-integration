"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface SetupResult {
  organizationCode: string;
  email: string;
}

export default function SetupAccountClient() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SetupResult | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    setToken(params.get("token") ?? "");
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!token) {
      setError("This setup link is invalid or expired.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/account/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ token, password }),
      });
      const json = (await response.json()) as {
        ok?: boolean;
        data?: SetupResult;
        error?: string;
      };
      if (!response.ok || !json.ok || !json.data) {
        throw new Error(json.error || "Could not set up the account.");
      }
      setToken("");
      setPassword("");
      setConfirmPassword("");
      setResult(json.data);
    } catch (setupError) {
      setError(
        setupError instanceof Error
          ? setupError.message
          : "Could not set up the account."
      );
    } finally {
      setBusy(false);
    }
  }

  const signInHref = result
    ? "/signin?organization=" +
      encodeURIComponent(result.organizationCode) +
      "&email=" +
      encodeURIComponent(result.email) +
      "&setup=1"
    : "/signin";

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 20,
        background:
          "radial-gradient(circle at top left, rgba(0,113,227,.16), transparent 42%), var(--bg)",
      }}
    >
      <section
        className="panel anim-scale-in"
        style={{ width: "100%", maxWidth: 460, padding: "1.5rem" }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            display: "grid",
            placeItems: "center",
            background: "var(--brand-600)",
            color: "#fff",
            fontWeight: 800,
            marginBottom: 16,
          }}
        >
          N
        </div>
        <h1 style={{ margin: 0, fontSize: "1.4rem" }}>
          {result ? "Account ready" : "Set up your account"}
        </h1>
        <p className="muted" style={{ lineHeight: 1.55, fontSize: "0.86rem" }}>
          {result
            ? "Your password has been saved. Use your organization code, email, and new password to sign in."
            : "Choose a password of 12–128 characters. This link can be used only once."}
        </p>

        {result ? (
          <div style={{ display: "grid", gap: 10 }}>
            <div className="panel-2" style={{ padding: "0.8rem" }}>
              <div className="label">Organization code</div>
              <code className="mono">{result.organizationCode}</code>
              <div className="label" style={{ marginTop: 10 }}>Email</div>
              <div>{result.email}</div>
            </div>
            <Link href={signInHref} className="btn btn-primary" style={{ justifyContent: "center" }}>
              Continue to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
            <label className="label" style={{ display: "grid", gap: 6 }}>
              New password
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            <label className="label" style={{ display: "grid", gap: 6 }}>
              Confirm password
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
              />
            </label>
            {error ? (
              <div
                role="alert"
                style={{
                  border: "1px solid var(--danger-border)",
                  background: "var(--danger-bg)",
                  color: "var(--danger-fg)",
                  borderRadius: 10,
                  padding: "0.65rem 0.75rem",
                  fontSize: "0.8rem",
                }}
              >
                {error}
              </div>
            ) : null}
            <button
              className="btn btn-primary"
              type="submit"
              disabled={busy || !password || !confirmPassword}
            >
              {busy ? "Saving…" : "Set password"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
