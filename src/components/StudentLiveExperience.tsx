"use client";

import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";

import type { LeaderboardEntry, Lecture } from "@/lib/types";
import { LeaderboardModal } from "./LeaderboardModal";
import { Presence } from "./Presence";
import { QuizDrawer } from "./QuizDrawer";
import { SlideEngineCanvas } from "./SlideEngineCanvas";

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

  useEffect(() => {
    const saved = window.localStorage.getItem(`lb_pseudonym_${lecture.publicToken}`);
    const savedAnonymousKey =
      window.localStorage.getItem("lb_student_key") ||
      window.localStorage.getItem(`lb_anonymous_${lecture.publicToken}`) ||
      crypto.randomUUID();
    window.localStorage.setItem(`lb_anonymous_${lecture.publicToken}`, savedAnonymousKey);
    setAnonymousKey(savedAnonymousKey);
    if (saved) {
      setPseudonym(saved);
      setJoined(true);
    }
  }, [lecture.publicToken]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.code === "Space" &&
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement)
      ) {
        event.preventDefault();
        setQuestionOrigin("space");
        setQuestionOpen((current) => !current);
      }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const previous = useCallback(() => setSlide((current) => (current + lecture.slides.length - 1) % lecture.slides.length), [lecture.slides.length]);
  const next = useCallback(() => setSlide((current) => (current + 1) % lecture.slides.length), [lecture.slides.length]);

  async function recordEvent(eventType: string, payload: Record<string, unknown>, alias = pseudonym) {
    const key = anonymousKey || window.localStorage.getItem("lb_student_key") || window.localStorage.getItem(`lb_anonymous_${lecture.publicToken}`) || crypto.randomUUID();
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
    const key = anonymousKey || window.localStorage.getItem("lb_student_key") || window.localStorage.getItem(`lb_anonymous_${lecture.publicToken}`) || crypto.randomUUID();
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
    const clean = pseudonym.trim() || "Pseudonym";
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

  async function submitChatQuestion() {
    const text = chatText.trim();
    if (!text) return;
    setChatSending(true);
    setChatFeedback("");
    const key = anonymousKey || window.localStorage.getItem("lb_student_key") || window.localStorage.getItem(`lb_anonymous_${lecture.publicToken}`) || crypto.randomUUID();
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
      setChatFeedback(payload.error ?? "Chatfrage konnte nicht gesendet werden.");
      return;
    }

    setChatText("");
    setChatFeedback(payload.message ?? (payload.accepted ? "Frage weitergeleitet." : "Frage gespeichert."));
  }

  if (!joined) {
    return (
      <main className="mode-screen student-gate-screen lb-motion-root" data-joining={joining ? "true" : "false"}>
        <section className="mode-card student-gate-card lb-enter-sheet" data-joining={joining ? "true" : "false"}>
          <p className="eyebrow">Live Student Modus</p>
          <h1>{lecture.seriesTitle}: {lecture.title}</h1>
          <p>Gib ein Pseudonym ein. Bitte keinen Klarnamen verwenden.</p>
          <div className="pseudonym-form">
            <input
              value={pseudonym}
              onChange={(event) => setPseudonym(event.target.value)}
              placeholder="z. B. LagerProfi42"
              suppressHydrationWarning
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
      className={`slide-screen lb-motion-root ${questionOpen ? "question-open" : ""}`}
      data-question-origin={questionOrigin}
    >
      <SlideEngineCanvas slides={lecture.slides} current={slide} onPrevious={previous} onNext={next} />
      <div className="action-stack lb-enter-control">
        <button
          className="icon-action"
          type="button"
          title="Frage mit Leertaste ein-/ausklappen"
          aria-label="Frage ein- oder ausklappen"
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
            className="icon-action"
            type="button"
            aria-label="Leaderboard anzeigen"
            onClick={() => {
              setLeaderboardOpen(true);
              void loadLeaderboard();
            }}
          >
            <span className="lb-icon lb-icon-rank" aria-hidden="true" />
          </button>
        )}
        <button className="icon-action" type="button" aria-label="Chatfrage stellen" title="Fachliche Frage an den Referenten senden" onClick={() => setChatOpen((current) => !current)}>
          <span className="lb-icon lb-icon-chat" aria-hidden="true" />
        </button>
      </div>
      <Presence show={chatOpen}>
        {(motionState) => (
        <aside className="chat-question-panel lb-enter-overlay" data-panel-origin="chat-question" data-state={motionState} aria-label="Chatfrage">
          <div className="lb-enter-row" style={{ "--lb-i": 0 } as MotionStyle}>
            <strong>Chatfrage</strong>
            <button className="plain-button" type="button" onClick={() => setChatOpen(false)}>Schließen</button>
          </div>
          <textarea
            className="lb-enter-row"
            style={{ "--lb-i": 1 } as MotionStyle}
            value={chatText}
            onChange={(event) => setChatText(event.target.value)}
            placeholder="Fachliche Frage zur Vorlesung stellen ..."
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
            {chatSending ? "Sendet" : "Senden"}
          </button>
          {chatFeedback && <p className="form-note lb-enter-row" style={{ "--lb-i": 3 } as MotionStyle} aria-live="polite">{chatFeedback}</p>}
        </aside>
        )}
      </Presence>
      <Presence show={questionOpen}>
        {(motionState) => (
          <QuizDrawer
            questions={lecture.questions}
            origin={questionOrigin}
            motionState={motionState}
            onAnswered={({ question, correct, selected }) => {
              const selectedAnswer = question.answers.find((answer) => answer.key === selected);
              const correctAnswer = question.answers.find((answer) => answer.correct);
              setFeedback(correct ? "Antwort gespeichert: richtig." : "Antwort gespeichert: bitte Erklärung ansehen.");
              void (async () => {
                await recordEvent("answer_selected", {
                  mode: "live",
                  level: question.level,
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
            onExpired={() => setQuestionOpen(false)}
          />
        )}
      </Presence>
      {feedback && <div className="toast-inline" aria-live="polite">{feedback}</div>}
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
