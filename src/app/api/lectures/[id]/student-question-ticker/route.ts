import { NextResponse } from "next/server";
import { z } from "zod";

import { getLecturerSession, isValidLecturerCsrfRequest } from "@/server/auth";
import { readJsonBody } from "@/server/request-json";
import { getLectureRepository } from "@/server/repository";
import { isValidRouteEntityId } from "@/server/route-params";
import { generateStudentQuestionExamDraft } from "@/server/student-exam-drafts";

const MAX_TICKER_BODY_BYTES = 2048;
const TICKER_WINDOW_MS = 24 * 60 * 60 * 1000;
const RETRY_COOLDOWN_MS = 30_000;
const GENERATION_STALE_MS = 90_000;
const MAX_LECTURE_ATTEMPTS_PER_WINDOW = 12;
const tickerAction = z.object({
  action: z.enum(["retry", "reject"]),
  questionId: z.string().min(1).max(120)
});

function tickerItems(lecture: NonNullable<Awaited<ReturnType<ReturnType<typeof getLectureRepository>["getLectureByToken"]>>>) {
  const reviews = lecture.questionReviews ?? [];
  const recent = (lecture.studentChatQuestions ?? [])
    .filter((question) => Date.parse(question.createdAt) >= Date.now() - TICKER_WINDOW_MS)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, 20);
  return recent.map((question) => {
    const review = reviews.find((item) => item.sourceStudentQuestionId === question.id);
    const draftReady = question.examDraftStatus === "draft" && review && (review.status === "draft" || review.status === "approved");
    return {
      id: question.id,
      text: question.text,
      pseudonym: question.pseudonym,
      status: question.status,
      createdAt: question.createdAt,
      examDraftStatus: question.examDraftStatus ?? "not_applicable",
      examDraftError: question.examDraftError,
      draft: draftReady ? {
        id: review.id,
        status: review.status,
        topic: review.variants[0]?.sourceRef?.split(" · ").at(-1) ?? "Entwurf",
        coreStatement: review.variants[0]?.learningObjective ?? "",
        variants: review.variants
      } : null
    };
  });
}

