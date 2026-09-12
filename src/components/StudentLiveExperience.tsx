"use client";

import { questionsForSlide } from "@/lib/questions";
import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";

import { seriesIdFromTitle } from "@/lib/series";
import { getOrCreateStudentKey, saveProfile } from "@/lib/student-client";
import type { LeaderboardEntry, Lecture } from "@/lib/types";
import { LeaderboardModal } from "./LeaderboardModal";
import { Presence } from "./Presence";
import { QuizDrawer } from "./QuizDrawer";
import { SlideEngineCanvas } from "./SlideEngineCanvas";
import { PseudonymChooser } from "./student/PseudonymChooser";

type QuestionOrigin = "control" | "hotspot" | "space";
type MotionStyle = CSSProperties & Record<"--lb-i", number>;

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function StudentLiveExperience({ lecture }: { lecture: Lecture }) {
  const [pseudonym, setPseudonym] = useState("");
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [slide, setSlide] = useState(0);
  const [questionOpen, setQuestionOpen] = useState(true);
  const [questionOrigin, setQuestionOrigin] = useState<QuestionOrigin>("control");
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardEntries, setLeaderboardEntries] = useState<LeaderboardEntry[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatText, setChatText] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [chatFeedback, setChatFeedback] = useState("");
  const [feedback, setFeedback] = useState("");
  const [anonymousKey, setAnonymousKey] = useState("");
  const [answeredOnce, setAnsweredOnce] = useState(false);
  const [identitySaved, setIdentitySaved] = useState(false);
  const [identitySaving, setIdentitySaving] = useState(false);
  const [identityMessage, setIdentityMessage] = useState("");
  const [questions, setQuestions] = useState(lecture.questions);

  useEffect(() => {
    const savedAnonymousKey = getOrCreateStudentKey();
    window.localStorage.setItem(`lb_anonymous_${lecture.publicToken}`, savedAnonymousKey);
    setAnonymousKey(savedAnonymousKey);
    const seriesId = seriesIdFromTitle(lecture.seriesTitle);
    fetch(`/api/student/claim?seriesId=${encodeURIComponent(seriesId)}`, { cache: "no-store" })
      .then((response) => response.json() as Promise<{ claim: { displayName?: string } | null }>)
      .then((data) => {
        if (data.claim?.displayName) {
          setPseudonym(data.claim.displayName);
          setJoined(true);
          window.localStorage.setItem(`lb_pseudonym_${lecture.publicToken}`, data.claim.displayName);
        }
      })
      .catch(() => undefined);
  }, [lecture.publicToken, lecture.seriesTitle]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.code === "Space" &&
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement) &&
        !(event.target instanceof Element && event.target.closest("button, a, summary, select, [contenteditable=true]"))
      ) {
        event.preventDefault();
        setQuestionOrigin("space");
        setQuestionOpen((current) => !current);
      }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Live-Fragen aus dem Transkript kommen waehrend der Vorlesung dazu: alle 20 s abholen.
  useEffect(() => {
    if (!joined) return;
    let stopped = false;
    const poll = async () => {
      if (document.hidden) return;
      try {
        const response = await fetch(`/api/lecture/${lecture.publicToken}/questions`, { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as { questions?: Lecture["questions"] };
        if (stopped || !payload.questions) return;
        const incoming = payload.questions;
        setQuestions((current) => {
          const known = new Set(current.map((question) => question.familyId ?? ""));
          const added = incoming.filter((question) => question.familyId && !known.has(question.familyId));
          if (added.length > 0) {
            const slideNumber = lecture.slides.findIndex((item) => item.id === added[0].slideId) + 1;
            setFeedback(slideNumber > 0 ? `Neue Frage zu Folie ${slideNumber}.` : "Neue Frage.");
          }
          return incoming.length === current.length && added.length === 0 ? current : incoming;
        });
      } catch {
        // Offline oder kurz nicht erreichbar: beim naechsten Intervall erneut versuchen.
      }
    };
    const timer = window.setInterval(poll, 20_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [joined, lecture.publicToken, lecture.slides]);

  const previous = useCallback(() => setSlide((current) => (current + lecture.slides.length - 1) % lecture.slides.length), [lecture.slides.length]);
  const next = useCallback(() => setSlide((current) => (current + 1) % lecture.slides.length), [lecture.slides.length]);

  async function recordEvent(eventType: string, payload: Record<string, unknown>, alias = pseudonym) {
    const key = anonymousKey || getOrCreateStudentKey();
    window.localStorage.setItem("lb_student_key", key);
    window.localStorage.setItem(`lb_anonymous_${lecture.publicToken}`, key);
    if (!anonymousKey) setAnonymousKey(key);

    await fetch("/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        lectureToken: lecture.publicToken,
        eventType,
        anonymousKey: key,
        pseudonym: alias,
        payload
      })
    }).catch(() => {
      // Analytics must never block participation.
    });
  }

  async function loadLeaderboard() {
    const key = anonymousKey || getOrCreateStudentKey();
    window.localStorage.setItem("lb_student_key", key);
    window.localStorage.setItem(`lb_anonymous_${lecture.publicToken}`, key);
    if (!anonymousKey) setAnonymousKey(key);

    setLeaderboardLoading(true);
    try {
      const response = await fetch(`/api/lecture/${lecture.publicToken}/leaderboard?anonymousKey=${encodeURIComponent(key)}`);
      const payload = (await response.json()) as { entries?: LeaderboardEntry[] };
      setLeaderboardEntries(Array.isArray(payload.entries) ? payload.entries : []);
    } catch {
      setLeaderboardEntries([]);
    } finally {
      setLeaderboardLoading(false);
    }
  }

  function join() {
    if (joining) return;
    const clean = pseudonym.trim();
    if (!clean) return;
    getOrCreateStudentKey();
    window.localStorage.setItem(`lb_pseudonym_${lecture.publicToken}`, clean);
    setPseudonym(clean);
    void recordEvent("student_joined", { mode: "live" }, clean);

    if (prefersReducedMotion()) {
      setJoined(true);
      return;
    }

    setJoining(true);
    window.setTimeout(() => setJoined(true), 700);
  }

  async function saveLiveIdentity() {
    if (identitySaving) return;
    const clean = pseudonym.trim();
    if (!clean) return;
    setIdentitySaving(true);
    setIdentityMessage("");
    const profile = await saveProfile(clean);
    if (!profile.ok) {
      setIdentityMessage(profile.error);
      setIdentitySaving(false);
      return;
    }

    try {
      await fetch("/api/student/enrollments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          seriesId: seriesIdFromTitle(lecture.seriesTitle),
          seriesTitle: lecture.seriesTitle,
          lectureId: lecture.id,
          source: "direct_live_link"
        })
      });
      setIdentitySaved(true);
      setIdentityMessage("Pseudonym gesichert.");
    } catch {
      setIdentitySaved(true);
      setIdentityMessage("Pseudonym gesichert.");
    } finally {
      setIdentitySaving(false);
    }
  }

  async function submitChatQuestion() {
    const text = chatText.trim();
    if (!text) return;
    setChatSending(true);
    setChatFeedback("");
    const key = anonymousKey || getOrCreateStudentKey();
    window.localStorage.setItem("lb_student_key", key);
    window.localStorage.setItem(`lb_anonymous_${lecture.publicToken}`, key);
    if (!anonymousKey) setAnonymousKey(key);

    const response = await fetch(`/api/lecture/${lecture.publicToken}/chat-questions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text,
        pseudonym,
        anonymousKey: key
      })
    });
    const payload = (await response.json()) as { message?: string; accepted?: boolean; error?: string };
    setChatSending(false);

    if (!response.ok) {
      setChatFeedback(payload.error ?? "Frage konnte nicht gesendet werden.");
      return;
    }

    setChatText("");
    setChatFeedback(payload.message ?? (payload.accepted ? "Frage weitergeleitet." : "Frage gespeichert."));
  }

  if (!joined) {
    return (
      <main className="mode-screen student-gate-screen lb-motion-root" data-joining={joining ? "true" : "false"}>
        <section className="mode-card student-gate-card lb-enter-sheet" data-joining={joining ? "true" : "false"}>
          <h1>{lecture.title}</h1>
          <div className="pseudonym-form">
            <PseudonymChooser
              value={pseudonym}
              onChange={setPseudonym}
              seriesId={seriesIdFromTitle(lecture.seriesTitle)}
              disabled={joining}
              label="Pseudonym"
            />
            <button className="primary-button" type="button" onClick={join} disabled={joining}>Teilnehmen</button>
          </div>
          <span className="student-gate-cover" aria-hidden="true" />
        </section>
      </main>
    );
  }

  return (
    <main
      className={`slide-screen learn-shell lb-motion-root ${questionOpen ? "question-open" : ""}`}
      data-question-origin={questionOrigin}
    >
      <SlideEngineCanvas
        current={slide}
        onNext={next}
        onPrevious={previous}
        slideDocument={lecture.slideDocument}
        slides={lecture.slides}
      />
      <div className="action-stack lb-enter-control">
        <button
          className="icon-action"
          type="button"
          title="Quiz (Leertaste)"
          aria-label="Quiz (Leertaste)"
          aria-pressed={questionOpen}
          onClick={() => {
            setQuestionOrigin("control");
            setQuestionOpen((current) => !current);
          }}
        >
          <span className="lb-icon lb-icon-question" aria-hidden="true" />
        </button>
        {lecture.leaderboardEnabled && (
          <button
            className="icon-action action-text"
            type="button"
            onClick={() => {
              setLeaderboardOpen(true);
              void loadLeaderboard();
            }}
          >
            Rangliste
          </button>
        )}
        <button className="icon-action action-text" type="button" onClick={() => setChatOpen((current) => !current)}>
          Frage stellen
        </button>
      </div>
      <Presence show={chatOpen}>
        {(motionState) => (
        <aside className="chat-question-panel lb-enter-overlay" data-panel-origin="chat-question" data-state={motionState} aria-label="Frage an Dozierende">
          <div className="lb-enter-row" style={{ "--lb-i": 0 } as MotionStyle}>
            <strong>Frage an Dozierende</strong>
            <button className="plain-button" type="button" onClick={() => setChatOpen(false)}>Schließen</button>
          </div>
          <textarea
            className="lb-enter-row"
            style={{ "--lb-i": 1 } as MotionStyle}
            value={chatText}
            onChange={(event) => setChatText(event.target.value)}
            aria-label="Deine Frage"
            rows={3}
            suppressHydrationWarning
          />
          <button
            className="primary-button lb-enter-row"
            style={{ "--lb-i": 2 } as MotionStyle}
            disabled={chatSending || chatText.trim().length < 4}
            type="button"
            onClick={submitChatQuestion}
          >
            {chatSending ? "Sendet …" : "Senden"}
          </button>
          {chatFeedback && <p className="form-note lb-enter-row" style={{ "--lb-i": 3 } as MotionStyle} aria-live="polite">{chatFeedback}</p>}
        </aside>
        )}
      </Presence>
      <Presence show={questionOpen}>
        {(motionState) => (
          <QuizDrawer
            key={lecture.slides[slide]?.id}
            questions={questionsForSlide(questions, lecture.slides[slide]?.id)}
            origin={questionOrigin}
            motionState={motionState}
            mode="live"
            onExpired={() => setQuestionOpen(false)}
            onAnswered={({ question, correct, selected }) => {
              const selectedAnswer = question.answers.find((answer) => answer.key === selected);
              const correctAnswer = question.answers.find((answer) => answer.correct);
              setFeedback(correct ? "Antwort gespeichert: richtig." : "Antwort gespeichert: falsch.");
              setAnsweredOnce(true);
              void (async () => {
                await recordEvent("answer_selected", {
                  mode: "live",
                  level: question.level,
                  familyId: question.familyId,
                  slideId: question.slideId,
                  points: question.points,
                  questionText: question.text,
                  selected,
                  selectedAnswerKey: selected,
                  selectedAnswerText: selectedAnswer?.text,
                  correctAnswerKey: correctAnswer?.key,
                  correctAnswerText: correctAnswer?.text,
                  correct
                });
                await loadLeaderboard();
              })();
            }}
          />
        )}
      </Presence>
      {feedback && <div className="toast-inline" aria-live="polite">{feedback}</div>}
      {answeredOnce && (!identitySaved || identityMessage) && (
        <aside className="identity-save-nudge lb-enter-panel" aria-label="Pseudonym sichern">
          <div aria-live="polite">
            <strong>{identitySaved ? "Pseudonym gesichert" : "Pseudonym sichern?"}</strong>
            {identityMessage && !identitySaved && <p className="form-note">{identityMessage}</p>}
          </div>
          {identitySaved ? (
            <a className="plain-button small" href="/student">Meine Vorlesungen</a>
          ) : (
            <button className="plain-button small" type="button" onClick={saveLiveIdentity} disabled={identitySaving}>
              {identitySaving ? "Sichert …" : "Sichern"}
            </button>
          )}
        </aside>
      )}
      <Presence show={lecture.leaderboardEnabled && leaderboardOpen}>
        {(motionState) => (
          <LeaderboardModal
            entries={leaderboardEntries}
            loading={leaderboardLoading}
            motionState={motionState}
            onClose={() => setLeaderboardOpen(false)}
          />
        )}
      </Presence>
    </main>
  );
}
