"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { joinCodeFromInput } from "@/lib/join-code";
import { saveProfile } from "@/lib/student-client";
import { suggestPseudonyms } from "@/lib/student-pseudonym";
import { PseudonymChooser } from "./PseudonymChooser";

export function StudentOnboarding() {
  const router = useRouter();
  const [pseudonymInput, setPseudonymInput] = useState(() => suggestPseudonyms("student-onboarding")[0]);
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
    <main className="student-app lb-motion-root" aria-label="learnordie.app einrichten">
      <header className="student-head lb-enter-row">
        <Link className="student-brand" href="/">
          <span className="home-brand-mark" aria-hidden="true">
            <span className="brand-loop" />
            <span className="brand-north-dot" />
          </span>
          <strong className="brand-word" aria-label="learnordie.app">
            <span>lear</span><span className="brand-nord">nord</span><span>ie</span><span className="brand-dot">.app</span>
          </strong>
        </Link>
      </header>

      <section className="student-emptystate lb-enter-panel">
        <p className="eyebrow">Lernen im Norden</p>
        <h1>Wähle ein Pseudonym</h1>
        <p>Du brauchst kein Konto. Dein Pseudonym ist ein Anzeigename; deine Punkte hängen an einem anonymen Browser-Schlüssel.</p>
        <form className="student-onboard-form" onSubmit={submit}>
          <PseudonymChooser value={pseudonymInput} onChange={setPseudonymInput} seed="student-onboarding" disabled={busy} />
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
