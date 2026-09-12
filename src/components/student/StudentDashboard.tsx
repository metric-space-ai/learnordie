"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { joinCodeFromInput } from "@/lib/join-code";
import { PSEUDONYM_MAX_LENGTH } from "@/lib/student-pseudonym";
import { claimSeriesDisplayName, saveProfile } from "@/lib/student-client";
import type { StudentDashboard as StudentDashboardData, StudentDashboardSeries } from "@/lib/types";
import { ReadinessPanel } from "./ReadinessPanel";

function formatDateTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatDate(iso?: string) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function continueHref(series: StudentDashboardSeries) {
  const live = series.liveNow[0];
  if (live) return `/l/${live.publicToken}`;
  const learn = series.learn[0];
  if (learn) return `/learn/${learn.publicToken}`;
  return `/student?series=${encodeURIComponent(series.seriesId)}`;
}

function continueLabel(series: StudentDashboardSeries) {
  if (series.liveNow[0]) return "Live starten";
  if (series.learn[0]) return "Weiterlernen";
  return "Vorlesung öffnen";
}

function SeriesCard({
  series,
  onRemove,
  onRename
}: {
  series: StudentDashboardSeries;
  onRemove: (id: string) => void;
  onRename: (seriesId: string, displayName: string) => Promise<{ ok: boolean; error?: string; displayName?: string }>;
}) {
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState(series.displayName ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const href = continueHref(series);

  async function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await onRename(series.seriesId, nameInput.trim());
      if (!result.ok) {
        setError(result.error ?? "Name konnte nicht gespeichert werden.");
        return;
      }
      setEditing(false);
    } catch {
      setError("Netzwerkfehler. Eingabe bleibt stehen — bitte erneut versuchen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="student-series lb-enter-panel">
      <header className="student-series-head">
        <div>
          <h2>{series.seriesTitle}</h2>
          <p className="student-series-meta">
            {series.displayName && <span>Name in dieser Vorlesung: {series.displayName}</span>}
            {series.joinCode && <span>Code {series.joinCode}</span>}
            {series.examDate && <span>Prüfung {formatDate(series.examDate)}</span>}
          </p>
        </div>
        <button className="plain-button small" type="button" onClick={() => onRemove(series.enrollmentId)}>
          Entfernen
        </button>
      </header>

      <p className="student-continue">
        <a className="primary-button" href={href} aria-label={continueLabel(series)}>
          {continueLabel(series)}
        </a>
      </p>

      {editing ? (
        <form className="student-id-form" onSubmit={saveName}>
          <label>
            Name in dieser Vorlesung
            <input
              value={nameInput}
              onChange={(event) => setNameInput(event.target.value)}
              maxLength={PSEUDONYM_MAX_LENGTH}
              aria-label="Name in dieser Vorlesung"
            />
          </label>
          <button className="plain-button small" type="submit" disabled={busy}>Speichern</button>
          <button className="plain-button small" type="button" onClick={() => setEditing(false)}>Abbrechen</button>
        </form>
      ) : (
        <button className="plain-button small" type="button" onClick={() => setEditing(true)}>
          Anzeigename ändern
        </button>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}

      {series.liveNow.length > 0 && (
        <section className="student-block live">
          <ul className="student-event-list">
            {series.liveNow.map((event) => (
              <li key={event.lectureId}>
                <a className="primary-button" href={`/l/${event.publicToken}`}>{event.title} — live teilnehmen</a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {series.upcoming.length > 0 && (
        <section className="student-block">
          <ul className="student-event-list">
            {series.upcoming.map((event) => (
              <li key={event.lectureId} className="student-event">
                <span className="student-event-title">{event.title}</span>
                <span className="student-event-when">{formatDateTime(event.liveAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {series.learn.length > 0 && (
        <section className="student-block">
          <ul className="student-event-list">
            {series.learn.map((event) => (
              <li key={event.lectureId} className="student-event">
                <span className="student-event-title">{event.title}</span>
                <a className="plain-button small" href={`/learn/${event.publicToken}`}>Lernmodus öffnen</a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ReadinessPanel readiness={series.readiness} />
    </article>
  );
}

export function StudentDashboard({ initialDashboard }: { initialDashboard: StudentDashboardData }) {
  const router = useRouter();
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [codeInput, setCodeInput] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [pseudonymInput, setPseudonymInput] = useState(initialDashboard.profile.pseudonym);

  function addCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = joinCodeFromInput(codeInput);
    if (!code) {
      setError("Bitte einen gültigen Code eingeben.");
      return;
    }
    setError("");
    router.push(`/join/${encodeURIComponent(code)}`);
  }

  async function removeEnrollment(enrollmentId: string) {
    try {
      const response = await fetch(`/api/student/enrollments/${enrollmentId}`, { method: "DELETE" });
      if (response.ok) {
        setDashboard((current) => ({
          ...current,
          series: current.series.filter((series) => series.enrollmentId !== enrollmentId),
          hasEnrollments: current.series.filter((series) => series.enrollmentId !== enrollmentId).length > 0
        }));
        return;
      }
      setError("Vorlesung konnte nicht entfernt werden. Bitte erneut versuchen.");
    } catch {
      setError("Netzwerkfehler. Bitte erneut versuchen.");
    }
  }

  async function renameSeries(seriesId: string, displayName: string) {
    const result = await claimSeriesDisplayName(seriesId, displayName);
    if (result.ok) {
      setDashboard((current) => ({
        ...current,
        profile: result.profile,
        series: current.series.map((series) =>
          series.seriesId === seriesId ? { ...series, displayName: result.displayName ?? displayName } : series
        )
      }));
    }
    return result;
  }

  async function savePseudonym(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const clean = pseudonymInput.trim();
    if (!clean) return;
    try {
      const profile = await saveProfile(clean);
      if (profile.ok) {
        setDashboard((current) => ({ ...current, profile: profile.profile }));
        setEditing(false);
        setError("");
        return;
      }
      setError(profile.error);
    } catch {
      setError("Netzwerkfehler. Eingabe bleibt stehen — bitte erneut versuchen.");
    }
  }

  return (
    <main className="student-app lb-motion-root" aria-label="Mein learnordie.app Dashboard">
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
        <div className="student-id">
          {editing ? (
            <form className="student-id-form" onSubmit={savePseudonym}>
              <input
                value={pseudonymInput}
                onChange={(event) => setPseudonymInput(event.target.value)}
                aria-label="Bevorzugter Name"
                maxLength={PSEUDONYM_MAX_LENGTH}
                autoFocus
              />
              <button className="plain-button small" type="submit">Speichern</button>
            </form>
          ) : (
            <>
              <span className="student-id-label">Bevorzugter Name</span>
              <strong>{dashboard.profile.pseudonym}</strong>
              <button className="plain-button small" type="button" aria-label="Pseudonym ändern" onClick={() => setEditing(true)}>Ändern</button>
            </>
          )}
        </div>
      </header>

      <section className="student-addcode lb-enter-panel" aria-label="Vorlesung hinzufügen">
        <form className="student-addcode-form" onSubmit={addCode}>
          <label>
            Vorlesungscode hinzufügen
            <input
              value={codeInput}
              onChange={(event) => setCodeInput(event.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
            />
          </label>
          <button className="primary-button" type="submit">Hinzufügen</button>
        </form>
        {error && <p className="form-error" role="alert">{error}</p>}
      </section>

      {dashboard.series.length === 0 ? (
        <section className="student-emptystate lb-enter-panel">
          <h1>Gib einen Vorlesungscode ein</h1>
        </section>
      ) : (
        <div className="student-series-grid">
          {dashboard.series.map((series) => (
            <SeriesCard
              key={series.enrollmentId}
              series={series}
              onRemove={removeEnrollment}
              onRename={renameSeries}
            />
          ))}
        </div>
      )}
    </main>
  );
}
