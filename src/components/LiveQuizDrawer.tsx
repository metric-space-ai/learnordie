"use client";
import { useEffect, useRef, useState } from "react";
import type { LiveAnswerReceipt, LiveSessionView } from "@/lib/live-session";
import type { QuestionLevel } from "@/lib/types";
import type { PresenceState } from "./Presence";

/** A shared deadline and server receipt replace the local practice timer/scoring. */
export function LiveQuizDrawer({ round, serverOffset, receipt, onAnswer, onClose, motionState = "open" }: {
  round: NonNullable<LiveSessionView["round"]>; serverOffset: number; receipt: LiveAnswerReceipt | null;
  onAnswer?: (level: QuestionLevel, selected: string) => Promise<LiveAnswerReceipt>;
  onClose?: () => void; motionState?: PresenceState;
}) {
  const [level, setLevel] = useState<QuestionLevel>(receipt?.level ?? "2.0");
  const [saved, setSaved] = useState(receipt);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [seconds, setSeconds] = useState(() => Math.max(0, Math.ceil((round.expiresAt - Date.now() - serverOffset) / 1000)));
  const pendingRef = useRef(false);
  useEffect(() => {
    const tick = () => setSeconds(Math.max(0, Math.ceil((round.expiresAt - Date.now() - serverOffset) / 1000)));
    tick();
    const timer = setInterval(tick, 200);
    return () => clearInterval(timer);
  }, [round.expiresAt, serverOffset]);
  const effectiveReceipt = saved ?? receipt;
  const question = round.questions.find((item) => item.level === (effectiveReceipt?.level ?? level)) ?? round.questions[0];
  async function answer(selected: string) {
    if (!onAnswer || pendingRef.current || effectiveReceipt || Date.now() + serverOffset >= round.expiresAt) return;
    pendingRef.current = true;
    setPending(true);
    setError("");
    try { setSaved(await onAnswer(question.level, selected)); }
    catch (error) { setError(error instanceof Error ? error.message : "Antwort nicht gespeichert. Erneut versuchen."); }
    finally { pendingRef.current = false; setPending(false); }
  }
  // No exit-animation grace period in which an expired question remains answerable.
  if (seconds === 0 || !question) return null;
  return <section className="question-drawer lb-enter-sheet" aria-label="Quizfrage" data-state={motionState} data-level={question.level} data-round-id={round.id} data-answer-state={effectiveReceipt ? "answered" : "open"}>
    <div className="drawer-main">
      <div className="question-head">
        <div className="levels" aria-label="Niveau">
          {round.questions.map((item) => <button type="button" key={item.level} aria-pressed={question.level === item.level} disabled={pending || Boolean(effectiveReceipt)} onClick={() => setLevel(item.level)}>{item.level}</button>)}
        </div>
        {onClose && <button type="button" className="plain-button" onClick={onClose}>Frage schließen</button>}
      </div>
      <p className="question">{question.text}</p>
      <div className="answers">
        {question.answers.map((option) => <button className={`answer ${effectiveReceipt?.selected === option.key ? (effectiveReceipt.correct ? "correct" : "wrong") : ""}`} key={option.key} type="button" disabled={!onAnswer || pending || Boolean(effectiveReceipt)} onClick={() => void answer(option.key)}>
          <span className="letter">{option.key}</span><span>{option.text}</span>
        </button>)}
      </div>
      {effectiveReceipt && <div className="question-feedback" role="status"><p>{effectiveReceipt.correct ? "Richtig" : "Noch nicht richtig"} · {effectiveReceipt.points} Punkte</p><p className="question-explanation">{effectiveReceipt.explanation}</p></div>}
      {pending && <p role="status">Antwort wird gespeichert …</p>}
      {error && <p role="alert">{error}</p>}
    </div>
    <aside className="timer" aria-label="Timer"><strong>{String(seconds).padStart(2, "0")}</strong><span>schließt nach Ablauf</span></aside>
  </section>;
}
