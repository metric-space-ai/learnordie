"use client";

import { useRouter } from "next/navigation";
import type { FormEvent, MouseEvent } from "react";
import { useEffect, useRef, useState } from "react";

import { joinCodeFromInput } from "@/lib/join-code";
import { prefersReducedMotion } from "@/lib/motion";
import { fetchCurrentProfile } from "@/lib/student-client";
import type { StudentProfile } from "@/lib/types";

type HomeRouteTarget = "join" | "student" | "lecturer";

export function HomeLanding() {
  const router = useRouter();
  const [codeInput, setCodeInput] = useState("");
  const [error, setError] = useState("");
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [routeCover, setRouteCover] = useState<HomeRouteTarget | null>(null);
  const routeTimeout = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    fetchCurrentProfile().then((result) => {
      if (!active) return;
      setProfile(result);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => () => {
    if (routeTimeout.current !== null) {
      window.clearTimeout(routeTimeout.current);
    }
  }, []);

  function navigateWithCover(href: string, target: HomeRouteTarget) {
    if (routeTimeout.current !== null) {
      window.clearTimeout(routeTimeout.current);
    }

    if (prefersReducedMotion()) {
      router.push(href);
      return;
    }

    setRouteCover(target);
    routeTimeout.current = window.setTimeout(() => {
      router.push(href);
    }, 560);
  }

  function followWithCover(event: MouseEvent<HTMLAnchorElement>, href: string, target: HomeRouteTarget) {
    event.preventDefault();
    navigateWithCover(href, target);
  }

  function joinByCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = joinCodeFromInput(codeInput);
    if (!code) {
      setError("Bitte einen gültigen Vorlesungscode eingeben.");
      return;
    }
    setError("");
    navigateWithCover(`/join/${encodeURIComponent(code)}`, "join");
  }

  return (
    <main className="home-app lb-motion-root" data-route-cover={routeCover ? "active" : "idle"} aria-label="learnordie.app Start">
      <section className="home-app-stage lb-enter-stage">
        <header className="home-app-head lb-enter-row">
          <span className="home-brand-mark" aria-hidden="true">
            <span className="brand-loop" />
            <span className="brand-north-dot" />
          </span>
          <strong className="brand-word" aria-label="learnordie.app">
            <span>lear</span><span className="brand-nord">nord</span><span>ie</span><span className="brand-dot">.app</span>
          </strong>
          <nav className="home-head-actions" aria-label="Bereiche">
            {profile && (
              <a className="primary-button" href="/student" onClick={(event) => followWithCover(event, "/student", "student")}>Meine Vorlesungen</a>
            )}
            <a className="home-lecturer-link" href="/lecturer" onClick={(event) => followWithCover(event, "/lecturer", "lecturer")}>Für Dozierende</a>
          </nav>
        </header>

        <div className="home-app-grid">
          <section className="home-workspace primary lb-enter-panel" aria-label="An Vorlesung teilnehmen">
            <h1>Vorlesung beitreten</h1>
            <form className="home-join-form" onSubmit={joinByCode}>
              <label>
                Vorlesungscode
                <input
                  value={codeInput}
                  onChange={(event) => setCodeInput(event.target.value)}
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

        </div>
        <span className="home-route-cover lb-route-cover" data-route={routeCover ?? undefined} aria-hidden="true" />
      </section>
    </main>
  );
}
