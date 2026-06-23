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
  const [email, setEmail] = useState("referent@example.com");
  const [magicLink, setMagicLink] = useState(initialMagicLink);
  const [sentWithoutLocalLink, setSentWithoutLocalLink] = useState(sent && !initialMagicLink);
  const [error, setError] = useState(initialError);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMagicLink("");
    setSentWithoutLocalLink(false);
    const response = await fetch("/api/auth/magic-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email })
    });
    const payload = (await response.json()) as { sent?: boolean; magicLink?: string; error?: string };
    if (!response.ok || !payload.sent) {
      setError(payload.error ?? "Magic Link konnte nicht erstellt werden.");
      return;
    }
    if (payload.magicLink) {
      setMagicLink(payload.magicLink);
      return;
    }
    setSentWithoutLocalLink(true);
  }

  return (
    <form action="/auth/request-magic" className="login-form" method="post" onSubmit={submit}>
      <input
        name="email"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        aria-label="E-Mail"
        suppressHydrationWarning
      />
      <button className="primary-button" type="submit">Magic Link senden</button>
      {error && <p role="alert">{error}</p>}
      {sentWithoutLocalLink && <p>Magic Link wurde versendet. Bitte Postfach prüfen.</p>}
      {magicLink && (
        <p>
          Lokaler Testlink: <a href={magicLink}>Referentenbereich öffnen</a>
        </p>
      )}
    </form>
  );
}
