"use client";

import { useEffect, useState } from "react";
import type { Lecture, QuestionVariant } from "@/lib/types";
import { useLiveSession } from "@/lib/use-live-session";
import { LearnExperience } from "./LearnExperience";
import { StudentLiveExperience } from "./StudentLiveExperience";

/** One entry point; the authoritative session, never the URL, selects the mode. */
export function StudentLectureExperience({ lecture }: { lecture: Lecture }) {
  const live = useLiveSession(lecture.publicToken, lecture.leaderboardEnabled);
  const active = live.state?.status === "active";
  const [practice, setPractice] = useState<{ sessionId: string | null; questions: QuestionVariant[] } | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const sessionId = live.state?.sessionId ?? null;
  const canLearn = live.connected && Boolean(live.state) && !active;

  useEffect(() => {
    if (!canLearn) return;
    const abort = new AbortController();
    setError("");
    void fetch(`/api/lecture/${encodeURIComponent(lecture.publicToken)}/questions`, {
      cache: "no-store", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(8000)])
    }).then(async response => {
      if (!response.ok) throw new Error("Fragen konnten nicht geladen werden.");
      const data = await response.json();
      if (!Array.isArray(data.questions)) throw new Error("Fragen konnten nicht geladen werden.");
      if (!abort.signal.aborted) setPractice({ sessionId, questions: data.questions });
    }).catch(() => {
      if (!abort.signal.aborted) setError("Fragen konnten nicht geladen werden. Bitte erneut versuchen.");
    });
    return () => abort.abort();
  }, [canLearn, lecture.publicToken, sessionId, retry]);

  // Do not interpret a lost connection as the end of a live lecture.
  if (active) return <StudentLiveExperience lecture={lecture} live={live} />;
  if (canLearn && practice?.sessionId === sessionId) {
    return <LearnExperience lecture={{ ...lecture, questions: practice.questions }} />;
  }
  return <main className="student-app" aria-label={lecture.title}>
    <p role="status">{error || (!live.connected && live.error) || "Vorlesung wird geladen …"}</p>
    {(error || !live.connected) && <button className="plain-button" type="button" onClick={() => { live.refresh(); setRetry(value => value + 1); }}>Erneut versuchen</button>}
  </main>;
}
