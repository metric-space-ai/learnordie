import { NextResponse } from "next/server";
import { z } from "zod";

import { getLecturerSession, isValidLecturerCsrfRequest } from "@/server/auth";
import { readJsonBody } from "@/server/request-json";
import { getLectureRepository } from "@/server/repository";
import { isValidRouteEntityId } from "@/server/route-params";

const MAX_ASSISTANT_ACTION_BYTES = 8192;

const evaluationFocusSchema = z.object({
  slideId: z.string().min(1).optional(),
  message: z.string().max(1200).optional()
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

  const bodyResult = await readJsonBody(request, MAX_ASSISTANT_ACTION_BYTES);
  if (!bodyResult.ok) {
    return NextResponse.json({ error: "Evaluation konnte nicht gelesen werden." }, { status: bodyResult.status });
  }

  const parsed = evaluationFocusSchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Evaluation konnte nicht geschärft werden." }, { status: 400 });
  }

  const repository = getLectureRepository();
  const lecture = await repository.applyLecturerAssistantEvaluationFocus({
    lectureId: id,
    slideId: parsed.data.slideId,
    message: parsed.data.message
  }, session.email);

  if (!lecture) return NextResponse.json({ error: "Vorlesung nicht gefunden." }, { status: 404 });

  const lectures = await repository.listLectures(session.email);
  return NextResponse.json({ lecture, lectures }, { status: 200 });
}
