"use client";

import { useEffect, useRef, useState } from "react";
import type { LiveSessionView } from "@/lib/live-session";

/** Never takes focus, dims the slide, or mounts the students' question drawer. */
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
  return <aside className="presenter-round-status" aria-label="Fragerundenstatus">
    {generating && <span className="presenter-round-chip" role="status">Frage wird erstellt …</span>}
    {connected && round && seconds > 0 && <span className="presenter-round-chip" role="timer" aria-live="off" aria-label="Fragerunde läuft" data-round-id={round.id}>
      <span className="presenter-round-dot" aria-hidden="true" /> Frage läuft <strong>{seconds} s</strong>
    </span>}
    <span className="presenter-round-toast" role="status" aria-live="polite" aria-atomic="true">{notice}</span>
  </aside>;
}
