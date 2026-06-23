import { NextResponse } from "next/server";
import { z } from "zod";

import { getLecturerSession, isValidLecturerCsrfRequest } from "@/server/auth";
import { readJsonBody } from "@/server/request-json";
import { getLectureRepository } from "@/server/repository";
import { isValidRouteEntityId } from "@/server/route-params";

const MAX_ASSISTANT_MESSAGE_BYTES = 8192;

const assistantMessageSchema = z.object({
  message: z.string().min(1).max(1200),
  slideId: z.string().min(1).optional()
});

export async function POST(request: Request, context: { params: Promise<unknown> }) {
  const session = await getLecturerSession();
  if (!session) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  if (!isValidLecturerCsrfRequest(request, session)) {
    return NextResponse.json({ error: "Sicherheitsprüfung fehlgeschlagen." }, { status: 403 });
  }

  const { id } = (await context.params) as { id: string };
  if (!isValidRouteEntityId(id)) {
    return NextResponse.json({ error: "Vorlesung nicht gefunden." }, { status: 404 });
  }

  const bodyResult = await readJsonBody(request, MAX_ASSISTANT_MESSAGE_BYTES);
  if (!bodyResult.ok) {
    return NextResponse.json({ error: "Nachricht konnte nicht gelesen werden." }, { status: bodyResult.status });
  }

  const parsed = assistantMessageSchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Nachricht ist leer oder zu lang." }, { status: 400 });
  }

  const repository = getLectureRepository();
  const lecture = await repository.submitLecturerAssistantMessage({
    lectureId: id,
    message: parsed.data.message,
    slideId: parsed.data.slideId
  }, session.email);

  if (!lecture) return NextResponse.json({ error: "Vorlesung nicht gefunden." }, { status: 404 });

  const lectures = await repository.listLectures(session.email);
  return NextResponse.json({ lecture, lectures });
}
