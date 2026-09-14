import assert from "node:assert/strict";
import test from "node:test";
import { STUDENT_DRAFT_GENERATION_BUDGET_MS, STUDENT_DRAFT_STALE_MS, studentDraftDeadline } from "./student-draft-limits";

test("ticker budget permits a reviewed repair without borrowing the live answer window", () => {
  const start = 1000;
  const firstAuthorAndReview = 25_000 + 20_000;
  const secondAuthorAndReview = 25_000 + 20_000;
  assert.equal(STUDENT_DRAFT_GENERATION_BUDGET_MS, firstAuthorAndReview + secondAuthorAndReview);
  assert.equal(studentDraftDeadline(start), start + 90_000);
  // The lease remains exclusive until after the full generation budget.
  assert.ok(studentDraftDeadline(start) < start + STUDENT_DRAFT_STALE_MS);
});

test("a delayed background callback cannot extend the reserved attempt deadline", () => {
  const attemptStartedAt = 1000;
  const callbackStartedAt = attemptStartedAt + 30_000;
  assert.equal(studentDraftDeadline(attemptStartedAt) - callbackStartedAt, 60_000);
  const tooLate = attemptStartedAt + STUDENT_DRAFT_STALE_MS;
  assert.ok(studentDraftDeadline(attemptStartedAt) < tooLate);
});
