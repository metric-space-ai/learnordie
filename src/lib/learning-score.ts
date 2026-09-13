type ScoringEvent = {
  id: string;
  lectureToken?: string;
  anonymousKey?: string;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: string;
};

/** Preserve every practice attempt in analytics, but rank only each student's
 * best result per lecture/question family. Replays, reloads and changing level
 * must not accumulate points for the same learning objective.
 */
export function learningScoreEvents<T extends ScoringEvent>(events: T[], score: (payload: T["payload"]) => number): T[] {
  const best = new Map<string, T>();
  const others: T[] = [];
  for (const event of events) {
    if (event.eventType !== "answer_selected" || event.payload.mode !== "learn") {
      others.push(event);
      continue;
    }
    const family = typeof event.payload.familyId === "string" && event.payload.familyId.trim()
      ? `family:${event.payload.familyId}`
      : typeof event.payload.questionText === "string" && event.payload.questionText.trim()
        ? `text:${event.payload.questionText}` : `legacy-event:${event.id}`;
    const key = JSON.stringify([event.lectureToken, event.anonymousKey ?? `event:${event.id}`, family]);
    const prior = best.get(key);
    if (!prior || score(event.payload) > score(prior.payload)
      || (score(event.payload) === score(prior.payload) && event.occurredAt < prior.occurredAt)) best.set(key, event);
  }
  return [...others, ...best.values()];
}
