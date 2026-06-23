"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { joinCodeFromInput } from "@/lib/join-code";
import { saveProfile } from "@/lib/student-client";

export function StudentOnboarding() {
  const router = useRouter();
  const [pseudonymInput, setPseudonymInput] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const pseudonym = pseudonymInput.trim();
    if (!pseudonym) {
      setError("Bitte ein Pseudonym wählen.");
      return;
    }
    setBusy(true);
    setError("");
    const profile = await saveProfile(pseudonym);
    if (!profile) {
      setError("Profil konnte nicht gespeichert werden.");
      setBusy(false);
      return;
    }
    const code = joinCodeFromInput(codeInput);
    if (code) {
      router.push(`/join/${encodeURIComponent(code)}`);
      return;
    }
    router.refresh();
  }

  return (
    <main className="student-app lb-motion-root" aria-label="LearnBuddy einrichten">
      <header className="student-head lb-enter-row">
        <Link className="student-brand" href="/">
          <span className="home-brand-mark" aria-hidden="true">LB</span>
          <strong>LearnBuddy</strong>
        </Link>
      </header>

      <section className="student-emptystate lb-enter-panel">
        <p className="eyebrow">Willkommen</p>
        <h1>Wähle ein Pseudonym</h1>
        <p>Du brauchst kein Konto. Wähle ein Pseudonym — bitte keinen Klarnamen — und du kannst sofort loslegen.</p>
        <form className="student-onboard-form" onSubmit={submit}>
          <label>
            Pseudonym
            <input
              value={pseudonymInput}
              onChange={(event) => setPseudonymInput(event.target.value)}
              placeholder="z. B. Zahnrad-Zoe"
              autoComplete="off"
              maxLength={80}
              disabled={busy}
            />
          </label>
          <label>
            Vorlesungscode (optional)
            <input
              value={codeInput}
              onChange={(event) => setCodeInput(event.target.value)}
              placeholder="z. B. ME1-GL-2026"
              autoComplete="off"
              autoCapitalize="characters"
              disabled={busy}
            />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? "Wird gespeichert …" : "Loslegen"}
          </button>
        </form>
      </section>
    </main>
  );
}
