"use client";

import { useEffect, useRef, useState } from "react";
import type { LiveSessionView } from "@/lib/live-session";
import { LiveQuizDrawer } from "./LiveQuizDrawer";

/** Quiet by default; the presenter explicitly opens a read-only round preview. */
export function PresenterRoundStatus({ state, connected, serverOffset, generating, message, leaderboardEnabled }: {
  state: LiveSessionView | null; connected: boolean; serverOffset: number;
  generating: boolean; message: string; leaderboardEnabled: boolean;
}) {
  const round = state?.round;
  const roundId = round?.id;
  const expiresAt = round?.expiresAt;
  const previous = useRef<string | null>(null);
  const deadline = useRef<{ id: string; at: number } | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [notice, setNotice] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const previewButton = useRef<HTMLButtonElement>(null);
  const previewOpen = Boolean(connected && round && seconds > 0 && previewId === round.id);
  function closePreview() {
    setPreviewId(null);
    previewButton.current?.focus();
  }
  useEffect(() => {
    if (!roundId || !expiresAt) return;
    const sampled = performance.now() + expiresAt - Date.now() - serverOffset;
    deadline.current = { id: roundId, at: deadline.current?.id === roundId ? Math.min(deadline.current.at, sampled) : sampled };
    const tick = () => setSeconds(Math.max(0, Math.ceil(((deadline.current?.at ?? sampled) - performance.now()) / 1000)));
    tick();
    const interval = setInterval(tick, 200);
    return () => clearInterval(interval);
  }, [roundId, expiresAt, serverOffset]);
  useEffect(() => {
    if (!connected) return; // A lost poll is not proof of round completion.
    if (round) {
      if (previous.current !== round.id) setNotice("Fragerunde gestartet · Sie können weiter präsentieren.");
      previous.current = round.id;
    } else if (previous.current && state?.status === "active" && (!leaderboardEnabled || state.leaderboard)) {
      previous.current = null;
      setNotice(leaderboardEnabled ? "Fragerunde beendet · Rangliste aktualisiert." : "Fragerunde beendet · Antworten gespeichert.");
    } else if (state?.status === "ended") previous.current = null;
  }, [connected, round, state?.status, state?.leaderboard, leaderboardEnabled]);
  useEffect(() => { if (message) setNotice(message); }, [message]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  return <><aside className="presenter-round-status" aria-label="Fragerundenstatus">
    {generating && <span className="presenter-round-chip" role="status">Frage wird erstellt …</span>}
    {connected && round && seconds > 0 && <button ref={previewButton} type="button" className="presenter-round-chip presenter-round-preview-toggle"
      aria-label="Abgefeuerte Frage anzeigen" aria-expanded={previewOpen} aria-controls="presenter-question-preview"
      onClick={() => setPreviewId(current => current === round.id ? null : round.id)}>
      <span className="presenter-round-dot" aria-hidden="true" /> Frage
      <strong role="timer" aria-live="off" aria-label="Fragerunde läuft" data-round-id={round.id}>{seconds} s</strong>
    </button>}
    <span className="presenter-round-toast" role="status" aria-live="polite" aria-atomic="true">{notice}</span>
  </aside>
    {previewOpen && round && <div id="presenter-question-preview" className="presenter-question-preview" onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closePreview(); }
    }}>
      <LiveQuizDrawer key={round.id} round={round} serverOffset={serverOffset} receipt={null} onClose={closePreview} />
    </div>}
  </>;
}
