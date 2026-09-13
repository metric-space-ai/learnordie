"use client";

import type { FormEvent } from "react";
import { useState } from "react";

type Step = "email" | "code";

export function LoginForm({
  initialMagicLink = "",
  sent = false,
  initialError = ""
}: {
  initialMagicLink?: string;
  sent?: boolean;
  initialError?: string;
}) {
  const [step, setStep] = useState<Step>(sent ? "code" : "email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [devLink, setDevLink] = useState(initialMagicLink);
  const [error, setError] = useState(initialError);
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);

  async function requestCode(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setError("");
    setNotice("");
    setPending(true);
    try {
      const response = await fetch("/api/auth/magic-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email })
      });
      const payload = (await response.json().catch(() => ({}))) as { sent?: boolean; magicLink?: string; code?: string; error?: string };
      if (!response.ok || !payload.sent) {
        setError(payload.error ?? "Code konnte nicht gesendet werden.");
        return;
      }
      setDevLink(payload.magicLink ?? "");
      setCode("");
      setStep("code");
      setNotice(payload.code ? `Entwicklungsmodus: Code ${payload.code}` : "");
    } catch {
      setError("Keine Verbindung. Bitte erneut versuchen.");
    } finally {
      setPending(false);
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const response = await fetch("/api/auth/verify-code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, code: code.replace(/\s+/g, "") })
      });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        setError(payload.error ?? "Code falsch oder abgelaufen.");
        return;
      }
      window.location.assign("/lecturer");
    } catch {
      setError("Keine Verbindung. Bitte erneut versuchen.");
    } finally {
      setPending(false);
    }
  }

  if (step === "code") {
    return (
      <form className="login-form" onSubmit={verifyCode}>
        <p className="login-flow-note">Code an {email || "deine E-Mail"} gesendet.</p>
        <label className="login-field">
          <span>Code</span>
          <input
            name="code"
            className="login-code-input"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            aria-describedby="login-code-hint"
            aria-invalid={Boolean(error)}
            autoFocus
            required
          />
        </label>
        <p id="login-code-hint" className="join-hint">Den sechsstelligen Code aus deiner E-Mail eingeben.</p>
        <button className="primary-button" type="submit" disabled={pending || code.length !== 6}>
          {pending ? "Prüft …" : "Anmelden"}
        </button>
        {error && <p className="form-error" role="alert">{error}</p>}
        {notice && <p className="form-success" role="status">{notice}</p>}
        <p className="login-support">
          <button className="plain-button" type="button" disabled={pending} onClick={() => requestCode()}>Neuen Code senden</button>
          <button className="plain-button" type="button" onClick={() => { setStep("email"); setError(""); setNotice(""); }}>Andere E-Mail</button>
        </p>
        {devLink && (
          <p className="login-dev-link">
            Entwicklungsmodus: <a href={devLink}>Direkt zum Dozentenbereich</a>
          </p>
        )}
      </form>
    );
  }

  return (
    <form action="/auth/request-magic" className="login-form" method="post" onSubmit={requestCode}>
      <label className="login-field">
        <span>E-Mail</span>
        <input
          name="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          required
          suppressHydrationWarning
        />
      </label>
      <button className="primary-button" type="submit" disabled={pending}>
        {pending ? "Sendet …" : "Code senden"}
      </button>
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  );
}
