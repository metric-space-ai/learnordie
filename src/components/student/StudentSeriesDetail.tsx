"use client";

import type { StudentDashboardSeries } from "@/lib/types";
import { ReadinessPanel } from "./ReadinessPanel";

function formatDateTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatDate(iso?: string) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

export function StudentSeriesDetail({ series }: { series: StudentDashboardSeries }) {
  return (
    <main className="student-app lb-motion-root" aria-label={`Vorlesungsreihe ${series.seriesTitle}`}>
      <header className="student-head lb-enter-row">
        <a className="student-brand" href="/student">
          <span className="home-brand-mark" aria-hidden="true">
            <span className="brand-loop" />
            <span className="brand-north-dot" />
          </span>
          <strong>Zurück zum Dashboard</strong>
        </a>
      </header>

      <article className="student-series lb-enter-panel">
        <header className="student-series-head">
          <div>
            <h2>{series.seriesTitle}</h2>
            <p className="student-series-meta">
              {series.joinCode && <span>Code {series.joinCode}</span>}
              {series.examDate && <span>Prüfung {formatDate(series.examDate)}</span>}
              <span>{series.events.length} Termine</span>
            </p>
          </div>
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

        <section className="student-block">
          <p className="student-block-label">Alle Termine</p>
          <ul className="student-event-list">
            {series.events.map((event) => (
              <li key={event.lectureId} className="student-event">
                <a className="student-event-title" href={`/student/events/${event.lectureId}`}>{event.title}</a>
                <span className="student-event-when">
                  {event.bucket === "live" ? "Live" : event.bucket === "upcoming" ? formatDateTime(event.liveAt) : "Lernmodus"}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <ReadinessPanel readiness={series.readiness} />
      </article>
    </main>
  );
}
