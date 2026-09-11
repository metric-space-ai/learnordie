import type { LeaderboardEntry } from "@/lib/types";
import type { CSSProperties } from "react";
import type { PresenceState } from "./Presence";

type MotionStyle = CSSProperties & Record<"--lb-i", number>;

export function LeaderboardModal({
  entries,
  loading = false,
  motionState = "open",
  onClose
}: {
  entries: LeaderboardEntry[];
  loading?: boolean;
  motionState?: PresenceState;
  onClose: () => void;
}) {
  return (
    <aside className="overlay-panel lb-enter-overlay" data-panel-origin="leaderboard" data-state={motionState} aria-label="Rangliste">
      <div className="overlay-head">
        <h2>Rangliste</h2>
        <button type="button" onClick={onClose} aria-label="Rangliste schließen" title="Schließen">×</button>
      </div>
      <div className="leaderboard-list">
        {loading && <p className="form-note lb-enter-row" style={{ "--lb-i": 0 } as MotionStyle}>Lädt …</p>}
        {!loading && entries.length === 0 && (
          <p className="form-note lb-enter-row" style={{ "--lb-i": 0 } as MotionStyle}>
            Beantworte eine Frage, um hier zu erscheinen.
          </p>
        )}
        {entries.map((entry, index) => (
          <div
            className={`leader-row lb-enter-row ${entry.self ? "self" : ""}`}
            key={entry.rank}
            style={{ "--lb-i": index } as MotionStyle}
          >
            <span>{entry.rank} · {entry.name}</span>
            <strong>{entry.points}</strong>
          </div>
        ))}
      </div>
    </aside>
  );
}
