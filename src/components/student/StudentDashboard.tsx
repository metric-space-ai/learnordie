"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { joinCodeFromInput } from "@/lib/join-code";
import { saveProfile } from "@/lib/student-client";
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

function SeriesCard({ series, onRemove }: { series: StudentDashboardSeries; onRemove: (id: string) => void }) {
  return (
    <article className="student-series lb-enter-panel">
      <header className="student-series-head">
        <div>
          <h2>{series.seriesTitle}</h2>
          <p className="student-series-meta">
            {series.joinCode && <span>Code {series.joinCode}</span>}
            {series.examDate && <span>Prüfung {formatDate(series.examDate)}</span>}
          </p>
        </div>
        <button className="plain-button small" type="button" onClick={() => onRemove(series.enrollmentId)}>
          Entfernen
        </button>
      </header>

      {series.liveNow.length > 0 && (
        <section className="student-block live">
          <p className="student-block-label">● Live jetzt</p>
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
          <p className="student-block-label">Nächste Termine</p>
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
          <p className="student-block-label">Lernen</p>
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

      {series.liveNow.length === 0 && series.upcoming.length === 0 && series.learn.length === 0 && (
        <p className="student-empty-note">Noch keine Termine in dieser Reihe.</p>
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
    const response = await fetch(`/api/student/enrollments/${enrollmentId}`, { method: "DELETE" });
    if (response.ok) {
      setDashboard((current) => ({
        ...current,
        series: current.series.filter((series) => series.enrollmentId !== enrollmentId),
        hasEnrollments: current.series.filter((series) => series.enrollmentId !== enrollmentId).length > 0
      }));
    }
  }

  async function savePseudonym(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const clean = pseudonymInput.trim();
    if (!clean) return;
    const profile = await saveProfile(clean);
    if (profile) {
      setDashboard((current) => ({ ...current, profile }));
      setEditing(false);
    }
  }

  return (
    <main className="student-app lb-motion-root" aria-label="Mein LearnBuddy Dashboard">
      <header className="student-head lb-enter-row">
        <Link className="student-brand" href="/">
          <span className="home-brand-mark" aria-hidden="true">LB</span>
          <strong>LearnBuddy</strong>
        </Link>
        <div className="student-id">
          {editing ? (
            <form className="student-id-form" onSubmit={savePseudonym}>
              <input
                value={pseudonymInput}
                onChange={(event) => setPseudonymInput(event.target.value)}
                aria-label="Pseudonym"
                maxLength={80}
                autoFocus
              />
              <button className="plain-button small" type="submit">Speichern</button>
            </form>
          ) : (
            <>
              <span className="student-id-label">Pseudonym</span>
              <strong>{dashboard.profile.pseudonym}</strong>
              <button className="plain-button small" type="button" onClick={() => setEditing(true)}>Ändern</button>
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
              placeholder="z. B. ME1-GL-2026"
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
          <p className="eyebrow">Noch keine Vorlesung</p>
          <h1>Gib einen Vorlesungscode ein</h1>
          <p>
            Du bist noch keiner Vorlesung beigetreten. Sobald du oben einen Code eingibst, erscheinen hier deine
            Live-Termine, der Lernmodus und deine Prüfungsvorbereitung.
          </p>
        </section>
      ) : (
        <div className="student-series-grid">
          {dashboard.series.map((series) => (
            <SeriesCard key={series.enrollmentId} series={series} onRemove={removeEnrollment} />
          ))}
        </div>
      )}
    </main>
  );
}
