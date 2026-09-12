"use client";

import { FormEvent, ReactNode, useEffect, useState } from "react";

import { getOrCreateStudentKey, saveProfile } from "@/lib/student-client";
import { seriesIdFromTitle } from "@/lib/series";
import { suggestionsWithoutRejected } from "@/lib/student-pseudonym";
import type { Lecture } from "@/lib/types";
import { PseudonymChooser } from "./PseudonymChooser";

export function SeriesClaimGate({ lecture, source, children }: { lecture: Lecture; source: "direct_live_link" | "direct_learn_link"; children: ReactNode }) {
  const seriesId = seriesIdFromTitle(lecture.seriesTitle);
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<string[] | undefined>();

  useEffect(() => {
    let active = true;
    getOrCreateStudentKey();
    fetch(`/api/student/claim?seriesId=${encodeURIComponent(seriesId)}`, { cache: "no-store" })
      .then((response) => response.json() as Promise<{ claim: { displayName?: string } | null }>)
      .then((data) => {
        if (!active) return;
        if (data.claim?.displayName) setReady(true);
        setChecking(false);
      })
      .catch(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [seriesId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const clean = name.trim();
    if (clean.length < 2) {
      setError("Bitte ein Pseudonym wählen.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const profile = await saveProfile(clean);
      if (!profile.ok) {
        setError(profile.error);
        setBusy(false);
        return;
      }
      const response = await fetch("/api/student/enrollments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          seriesId,
          seriesTitle: lecture.seriesTitle,
          lectureId: lecture.id,
          source,
          displayName: clean
        })
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; suggestions?: string[] };
      if (!response.ok) {
        setError(data.error ?? "Beitritt nicht möglich.");
        if (data.suggestions?.length) {
          setSuggestions(suggestionsWithoutRejected(data.suggestions, clean));
        }
        setBusy(false);
        return;
      }
      setReady(true);
    } catch {
      setError("Netzwerkfehler. Eingabe bleibt stehen — bitte erneut versuchen.");
      setBusy(false);
    }
  }

  if (checking) {
    return (
      <main className="join-screen lb-motion-root" aria-busy="true">
        <p className="join-lead">Teilnahme wird geprüft …</p>
      </main>
    );
  }

  if (!ready) {
    return (
      <main className="join-screen app-canvas lb-motion-root" aria-label="Pseudonym für diese Vorlesung">
        <section className="join-card app-island lb-enter-panel" role="dialog" aria-modal="true" aria-labelledby="claim-title">
          <p className="eyebrow">{lecture.seriesTitle}</p>
          <h1 id="claim-title">Wähle ein freies Pseudonym</h1>
          <p className="join-lead">Der Name gilt in dieser Vorlesungsreihe. Punkte bleiben an diesem Browser.</p>
          <form className="join-form" onSubmit={submit}>
            <PseudonymChooser
              value={name}
              onChange={setName}
              seriesId={seriesId}
              suggestions={suggestions}
              disabled={busy}
              label="Pseudonym für diese Vorlesung"
            />
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-button" type="submit" disabled={busy}>
              {busy ? "Wird gespeichert …" : "Teilnehmen"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return <>{children}</>;
}
