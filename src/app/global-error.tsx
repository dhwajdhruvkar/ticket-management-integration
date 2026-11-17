"use client";

// Last-resort boundary: it replaces the root layout, so it renders its own
// <html> and <body> and cannot rely on providers or on app styles being loaded.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#0b1220", color: "#e6edf7" }}>
        <main style={{ maxWidth: 480, margin: "15vh auto 0", padding: "0 1rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.25rem", margin: "0 0 8px" }}>Something went wrong</h1>
          <p style={{ margin: "0 0 16px", fontSize: "0.9rem", opacity: 0.8 }}>
            The page failed to load. You can try again{error.digest ? ` (reference ${error.digest})` : ""}.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{ padding: "0.55rem 1.1rem", borderRadius: 8, border: "none", background: "#3b82f6", color: "#fff", fontWeight: 600, cursor: "pointer" }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
