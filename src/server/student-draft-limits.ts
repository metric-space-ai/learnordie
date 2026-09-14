// A ticker draft is asynchronous: two author/review passes may each use
// 25s + 20s. Its budget is independent of the published 60s answer window
// and of the synchronous Space/Shift+Space presentation shortcuts.
export const STUDENT_DRAFT_GENERATION_BUDGET_MS = 90_000;
export const STUDENT_DRAFT_STALE_MS = 120_000;

export function studentDraftDeadline(attemptStartedAt: number): number {
  return attemptStartedAt + STUDENT_DRAFT_GENERATION_BUDGET_MS;
}
