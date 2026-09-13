"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";

import { joinCodeFromInput } from "@/lib/join-code";
import { fetchCurrentProfile } from "@/lib/student-client";
import type { StudentProfile } from "@/lib/types";

export function HomeLanding() {
  const router = useRouter();
  const [codeInput, setCodeInput] = useState("");
  const [error, setError] = useState("");
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [checkedProfile, setCheckedProfile] = useState(false);

  useEffect(() => {
    let active = true;
    fetchCurrentProfile().then((result) => {
      if (!active) return;
      setProfile(result);
      setCheckedProfile(true);
    });
    return () => {
      active = false;
    };
  }, []);

  function joinByCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = joinCodeFromInput(codeInput);
    if (!code) {
      setError("Bitte einen gültigen Vorlesungscode eingeben.");
      return;
    }
    setError("");
    router.push(`/join/${encodeURIComponent(code)}`);
  }

  return (
    <main className="home-app app-canvas lb-motion-root" aria-label="learnordie.app Start">
      <header className="home-canvas-brand lb-enter-row">
        <strong className="brand-word" aria-label="learnordie.app">
          learnordie<span className="brand-dot">.app</span>
        </strong>
      </header>

      <section className="join-card app-island home-join-island lb-enter-panel" aria-label="An Vorlesung teilnehmen">
        <h1>Vorlesung beitreten</h1>
        <p className="join-lead">Live dabei sein oder später in Ruhe lernen. Du brauchst kein Konto.</p>
        <form className="home-join-form" onSubmit={joinByCode}>
          <label>
            Vorlesungscode
            <input
              value={codeInput}
              onChange={(event) => setCodeInput(event.target.value)}
              placeholder="z. B. ME1-GL-2026"
              aria-label="Vorlesungscode"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
            />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button" type="submit">Runde starten</button>
        </form>
        <div className="home-island-links">
          {profile ? (
            <a className="plain-button" href="/student">Zum Dashboard</a>
          ) : (
            <a className="plain-button" href="/student">
              {checkedProfile ? "Dashboard öffnen" : "Profil prüfen …"}
            </a>
          )}
          <a className="plain-button" href="/lecturer/login">Dozentenlogin</a>
        </div>
      </section>
    </main>
  );
}
