import { NextResponse } from "next/server";
import { z } from "zod";

import { getLecturerSession, isValidLecturerCsrfRequest } from "@/server/auth";
import { readJsonBody } from "@/server/request-json";
import { getLectureRepository } from "@/server/repository";
import { isValidRouteEntityId } from "@/server/route-params";

const MAX_ASSISTANT_ACTION_BYTES = 8192;

const reviewDraftSchema = z.object({
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
    return NextResponse.json({ error: "Fragenentwurf konnte nicht gelesen werden." }, { status: bodyResult.status });
  }

  const parsed = reviewDraftSchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Fragenentwurf konnte nicht angelegt werden." }, { status: 400 });
  }

  const repository = getLectureRepository();
  let lecture: Awaited<ReturnType<typeof repository.createLecturerAssistantReview>>;
  try {
    lecture = await repository.createLecturerAssistantReview({
      lectureId: id,
      slideId: parsed.data.slideId,
      message: parsed.data.message
    }, session.email);
  } catch {
    return NextResponse.json({ error: "Fragenentwurf konnte nicht angelegt werden." }, { status: 502 });
  }

  if (!lecture) return NextResponse.json({ error: "Vorlesung nicht gefunden." }, { status: 404 });

  const lectures = await repository.listLectures(session.email);
  return NextResponse.json({ lecture, lectures }, { status: 201 });
}
