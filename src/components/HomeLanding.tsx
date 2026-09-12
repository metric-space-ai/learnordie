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
        <span className="home-brand-mark" aria-hidden="true">
          <span className="brand-loop" />
          <span className="brand-north-dot" />
        </span>
        <strong className="brand-word" aria-label="learnordie.app">
          <span>lear</span><span className="brand-nord">nord</span><span>ie</span><span className="brand-dot">.app</span>
        </strong>
      </header>

      <section className="join-card app-island home-join-island lb-enter-panel" aria-label="An Vorlesung teilnehmen">
        <p className="eyebrow">Studierende</p>
        <h1>Vorlesungscode rein, Lernrunde starten</h1>
        <p className="join-lead">Ein Code reicht. Der Anzeigename gilt nur in dieser Vorlesung.</p>
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
