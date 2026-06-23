import { NextResponse } from "next/server";
import { z } from "zod";

import { getLecturerSession, isValidLecturerCsrfRequest } from "@/server/auth";
import { readJsonBody } from "@/server/request-json";
import { getLectureRepository } from "@/server/repository";
import { isValidRouteEntityId } from "@/server/route-params";

const MAX_CHAT_MODERATION_BYTES = 2048;

const moderationSchema = z.object({
  status: z.enum(["accepted", "ignored"])
});

export async function PATCH(request: Request, context: { params: Promise<unknown> }) {
  const session = await getLecturerSession();
  if (!session) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  if (!isValidLecturerCsrfRequest(request, session)) {
    return NextResponse.json({ error: "Sicherheitsprüfung fehlgeschlagen." }, { status: 403 });
  }

  const { id, questionId } = (await context.params) as { id: string; questionId: string };
  if (!isValidRouteEntityId(id) || !isValidRouteEntityId(questionId)) {
    return NextResponse.json({ error: "Chatfrage nicht gefunden." }, { status: 404 });
  }

  const bodyResult = await readJsonBody(request, MAX_CHAT_MODERATION_BYTES);
  if (!bodyResult.ok) {
    return NextResponse.json({ error: "Chatfrage konnte nicht aktualisiert werden." }, { status: bodyResult.status });
  }

  const parsed = moderationSchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Chatfrage konnte nicht aktualisiert werden." }, { status: 400 });
  }

  const lecture = await getLectureRepository().moderateStudentChatQuestion({
    lectureId: id,
    chatQuestionId: questionId,
    status: parsed.data.status,
    actor: session.email
  }, session.email);

  if (!lecture) return NextResponse.json({ error: "Chatfrage nicht gefunden." }, { status: 404 });

  const lectures = await getLectureRepository().listLectures(session.email);
  return NextResponse.json({ lecture, lectures });
}
