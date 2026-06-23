"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

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
  const [seconds, setSeconds] = useState(60);
  const [selected, setSelected] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const expiredRef = useRef(false);

  const question = useMemo(
    () => questions.find((item) => item.level === level) ?? questions[0],
    [level, questions]
  );
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
    if (revealed) return;
    const option = question.answers.find((answer) => answer.key === answerKey);
    setSelected(answerKey);
    setRevealed(true);
    onAnswered?.({ level, correct: Boolean(option?.correct), question, selected: answerKey });
  }

  return (
    <section
      className="question-drawer lb-enter-sheet"
      data-answer-state={revealed ? "answered" : "open"}
      data-level={level}
      data-origin={origin}
      data-state={motionState}
      aria-label="Quizfrage"
    >
      <div className="drawer-main" key={question.level}>
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
        <span>{revealed ? (question.answers.find((answer) => answer.key === selected)?.correct ? `+${question.points} Punkte` : "0 Punkte") : "schließt"}</span>
      </aside>
    </section>
  );
}
