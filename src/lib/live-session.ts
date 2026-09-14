import type { LeaderboardEntry, QuestionLevel, QuestionVariant } from "./types";

/** Deliberately excludes solutions, explanations, review metadata and source notes. */
export type LiveQuestion = Pick<QuestionVariant, "level" | "text" | "points"> & {
  answers: Array<{ key: string; text: string }>;
};
export type LiveAnswerReceipt = { level: QuestionLevel; selected: string; correct: boolean; points: number; explanation: string };
export type LiveSessionView = {
  sessionId: string | null;
  revision: number;
  status: "waiting" | "active" | "ended";
  slideIndex: number;
  showIntro: boolean;
  serverNow: number;
  sessionStartedAt: number | null;
  round: null | { id: string; expiresAt: number; questions: LiveQuestion[] };
  receipt: LiveAnswerReceipt | null;
  leaderboard?: LeaderboardEntry[];
};
export type LiveCommand =
  | { action: "start"; revision: number }
  | { action: "slide"; revision: number; slideIndex: number; showIntro: boolean }
  | { action: "fire"; revision: number; familyIndex: number; durationSeconds: number; familyId?: string; sessionId?: string; prepared?: boolean }
  | { action: "publishDraft"; revision: number; questionId: string }
  | { action: "close" | "end"; revision: number };
