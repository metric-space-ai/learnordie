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
  onAnswered,
  onExpired
}: {
  questions: QuestionVariant[];
  initialLevel?: QuestionLevel;
  headerAction?: ReactNode;
  origin?: "control" | "hotspot" | "space";
  motionState?: PresenceState;
  onAnswered?: (payload: { level: QuestionLevel; correct: boolean; question: QuestionVariant; selected: string }) => void;
  onExpired?: () => void;
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
  useEffect(() => {
    if (revealed) return;
    const timer = window.setInterval(() => {
      setSeconds((current) => {
        if (current <= 1) {
          if (!expiredRef.current) {
            expiredRef.current = true;
            window.setTimeout(() => onExpired?.(), 0);
          }
          return 0;
        }

        return current - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [onExpired, revealed]);

  useEffect(() => {
    setLevel(initialLevel);
    setSelected(null);
    setRevealed(false);
    expiredRef.current = false;
  }, [initialLevel]);

  function choose(answerKey: string) {
    if (revealed || !question) return;
    const option = question.answers.find((answer) => answer.key === answerKey);
    setSelected(answerKey);
    setRevealed(true);
    onAnswered?.({ level, correct: Boolean(option?.correct), question, selected: answerKey });
  }

  if (!question) return null;

  return (
    <section
      className="question-drawer lb-enter-sheet"
      data-answer-state={revealed ? "answered" : "open"}
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
          {headerAction}
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
                disabled={revealed}
                style={{ "--lb-i": index + 1 } as MotionStyle}
                onClick={() => choose(answer.key)}
              >
                <span className="letter">{answer.key}</span>
                <span>{answer.text}</span>
              </button>
            );
          })}
        </div>
      </div>
      <aside className="timer lb-enter-control" aria-label="Timer">
        <strong>{String(seconds).padStart(2, "0")}</strong>
        {revealed ? <span>{question.answers.find((answer) => answer.key === selected)?.correct ? `+${question.points} Punkte` : "0 Punkte"}</span> : null}
      </aside>
    </section>
  );
}
