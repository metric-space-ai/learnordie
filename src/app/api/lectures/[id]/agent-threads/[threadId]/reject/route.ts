import { NextResponse } from "next/server";

import { getLecturerSession, isValidLecturerCsrfRequest } from "@/server/auth";
import { getLectureRepository } from "@/server/repository";
import { isValidRouteEntityId } from "@/server/route-params";

export async function POST(request: Request, context: { params: Promise<unknown> }) {
  const session = await getLecturerSession();
  if (!session) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  if (!isValidLecturerCsrfRequest(request, session)) {
    return NextResponse.json({ error: "Sicherheitsprüfung fehlgeschlagen." }, { status: 403 });
  }

  const { id, threadId } = (await context.params) as { id: string; threadId: string };
  if (!isValidRouteEntityId(id) || !isValidRouteEntityId(threadId)) {
    return NextResponse.json({ error: "Agent-Thread nicht gefunden." }, { status: 404 });
  }

  const repository = getLectureRepository();
  const lecture = await repository.rejectAgentThread({ lectureId: id, threadId }, session.email);
  if (!lecture) return NextResponse.json({ error: "Agent-Thread nicht gefunden." }, { status: 404 });

  const lectures = await repository.listLectures(session.email);
  return NextResponse.json({ lecture, lectures });
}
