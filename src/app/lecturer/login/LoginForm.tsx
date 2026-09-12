"use client";

import type { FormEvent } from "react";
import { useState } from "react";

export function LoginForm({
  initialMagicLink = "",
  sent = false,
  initialError = ""
}: {
  initialMagicLink?: string;
  sent?: boolean;
  initialError?: string;
}) {
  const [email, setEmail] = useState("");
  const [magicLink, setMagicLink] = useState(initialMagicLink);
  const [sentWithoutLocalLink, setSentWithoutLocalLink] = useState(sent && !initialMagicLink);
  const [error, setError] = useState(initialError);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMagicLink("");
    setSentWithoutLocalLink(false);
    setPending(true);

    try {
      const response = await fetch("/api/auth/magic-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email })
      });
      const payload = (await response.json()) as { sent?: boolean; magicLink?: string; error?: string };
      if (!response.ok || !payload.sent) {
        setError(payload.error ?? "Anmeldelink konnte nicht erstellt werden.");
        return;
      }
      if (payload.magicLink) {
        setMagicLink(payload.magicLink);
        return;
      }
      setSentWithoutLocalLink(true);
    } catch {
      setError("Netzwerkfehler. Die E-Mail bleibt stehen — bitte erneut versuchen.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form action="/auth/request-magic" className="login-form" method="post" onSubmit={submit}>
      <label className="login-field">
        <span>Dienstliche E-Mail</span>
        <input
          name="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="name@hochschule.de"
          autoComplete="email"
          required
          suppressHydrationWarning
        />
      </label>
      <p className="login-flow-note">
        Neu hier? Derselbe Link legt das Konto an. Bestehende Konten werden damit angemeldet.
      </p>
      <button className="primary-button" type="submit" disabled={pending}>
        {pending ? "Link wird gesendet …" : "Anmeldelink senden"}
      </button>
      <p className="login-support">
        Der Link ist 15 Minuten gültig. Nach der Bestätigung öffnet sich dein Dozentenbereich.
      </p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {sentWithoutLocalLink && (
        <p className="form-success">
          Link ist unterwegs. Wenn diese E-Mail noch nicht registriert ist, wird dein Konto beim Öffnen des Links angelegt.
        </p>
      )}
      {magicLink && (
        <p className="login-dev-link">
          Entwicklungsmodus: <a href={magicLink}>Direkt zum Dozentenbereich</a>
        </p>
      )}
    </form>
  );
}
