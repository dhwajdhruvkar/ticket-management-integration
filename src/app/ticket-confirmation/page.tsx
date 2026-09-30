"use client";
import { useEffect, useState } from "react";

export default function TicketConfirmationPage() {
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
    setToken(value);
    // Keep the capability out of browser history and referer/navigation URLs.
    window.history.replaceState(null, "", window.location.pathname);
    if (!value) setMessage("Open the confirmation link from your resolution email.");
  }, []);
  async function respond(action: "confirm" | "reopen") {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/account/ticket-confirmation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, action }), referrerPolicy: "no-referrer" });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error ?? "Could not record your response.");
      setMessage(result.data.message); setToken(""); setFinished(true);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not record your response."); }
    finally { setBusy(false); }
  }
  return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
    <section className="panel" style={{ maxWidth: 560, padding: 32 }} aria-labelledby="confirmation-title">
      <h1 id="confirmation-title">Was your issue resolved?</h1>
      <p>Your service desk marked the ticket as resolved. Confirm the fix, or reopen it if you still need help. Opening this page does not change the ticket.</p>
      {!finished && <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 24 }}>
        <button className="btn btn-primary" disabled={!token || busy} onClick={() => void respond("confirm")}>Yes, confirm resolution</button>
        <button className="btn" disabled={!token || busy} onClick={() => void respond("reopen")}>Not fixed — reopen ticket</button>
      </div>}
      {message && <p role="status" style={{ marginTop: 20 }}>{message}</p>}
    </section>
  </main>;
}
