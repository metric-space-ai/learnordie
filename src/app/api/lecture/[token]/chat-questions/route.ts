import { after, NextResponse } from "next/server";
import { z } from "zod";

import { seriesIdForLecture } from "@/lib/series";
import { isValidPublicLectureToken } from "@/server/public-params";
import { getLectureRepository } from "@/server/repository";
import { generateStudentQuestionExamDraft } from "@/server/student-exam-drafts";
import { getStudentRepository } from "@/server/student-repository";
import { getCurrentStudentProfile } from "@/server/student-session";

export const maxDuration = 60;

const MAX_CHAT_QUESTION_BYTES = 4096;
const CHAT_QUESTION_WINDOW_MS = 15 * 60 * 1000;
const STUDENT_DRAFT_GENERATION_BUDGET_MS = 45_000;
const DEFAULT_CHAT_QUESTION_LIMIT = 5;

const chatQuestionSchema = z.object({
  text: z.string().trim().min(4).max(600)
});

function configuredChatQuestionLimit() {
  const configured = Number(process.env.LEARNBUDDY_CHAT_QUESTION_LIMIT_PER_WINDOW);
  if (Number.isFinite(configured) && configured >= 1 && configured <= 60) {
    return Math.floor(configured);
  }

  return DEFAULT_CHAT_QUESTION_LIMIT;
}

export async function POST(request: Request, context: { params: Promise<unknown> }) {
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).length > MAX_CHAT_QUESTION_BYTES) {
    return NextResponse.json({ error: "Chatfrage ist zu groß." }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Chatfrage ist leer oder zu lang." }, { status: 400 });
  }

  const parsed = chatQuestionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Chatfrage ist leer oder zu lang." }, { status: 400 });
  }

  const { token } = (await context.params) as { token: string };
  if (!isValidPublicLectureToken(token)) {
    return NextResponse.json({ error: "Vorlesung nicht gefunden." }, { status: 404 });
  }

  const profile = await getCurrentStudentProfile();
  if (!profile) {
    return NextResponse.json({ error: "Bitte zuerst ein Pseudonym wählen.", code: "claim_required" }, { status: 401 });
  }

  const repository = getLectureRepository();
  const lecture = await repository.getLectureByToken(token);
  if (!lecture) {
    return NextResponse.json({ error: "Vorlesung nicht gefunden." }, { status: 404 });
  }

  const enrollment = await getStudentRepository().getActiveClaim(profile.id, seriesIdForLecture(lecture));
  if (!enrollment) {
    return NextResponse.json({ error: "Bitte zuerst an dieser Vorlesung teilnehmen.", code: "enrollment_required" }, { status: 403 });
  }

  const now = new Date();
  const admission = await repository.reserveStudentChatQuestionAttempt({
    lectureToken: token,
    studentProfileId: profile.id,
    now,
    since: new Date(now.getTime() - CHAT_QUESTION_WINDOW_MS),
    maxAttempts: configuredChatQuestionLimit()
  });
  if (admission === null) {
    return NextResponse.json({ error: "Vorlesung nicht gefunden." }, { status: 404 });
  }
  if (admission === "rate_limited") {
    return NextResponse.json(
      { error: "Zu viele Chatfragen. Bitte später erneut versuchen." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(CHAT_QUESTION_WINDOW_MS / 1000))
        }
      }
    );
  }

  const chatQuestion = await repository.submitStudentChatQuestion({
    lectureToken: token,
    text: parsed.data.text,
    pseudonym: enrollment.displayName?.trim() || profile.pseudonym,
    anonymousKey: profile.anonymousKey
  });

  if (!chatQuestion) {
    return NextResponse.json({ error: "Vorlesung nicht gefunden." }, { status: 404 });
  }

  let examDraftStatus = chatQuestion.examDraftStatus ?? "not_applicable";
  if (chatQuestion.status === "accepted") {
    try {
      const attemptNow = new Date();
      const attempt = await repository.beginStudentExamDraftAttempt({
        lectureId: chatQuestion.lectureId,
        chatQuestionId: chatQuestion.id,
        now: attemptNow,
        since: new Date(attemptNow.getTime() - CHAT_QUESTION_WINDOW_MS),
        cooldownMs: 30_000,
        staleGenerationMs: 90_000,
        maxAttempts: 12,
        initial: true
      });
      if (attempt.status === "started") {
        examDraftStatus = "generating";
        after(async () => {
          try {
            const currentLecture = await repository.getLectureByToken(token);
            if (!currentLecture) throw new Error("Lecture no longer exists.");
            const generated = await generateStudentQuestionExamDraft(currentLecture, chatQuestion, {
              deadlineAt: Date.now() + STUDENT_DRAFT_GENERATION_BUDGET_MS
            });
            if (!generated.supported) {
              await repository.updateStudentExamDraftStatus({
                lectureId: chatQuestion.lectureId,
                chatQuestionId: chatQuestion.id,
                attemptId: attempt.attemptId,
                status: "unsupported",
                error: "Die Frage ließ sich aus dem aktuellen Vorlesungskontext nicht ableiten."
              });
            } else {
              await repository.saveStudentExamDraft({
                lectureId: chatQuestion.lectureId,
                chatQuestionId: chatQuestion.id,
                attemptId: attempt.attemptId,
                variants: generated.variants
              });
            }
          } catch {
            console.warn("student exam draft generation failed");
            try {
              await repository.updateStudentExamDraftStatus({
                lectureId: chatQuestion.lectureId,
                chatQuestionId: chatQuestion.id,
                attemptId: attempt.attemptId,
                status: "failed",
                error: "Der Entwurf konnte nicht erstellt werden. Bitte später erneut versuchen."
              });
            } catch {
              console.warn("student exam draft failure status could not be saved");
            }
          }
        });
      } else if (attempt.status === "rate_limited") {
        examDraftStatus = "failed";
        await repository.updateStudentExamDraftStatus({
          lectureId: chatQuestion.lectureId,
          chatQuestionId: chatQuestion.id,
          status: "failed",
          error: "Der Entwurf konnte nicht erstellt werden. Bitte später erneut versuchen."
        });
      } else {
        examDraftStatus = attempt.status === "draft" ? "draft" : chatQuestion.examDraftStatus ?? "pending";
      }
    } catch {
      console.warn("student exam draft scheduling failed");
      examDraftStatus = "pending";
    }
  }

  return NextResponse.json({
    chatQuestion: {
      id: chatQuestion.id,
      lectureId: chatQuestion.lectureId,
      pseudonym: chatQuestion.pseudonym,
      text: chatQuestion.text,
      status: chatQuestion.status,
      createdAt: chatQuestion.createdAt,
      examDraftStatus
    },
    accepted: chatQuestion.status === "accepted",
    message: chatQuestion.status === "accepted"
      ? "Frage wurde an den Referenten weitergeleitet."
      : "Frage wurde gespeichert, aber nicht als fachliche Frage übernommen."
  });
}
