import { redirect } from "next/navigation";

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


  return (
    <main className="student-app lb-motion-root" aria-label={`Termin ${lecture.title}`}>
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
            <h1>{lecture.title}</h1>
            <p className="student-series-meta">
              <span>Termin {formatDateTime(lecture.liveAt)}</span>
            </p>
          </div>
        </header>

        <section className="student-block">
          <a className="primary-button" href={`/l/${lecture.publicToken}`}>Vorlesung öffnen</a>
        </section>
      </article>
    </main>
  );
}
