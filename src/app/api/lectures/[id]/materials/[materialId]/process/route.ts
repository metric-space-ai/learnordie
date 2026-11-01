import { NextResponse } from "next/server";

import { getLecturerSession, isValidLecturerCsrfRequest } from "@/server/auth";
import { clientSafeProcessingError, sanitizeProcessingRuns } from "@/server/processing-errors";
import { parsePptxSlideRangeInput } from "@/server/pptx-slide-range";
import { getLectureRepository } from "@/server/repository";
import { isValidRouteEntityId } from "@/server/route-params";

export async function POST(request: Request, context: { params: Promise<unknown> }) {
  const session = await getLecturerSession();
  if (!session) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  if (!isValidLecturerCsrfRequest(request, session)) {
    return NextResponse.json({ error: "Sicherheitsprüfung fehlgeschlagen." }, { status: 403 });
  }

  const { id, materialId } = (await context.params) as { id: string; materialId: string };
  if (!isValidRouteEntityId(id) || !isValidRouteEntityId(materialId)) {
    return NextResponse.json({ error: "Material nicht gefunden." }, { status: 404 });
  }

  const repository = getLectureRepository();
  try {
    const body = await request.json().catch(() => ({})) as { slideRange?: unknown };
    const slideRange = parsePptxSlideRangeInput(body.slideRange);
    if (slideRange !== undefined) {
      const updated = await repository.updateMaterialSlideRange(id, materialId, slideRange, session.email);
      if (!updated) return NextResponse.json({ error: "PPTX-Material nicht gefunden." }, { status: 404 });
    }

    const lecture = await repository.processMaterial(id, materialId, session.email);
    if (!lecture) return NextResponse.json({ error: "Material nicht gefunden." }, { status: 404 });
    const lectures = await repository.listLectures(session.email);
    return NextResponse.json({ lecture, lectures });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Folienbereich ist ungültig")) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const lectures = await repository.listLectures(session.email);
    return NextResponse.json({
      error: clientSafeProcessingError(error),
      lectures: lectures.map(sanitizeProcessingRuns)
    }, { status: 500 });
  }
}
