import type { Lecture, StudentChatQuestionStatus } from "@/lib/types";
import { evaluateStudentChatQuestion } from "./chat-question-filter";

export type ChatQuestionModerationDecision = {
  status: StudentChatQuestionStatus;
  reason: string;
  sourceTopic?: string;
  provider: string;
  model: string;
  confidence: number;
  signals: string[];
};

/**
 * Admission is not factual approval. Enrolled students may ask about a spoken
 * example or paraphrase without sharing a keyword with the current slides.
 * The author receives script, slides and accepted session speech and must return
 * supported=false for unrelated requests. Its four-by-four draft still needs
 * independent source/answer review and explicit teacher publication.
 * Do not add a second topic classifier here: it can discard valid questions
 * before that complete-context check. Route enrollment, size and rate limits
 * remain the admission boundary; this function only rejects underspecified text.
 */
export async function moderateStudentChatQuestion(lecture: Lecture, text: string, currentTranscript = ""): Promise<ChatQuestionModerationDecision> {
  const clean = text.replace(/\s+/g, " ").trim();
  const relevance = evaluateStudentChatQuestion(lecture, clean, currentTranscript);
  const tooShort = clean.length < 12;
  return {
    status: tooShort ? "ignored" : "accepted",
    reason: tooShort ? "Zu kurz für eine fachliche Einordnung." : "Zur quellenbasierten Entwurfserstellung angenommen; noch nicht fachlich freigegeben.",
    sourceTopic: relevance.sourceTopic,
    provider: "learnordie-admission",
    model: "bounded-admission-v2",
    // This is confidence in the length decision, never factual relevance.
    confidence: tooShort ? 100 : 0,
    signals: tooShort ? ["too-short"] : ["pending-source-review", ...relevance.matches]
  };
}
