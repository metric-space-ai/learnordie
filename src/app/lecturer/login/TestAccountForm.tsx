"use client";

import { useState, type FormEvent } from "react";

export function TestAccountForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/test-login", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) { setError(data.error ?? "Anmeldung fehlgeschlagen."); return; }
      window.location.assign("/lecturer");
    } catch {
      setError("Keine Verbindung. Bitte erneut versuchen.");
    } finally {
      setBusy(false);
    }
  }

  return <details className="test-account-login">
    <summary>Mit Testkonto anmelden</summary>
    <form className="login-form" onSubmit={submit}>
      <label className="login-field">Testkonto E-Mail
        <input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      <label className="login-field">Testkonto Passwort
        <input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
      </label>
      {error && <p role="alert" className="form-error">{error}</p>}
      <button className="primary-button" disabled={busy} type="submit">{busy ? "Prüft …" : "Testkonto öffnen"}</button>
    </form>
  </details>;
}
