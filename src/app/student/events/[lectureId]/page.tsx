import { redirect } from "next/navigation";

import { lectureStudentView } from "@/lib/lecture-status";
import { getLectureRepository } from "@/server/repository";
import { getCurrentStudentProfile } from "@/server/student-session";

export const dynamic = "force-dynamic";

function formatDateTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

export default async function StudentEventPage({ params }: { params: Promise<{ lectureId: string }> }) {
  const profile = await getCurrentStudentProfile();
  if (!profile) redirect("/student");

  const { lectureId } = await params;
  const lectures = await getLectureRepository().listLectures();
  const lecture = lectures.find((item) => item.id === decodeURIComponent(lectureId));
  if (!lecture) redirect("/student");

  const view = lectureStudentView(lecture);

  return (
    <main className="student-app lb-motion-root" aria-label={`Termin ${lecture.title}`}>
      <header className="student-head lb-enter-row">
        <a className="student-brand" href="/student">
          <span className="home-brand-mark" aria-hidden="true">LB</span>
          <strong>Zurück zum Dashboard</strong>
        </a>
      </header>

      <article className="student-series lb-enter-panel">
        <header className="student-series-head">
          <div>
            <p className="eyebrow">{lecture.seriesTitle}</p>
            <h2>{lecture.title}</h2>
            <p className="student-series-meta">
              <span>Termin {formatDateTime(lecture.liveAt)}</span>
            </p>
          </div>
        </header>

        {view.bucket === "live" && (
          <section className="student-block live">
            <p className="student-block-label">● Live jetzt</p>
            <a className="primary-button" href={`/l/${lecture.publicToken}`}>Live teilnehmen</a>
          </section>
        )}

        {view.bucket === "learn" && (
          <section className="student-block">
            <p className="student-block-label">Lernen</p>
            <p className="student-empty-note">
              {view.aiAccessActive
                ? "Diese Veranstaltung ist im Lernmodus verfügbar — inklusive KI-Übung bis zum Prüfungstag."
                : "Diese Veranstaltung ist im Lernmodus verfügbar. Die KI-Übung ist abgelaufen, der statische Lernmodus bleibt nutzbar."}
            </p>
            <a className="primary-button" href={`/learn/${lecture.publicToken}`}>Lernmodus öffnen</a>
          </section>
        )}

        {view.bucket === "upcoming" && (
          <section className="student-block">
            <p className="student-block-label">Geplant</p>
            <p className="student-empty-note">Diese Veranstaltung hat noch nicht begonnen. Sie erscheint live, sobald dein:e Dozent:in startet.</p>
          </section>
        )}
      </article>
    </main>
  );
}
