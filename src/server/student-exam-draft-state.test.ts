import assert from "node:assert/strict";
import test from "node:test";

import {
  decideStudentExamDraftAttempt,
  isIdempotentlyPublishedStudentDraft,
  studentExamDraftAttemptMayCommit,
  studentExamDraftMayBeRejected
} from "./student-exam-draft-state";

test("a duplicate retry sees the current generation claim instead of spending another provider attempt", () => {
  const now = Date.now();
  const firstClaim = {
    questionStatus: "accepted" as const,
    draftStatus: "generating" as const,
    attemptAt: now,
    attemptId: "attempt-1"
  };
  assert.equal(decideStudentExamDraftAttempt(firstClaim, {
    now,
    cooldownMs: 30_000,
    staleGenerationMs: 90_000,
    initial: false
  }), "generating");
});

test("rejection during generation invalidates the in-flight save token", () => {
  const inFlight = {
    questionStatus: "accepted" as const,
    draftStatus: "generating" as const,
    attemptId: "attempt-1"
  };
  assert.equal(studentExamDraftMayBeRejected(inFlight), true);
  const rejected = { ...inFlight, draftStatus: "rejected" as const, attemptId: null };
  assert.equal(studentExamDraftAttemptMayCommit(rejected, "attempt-1"), false);
});

test("a publish retry is idempotent and keeps the original live-round id", () => {
  const published = {
    questionStatus: "accepted" as const,
    draftStatus: "published" as const,
    attemptId: null,
    roundId: "round-1"
  };
  assert.equal(isIdempotentlyPublishedStudentDraft(published), true);
  assert.equal(isIdempotentlyPublishedStudentDraft({ ...published, roundId: null }), false);
});
