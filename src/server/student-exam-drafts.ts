import type { Lecture, StudentChatQuestion } from "@/lib/types";

import { acceptedTranscriptContext, generateStudentExamDraft, liveQuestionSlideContext } from "./question-generation";
import { liveLecture, readLiveSession } from "./live-session-repository";
import { getLectureRepository } from "./repository";

export async function generateStudentQuestionExamDraft(lecture: Lecture, question: StudentChatQuestion) {
  const live = await readLiveSession(await liveLecture(lecture.publicToken), null, false);
  if (live.status !== "active" || live.sessionStartedAt === null) {
    throw new Error("A current live lecture session is required to prepare an exam draft.");
  }

  const currentSlide = lecture.slides[live.slideIndex];
  if (!currentSlide) throw new Error("The current lecture slide is unavailable.");
  const slide = liveQuestionSlideContext(lecture, currentSlide.id);
  if (!slide) throw new Error("The current lecture slide context is unavailable.");

  const transcript = acceptedTranscriptContext(lecture, live.sessionStartedAt);
  const scriptContext = await getLectureRepository().getLectureScriptContext(
    lecture.id,
    undefined,
    `${question.text}\n${transcript.accumulated}`
  );

  return generateStudentExamDraft({
    lecture,
    slide,
    slideId: currentSlide.id,
    sourceQuestionId: question.id,
    studentQuestion: question.text,
    transcriptContext: transcript.accumulated,
    latestTranscript: transcript.latestAt !== null && Date.now() - transcript.latestAt <= 120_000 ? transcript.latest : "",
    scriptContext
  });
}
