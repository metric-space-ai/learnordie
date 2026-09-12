"use client";

import { type ReactNode, useEffect, useState } from "react";
import { ensureStudentEnrollment } from "@/lib/student-client";
import { seriesIdForLecture } from "@/lib/series";
import type { Lecture } from "@/lib/types";

// Kept as the page-level identity boundary, but never gates slide access.
export function SeriesClaimGate({ lecture, source, children }: {
  lecture: Lecture; source: "direct_live_link" | "direct_learn_link"; children: ReactNode;
}) {
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const seriesId = seriesIdForLecture(lecture);
  useEffect(() => {
    let active = true;
    ensureStudentEnrollment({ seriesId, seriesTitle: lecture.seriesTitle, lectureId: lecture.id, source })
      .then(() => { if (active) setError(""); })
      .catch(() => { if (active) setError("Dein Lernstand konnte noch nicht gespeichert werden."); });
    return () => { active = false; };
  }, [lecture.id, lecture.seriesTitle, seriesId, source, retry]);
  return <>{children}{error && <aside className="student-connection-notice" role="status">
    {error} <button type="button" onClick={() => setRetry((value) => value + 1)}>Erneut versuchen</button>
  </aside>}</>;
}
