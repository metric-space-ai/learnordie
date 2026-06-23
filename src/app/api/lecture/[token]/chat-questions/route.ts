import { NextResponse } from "next/server";
import { z } from "zod";

import { isValidPublicLectureToken } from "@/server/public-params";
import { getLectureRepository } from "@/server/repository";

const MAX_CHAT_QUESTION_BYTES = 4096;
const CHAT_QUESTION_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_CHAT_QUESTION_LIMIT = 5;

const chatQuestionSchema = z.object({
  text: z.string().trim().min(4).max(600),
  pseudonym: z.string().trim().max(80).optional(),
  anonymousKey: z.string().trim().min(8).max(160)
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

  const repository = getLectureRepository();
  const recentCount = await repository.countRecentStudentChatQuestions({
    lectureToken: token,
    anonymousKey: parsed.data.anonymousKey,
    since: new Date(Date.now() - CHAT_QUESTION_WINDOW_MS)
  });

  if (recentCount === null) {
    return NextResponse.json({ error: "Vorlesung nicht gefunden." }, { status: 404 });
  }

  if (recentCount >= configuredChatQuestionLimit()) {
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
    pseudonym: parsed.data.pseudonym ?? "Pseudonym",
    anonymousKey: parsed.data.anonymousKey
  });

  if (!chatQuestion) {
    return NextResponse.json({ error: "Vorlesung nicht gefunden." }, { status: 404 });
  }

  return NextResponse.json({
    chatQuestion,
    accepted: chatQuestion.status === "accepted",
    message: chatQuestion.status === "accepted"
      ? "Frage wurde an den Referenten weitergeleitet."
      : "Frage wurde gespeichert, aber nicht als fachliche Frage übernommen."
  });
}
