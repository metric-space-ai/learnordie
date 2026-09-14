import type { StudentChatQuestionStatus, StudentExamDraftStatus } from "@/lib/types";

export type StudentExamDraftAttemptState = {
  questionStatus: StudentChatQuestionStatus;
  draftStatus: StudentExamDraftStatus;
  attemptAt?: number | null;
  attemptId?: string | null;
  roundId?: string | null;
};

export type StudentExamDraftAttemptDecision =
  | "started"
  | "not_accepted"
  | "pending"
  | "generating"
  | "cooldown"
  | "rate_limited"
  | "draft"
  | "published"
  | "rejected";

export function decideStudentExamDraftAttempt(state: StudentExamDraftAttemptState, input: {
  now: number;
  cooldownMs: number;
  staleGenerationMs: number;
  initial: boolean;
}): StudentExamDraftAttemptDecision {
  if (state.questionStatus !== "accepted") return "not_accepted";
  if (state.draftStatus === "published") return "published";
  if (state.draftStatus === "rejected") return "rejected";
  if (state.draftStatus === "draft") return "draft";

  const ageMs = input.now - (state.attemptAt ?? 0);
  if (state.draftStatus === "generating" && ageMs < input.staleGenerationMs) return "generating";
  if (input.initial && state.draftStatus !== "pending") return "pending";
  if (!input.initial && !["pending", "failed", "unsupported", "not_applicable", "generating"].includes(state.draftStatus)) return "pending";
  if (!input.initial && state.attemptAt !== null && state.attemptAt !== undefined && ageMs < input.cooldownMs) return "cooldown";
  return "started";
}

export function studentExamDraftAttemptMayCommit(state: StudentExamDraftAttemptState, attemptId: string) {
  return state.questionStatus === "accepted"
    && state.draftStatus === "generating"
    && state.attemptId === attemptId;
}

export function studentExamDraftMayBeRejected(state: StudentExamDraftAttemptState) {
  return state.draftStatus !== "published";
}

export function isIdempotentlyPublishedStudentDraft(state: StudentExamDraftAttemptState) {
  return state.draftStatus === "published" && Boolean(state.roundId);
}
