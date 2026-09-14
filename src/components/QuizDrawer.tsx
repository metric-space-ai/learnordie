"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { groupQuestionFamilies } from "@/lib/questions";
import type { QuestionLevel, QuestionVariant } from "@/lib/types";
import type { PresenceState } from "./Presence";

const levels: QuestionLevel[] = ["4.0", "3.0", "2.0", "1.0"];
type MotionStyle = CSSProperties & Record<"--lb-i", number>;

export function QuizDrawer({
  questions,
  initialLevel = "2.0",
  headerAction,
  origin = "control",
  motionState = "open",
  mode = "live",
  peeking = false,
  onAnswered,
  onExpired,
  onContinue,
  onClose,
  onPeekSlide
}: {
  questions: QuestionVariant[];
  initialLevel?: QuestionLevel;
  headerAction?: ReactNode;
  origin?: "control" | "hotspot" | "space";
  motionState?: PresenceState;
  mode?: "live" | "learn";
  peeking?: boolean;
  onAnswered?: (payload: { level: QuestionLevel; correct: boolean; question: QuestionVariant; selected: string }) => void;
  onExpired?: () => void;
  onContinue?: () => void;
  onClose?: () => void;
  onPeekSlide?: () => void;
}) {
  const [level, setLevel] = useState<QuestionLevel>(initialLevel);
  const [familyIndex, setFamilyIndex] = useState(0);
  const [seconds, setSeconds] = useState(60);
  const [selected, setSelected] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const expiredRef = useRef(false);

  // Jede Frage ist eine Familie in allen Niveaus; der Niveau-Umschalter bleibt in der Familie.
  const families = useMemo(() => groupQuestionFamilies(questions), [questions]);
  const activeFamilyIndex = Math.min(familyIndex, Math.max(families.length - 1, 0));
  const family = families[activeFamilyIndex] ?? [];
  const question = family.find((item) => item.level === level) ?? family[0];

  function showFamily(nextIndex: number) {
    if (families.length === 0) return;
    setFamilyIndex((nextIndex + families.length) % families.length);
    setSelected(null);
    setRevealed(false);
    setSeconds(60);
    expiredRef.current = false;
  }
  const drawerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const root = drawerRef.current;
    if (!root || peeking) return;
    const focusable = () =>
      Array.from(root.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input:not([disabled])"));
    const first = focusable()[0];
    first?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;
      const start = items[0]!;
      const end = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === start) {
        event.preventDefault();
        end.focus();
      } else if (!event.shiftKey && document.activeElement === end) {
        event.preventDefault();
        start.focus();
      }
    }
    root.addEventListener("keydown", onKey);
    return () => root.removeEventListener("keydown", onKey);
  }, [level, revealed, peeking]);
  useEffect(() => {
    if (revealed && mode === "learn") return;
    const timer = window.setInterval(() => {
      setSeconds((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [revealed, mode]);

  useEffect(() => {
    if (mode === "live" && seconds === 0 && !expiredRef.current) {
      expiredRef.current = true;
      onExpired?.();
    }
  }, [mode, seconds, onExpired]);

  useEffect(() => {
    setLevel(initialLevel);
    setSelected(null);
    setRevealed(false);
    expiredRef.current = false;
    setSeconds(60);
  }, [initialLevel]);

  const timedOut = seconds === 0 && !revealed;
  const answersLocked = revealed || (mode === "live" && timedOut);

  function choose(answerKey: string) {
    if (answersLocked || !question) return;
    const option = question.answers.find((answer) => answer.key === answerKey);
    setSelected(answerKey);
    setRevealed(true);
    onAnswered?.({ level, correct: Boolean(option?.correct), question, selected: answerKey });
  }

  if (!question) return null;
  const selectedIsCorrect = Boolean(question.answers.find((answer) => answer.key === selected)?.correct);
  const timerCaption = revealed
    ? selectedIsCorrect
      ? mode === "learn" ? `${question.points} Punkte · bestes Ergebnis zählt` : `+${question.points} Punkte`
      : "0 Punkte"
    : timedOut
      ? mode === "learn"
        ? "Zeit vorbei — Antwort bleibt offen"
        : "Zeit abgelaufen"
      : mode === "learn"
        ? "Übungszeit"
        : "schließt nach Ablauf";

  return (
    <section
      ref={drawerRef}
      inert={peeking}
      aria-hidden={peeking || undefined}
      className="question-drawer lb-enter-sheet"
      data-answer-state={revealed ? "answered" : timedOut ? "expired" : "open"}
      data-level={level}
      data-origin={origin}
      data-state={motionState}
      aria-label="Quizfrage"
    >
      <div className="drawer-main" key={`${activeFamilyIndex}-${question.level}`}>
        <div className="question-head">
          <div className="levels lb-enter-control" aria-label="Niveau">
            {levels.map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={item === level}
                onClick={() => {
                  setLevel(item);
                  setSelected(null);
                  setRevealed(false);
                  expiredRef.current = false;
                  setSeconds(60);
                }}
              >
                {item}
              </button>
            ))}
          </div>
          {families.length > 1 ? (
            <div className="question-family-stepper lb-enter-control" aria-label="Fragen dieser Folie">
              <button type="button" onClick={() => showFamily(activeFamilyIndex - 1)} aria-label="Vorherige Frage" title="Vorherige Frage">‹</button>
              <span aria-live="polite">Frage {activeFamilyIndex + 1}/{families.length}</span>
              <button type="button" onClick={() => showFamily(activeFamilyIndex + 1)} aria-label="Nächste Frage" title="Nächste Frage">›</button>
            </div>
          ) : null}
          <div className="question-head-actions">
            {onPeekSlide && (
              <button className="plain-button question-peek" type="button" onClick={onPeekSlide}>
                Folie ansehen
              </button>
            )}
            {headerAction}
            {onClose && <button className="plain-button small" type="button" aria-label="Frage schließen" onClick={onClose}>×</button>}
          </div>
        </div>
        <p className="question lb-enter-row" style={{ "--lb-i": 0 } as MotionStyle}>{question.text}</p>
        <div className="answers">
          {question.answers.map((answer, index) => {
            const isSelected = selected === answer.key;
            const stateClass = revealed && answer.correct ? "correct" : revealed && isSelected ? "wrong" : "";
            return (
              <button
                className={`answer lb-enter-row ${stateClass}`}
                key={answer.key}
                type="button"
                disabled={answersLocked}
                style={{ "--lb-i": index + 1 } as MotionStyle}
                onClick={() => choose(answer.key)}
              >
                <span className="letter">{answer.key}</span>
                <span>{answer.text}</span>
              </button>
            );
          })}
        </div>
        {revealed && (
          <div className="question-feedback" role="status">
            <p className={selectedIsCorrect ? "feedback-ok" : "feedback-no"}>
              {selectedIsCorrect ? "Richtig" : "Noch nicht richtig"}
            </p>
            {question.explanation && <p className="question-explanation">{question.explanation}</p>}
            {onContinue && (
              <button className="primary-button question-continue" type="button" onClick={onContinue}>
                Weiterlernen
              </button>
            )}
          </div>
        )}
        {timedOut && mode === "live" && !revealed && (
          <div className="question-feedback" role="status">
            <p className="feedback-no">Zeit abgelaufen — keine Punkte</p>
            <p className="question-explanation">Die Frage bleibt offen zum Lesen. Eine verspätete Antwort wird nicht gewertet.</p>
            {question.explanation && <p className="question-explanation">{question.explanation}</p>}
          </div>
        )}
      </div>
      <aside className="timer lb-enter-control" aria-label="Timer">
        <strong>{String(seconds).padStart(2, "0")}</strong>
        <span>{timerCaption}</span>
      </aside>
    </section>
  );
}
