"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

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
    <main className="home-app lb-motion-root" aria-label="LearnBuddy Start">
      <section className="home-app-stage lb-enter-stage">
        <header className="home-app-head lb-enter-row">
          <span className="home-brand-mark" aria-hidden="true">LB</span>
          <strong>LearnBuddy</strong>
        </header>

        <div className="home-app-grid">
          <section className="home-workspace primary lb-enter-panel" aria-label="An Vorlesung teilnehmen">
            <div>
              <p className="eyebrow">Studierende</p>
              <h1>An Vorlesung teilnehmen</h1>
              <p>Gib den Code aus deiner Vorlesung ein. Du brauchst kein Konto — ein Pseudonym genügt.</p>
            </div>
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
              <button className="primary-button" type="submit">Beitreten</button>
            </form>
          </section>

          <div className="home-side-column">
            <section className="home-workspace secondary lb-enter-panel" aria-label="Meine Vorlesungen">
              {profile ? (
                <>
                  <div>
                    <p className="eyebrow">Angemeldet als {profile.pseudonym}</p>
                    <h2>Meine Vorlesungen</h2>
                    <p>Dein Dashboard mit Live-Terminen, Lernmodus und Prüfungsvorbereitung.</p>
                  </div>
                  <div className="home-lecturer-actions">
                    <a className="primary-button" href="/student">Zum Dashboard</a>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <p className="eyebrow">Meine Vorlesungen</p>
                    <h2>Dein Lernstand</h2>
                    <p>
                      {checkedProfile
                        ? "Sobald du einer Vorlesung beigetreten bist, erscheint hier dein persönliches Dashboard."
                        : "Lade dein Profil …"}
                    </p>
                  </div>
                  <div className="home-lecturer-actions">
                    <a className="plain-button" href="/student">Dashboard öffnen</a>
                  </div>
                </>
              )}
            </section>

            <section className="home-workspace tertiary lb-enter-panel" aria-label="Dozentenbereich">
              <div>
                <p className="eyebrow">Dozierende</p>
                <h2>Vorlesungen erstellen</h2>
                <p>Reihe planen, Code teilen, Live steuern und Lernmodus freigeben.</p>
              </div>
              <div className="home-lecturer-actions">
                <a className="plain-button" href="/lecturer">Dozentenlogin</a>
              </div>
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}
