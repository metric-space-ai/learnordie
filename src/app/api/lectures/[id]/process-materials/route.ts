import { NextResponse } from "next/server";

import { getLecturerSession, isValidLecturerCsrfRequest } from "@/server/auth";
import { getLectureRepository } from "@/server/repository";
import { isDatabaseJobQueueEnabled } from "@/server/queued-jobs";
import { clientSafeProcessingError, sanitizeProcessingRuns } from "@/server/processing-errors";
import { isValidRouteEntityId } from "@/server/route-params";

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

  const repository = getLectureRepository();
  let lecture;
  try {
    if (isDatabaseJobQueueEnabled()) {
      if (!repository.enqueueMaterialProcessingRun) {
        throw new Error("LEARNBUDDY_JOB_PROVIDER=database requires Postgres repository.");
      }
      lecture = await repository.enqueueMaterialProcessingRun(id, session.email);
    } else {
      lecture = await repository.processMaterials(id, session.email);
    }
  } catch (error) {
    const lectures = await repository.listLectures(session.email);
    return NextResponse.json({
      error: clientSafeProcessingError(error),
      lectures: lectures.map(sanitizeProcessingRuns)
    }, { status: 500 });
  }
  if (!lecture) return NextResponse.json({ error: "Vorlesung nicht gefunden." }, { status: 404 });

  const lectures = await repository.listLectures(session.email);
  return NextResponse.json({ lecture, lectures, queued: isDatabaseJobQueueEnabled() }, {
    status: isDatabaseJobQueueEnabled() ? 202 : 200
  });
}
