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

  return (
    <section className="readiness-panel" aria-label="Prüfungsvorbereitung">
      <header className="readiness-head">
        <div>
          <p className="readiness-eyebrow">Prüfungsvorbereitung</p>
          <p className="readiness-band" data-tone={tone}>{readiness.bandLabel}</p>
        </div>
        <div className="readiness-score" data-tone={tone} aria-hidden="true">
          <span>{readiness.readinessScore}</span>
          <small>/100</small>
        </div>
      </header>

      <div className="readiness-meter" role="img" aria-label={`Lernstand ${readiness.readinessScore} von 100`}>
        <span className="readiness-meter-fill" data-tone={tone} style={{ width: `${readiness.readinessScore}%` }} />
      </div>

      <p className="readiness-note">
        Das ist eine motivierende Selbsteinschätzung aus deinen Antworten — keine Prüfungsnote.
      </p>

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

      {readiness.nextActions.length > 0 && (
        <ul className="readiness-actions">
          {readiness.nextActions.map((action) => (
            <li key={action.id} className="readiness-action">
              {action.lectureToken ? (
                <a href={action.kind === "live" ? `/l/${action.lectureToken}` : `/learn/${action.lectureToken}`}>
                  <span className="readiness-action-title">{action.title}</span>
                  <span className="readiness-action-detail">{action.detail}</span>
                </a>
              ) : (
                <div>
                  <span className="readiness-action-title">{action.title}</span>
                  <span className="readiness-action-detail">{action.detail}</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
