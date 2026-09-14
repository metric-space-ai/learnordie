"use client";

import type { ReadinessSnapshot } from "@/lib/types";

const BAND_TONE: Record<string, string> = {
  start: "start",
  auf_kurs: "progress",
  fast_bereit: "almost",
  bereit: "ready"
};

export function ReadinessPanel({ readiness }: { readiness?: ReadinessSnapshot }) {
  if (!readiness) return null;

  const tone = BAND_TONE[readiness.band] ?? "start";
  const empty = readiness.readinessScore === 0;
  const linkedActions = readiness.nextActions.filter((action) => action.lectureToken);

  return (
    <section className="readiness-panel" aria-label="Prüfungsvorbereitung">
      <header className="readiness-head">
        <div>
          <h3 className="readiness-heading">Prüfungsvorbereitung</h3>
          <p className="readiness-band" data-tone={tone}>{readiness.bandLabel}</p>
        </div>
        {!empty && (
          <div className="readiness-score" data-tone={tone} aria-hidden="true">
            <span>{readiness.readinessScore}</span>
            <small>/100</small>
          </div>
        )}
      </header>

      {empty ? (
        <p className="readiness-note readiness-empty">
          Noch keine Einschätzung — beantworte deine erste Frage. Das ist keine Note.
        </p>
      ) : (
        <>
          <div className="readiness-meter" role="img" aria-label={`Lernstand ${readiness.readinessScore} von 100`}>
            <span className="readiness-meter-fill" data-tone={tone} style={{ width: `${readiness.readinessScore}%` }} />
          </div>
          <p className="readiness-note">
            Das ist eine motivierende Selbsteinschätzung aus deinen Antworten — keine Prüfungsnote.
          </p>
        </>
      )}

      {readiness.strengths.length > 0 && (
        <p className="readiness-strengths">
          <strong>Stark:</strong> {readiness.strengths.join(", ")}
        </p>
      )}

      {readiness.reviewTopics.length > 0 && (
        <p className="readiness-review">
          <strong>Wiederholen:</strong> {readiness.reviewTopics.join(", ")}
        </p>
      )}

      {linkedActions.length > 0 && (
        <ul className="readiness-actions">
          {linkedActions.map((action) => (
            <li key={action.id} className="readiness-action">
              <a href={action.kind === "live" ? `/l/${action.lectureToken}` : `/learn/${action.lectureToken}`}>
                <span className="readiness-action-title">{action.title}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
