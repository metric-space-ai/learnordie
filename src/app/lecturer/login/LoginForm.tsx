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
      setError("Anmeldelink konnte nicht erstellt werden. Bitte erneut versuchen.");
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
      <button className="primary-button" type="submit" disabled={pending}>
        {pending ? "Anmeldelink wird gesendet ..." : "Anmeldelink senden"}
      </button>
      <p className="login-support">
        Noch kein Konto? Kein separates Registrierungsformular nötig. Der bestätigte Link
        richtet deinen Dozentenbereich ein.
      </p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {sentWithoutLocalLink && <p className="form-success">Anmeldelink ist unterwegs. Bitte Postfach prüfen.</p>}
      {magicLink && (
        <p className="login-dev-link">
          Entwicklungsmodus: <a href={magicLink}>Direkt zum Dozentenbereich</a>
        </p>
      )}
    </form>
  );
}