export async function GET(_request: Request, context: { params: Promise<unknown> }) {
  const session = await getLecturerSession();
  if (!session) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  const { id } = (await context.params) as { id: string };
  if (!isValidRouteEntityId(id)) return NextResponse.json({ error: "Vorlesung nicht gefunden." }, { status: 404 });

  const lecture = (await getLectureRepository().listLectures(session.email)).find((item) => item.id === id);
  if (!lecture) return NextResponse.json({ error: "Vorlesung nicht gefunden." }, { status: 404 });
  return NextResponse.json({ questions: tickerItems(lecture) }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request, context: { params: Promise<unknown> }) {
  const session = await getLecturerSession();
  if (!session) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  if (!isValidLecturerCsrfRequest(request, session)) return NextResponse.json({ error: "Sicherheitsprüfung fehlgeschlagen." }, { status: 403 });
  const { id } = (await context.params) as { id: string };
  if (!isValidRouteEntityId(id)) return NextResponse.json({ error: "Vorlesung nicht gefunden." }, { status: 404 });

  const body = await readJsonBody(request, MAX_TICKER_BODY_BYTES);
  if (!body.ok) return NextResponse.json({ error: "Ungültige Anfrage." }, { status: body.status });
  const parsed = tickerAction.safeParse(body.body);
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });

  const repository = getLectureRepository();
  const lecture = (await repository.listLectures(session.email)).find((item) => item.id === id);
  if (!lecture) return NextResponse.json({ error: "Vorlesung nicht gefunden." }, { status: 404 });
  const question = lecture.studentChatQuestions?.find((item) => item.id === parsed.data.questionId);
  if (!question) return NextResponse.json({ error: "Frage nicht gefunden." }, { status: 404 });

  if (parsed.data.action === "reject") {
    if (question.examDraftStatus === "published") return NextResponse.json({ error: "Ein veröffentlichter Entwurf kann nicht abgelehnt werden." }, { status: 409 });
    const review = lecture.questionReviews?.find((item) => item.sourceStudentQuestionId === question.id);
    if (review && review.status !== "rejected") {
      const updated = await repository.decideQuestionReview(id, review.id, "rejected", session.email, session.email);
      if (!updated) return NextResponse.json({ error: "Entwurf nicht gefunden." }, { status: 404 });
    } else if (question.examDraftStatus !== "rejected") {
      const updated = await repository.updateStudentExamDraftStatus({
        lectureId: id,
        chatQuestionId: question.id,
        status: "rejected"
      }, session.email);
      if (!updated) return NextResponse.json({ error: "Entwurf nicht gefunden." }, { status: 404 });
    }
    const refreshed = (await repository.listLectures(session.email)).find((item) => item.id === id)!;
    return NextResponse.json({ questions: tickerItems(refreshed) });
  }

  if (question.status !== "accepted") return NextResponse.json({ error: "Diese Studierendenfrage wurde nicht als fachliche Frage übernommen." }, { status: 409 });
  if (question.examDraftStatus === "draft") {
    return NextResponse.json({ questions: tickerItems(lecture) });
  }
  if (question.examDraftStatus === "published" || question.examDraftStatus === "rejected") {
    return NextResponse.json({ error: "Dieser Entwurf kann nicht erneut erstellt werden." }, { status: 409 });
  }
  const now = new Date();
  const attempt = await repository.beginStudentExamDraftAttempt({
    lectureId: id,
    chatQuestionId: question.id,
    now,
    since: new Date(now.getTime() - 15 * 60 * 1000),
    cooldownMs: RETRY_COOLDOWN_MS,
    staleGenerationMs: GENERATION_STALE_MS,
    maxAttempts: MAX_LECTURE_ATTEMPTS_PER_WINDOW
  }, session.email);
  if (attempt.status === "not_found") return NextResponse.json({ error: "Vorlesung nicht gefunden." }, { status: 404 });
  if (attempt.status === "rate_limited") {
    return NextResponse.json({ error: "Zu viele Entwurfsversuche. Bitte später erneut versuchen." }, { status: 429, headers: { "Retry-After": "900" } });
  }
  if (attempt.status === "cooldown") return NextResponse.json({ error: "Bitte vor einem erneuten Versuch kurz warten." }, { status: 429, headers: { "Retry-After": "30" } });
  if (attempt.status === "generating") return NextResponse.json({ error: "Der Entwurf wird bereits erstellt." }, { status: 409 });
  if (attempt.status === "draft") return NextResponse.json({ questions: tickerItems(lecture) });
  if (attempt.status !== "started") return NextResponse.json({ error: "Diese Studierendenfrage wurde nicht als fachliche Frage übernommen." }, { status: 409 });

  try {
    const generated = await generateStudentQuestionExamDraft(lecture, question);
    if (!generated.supported) {
      await repository.updateStudentExamDraftStatus({
        lectureId: id,
        chatQuestionId: question.id,
        attemptId: attempt.attemptId,
        status: "unsupported",
        error: "Die Frage ließ sich aus dem aktuellen Vorlesungskontext nicht ableiten."
      }, session.email);
    } else {
      await repository.saveStudentExamDraft({ lectureId: id, chatQuestionId: question.id, attemptId: attempt.attemptId, variants: generated.variants }, session.email);
    }
  } catch {
    console.warn("student exam draft retry failed");
    await repository.updateStudentExamDraftStatus({
      lectureId: id,
      chatQuestionId: question.id,
      attemptId: attempt.attemptId,
      status: "failed",
      error: "Der Entwurf konnte nicht erstellt werden. Bitte später erneut versuchen."
    }, session.email);
  }

  const refreshed = (await repository.listLectures(session.email)).find((item) => item.id === id);
  if (!refreshed) return NextResponse.json({ error: "Vorlesung nicht gefunden." }, { status: 404 });
  return NextResponse.json({ questions: tickerItems(refreshed) });
}
