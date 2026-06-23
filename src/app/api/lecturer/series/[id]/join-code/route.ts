import { NextResponse } from "next/server";
import { z } from "zod";

import { seriesIdFromTitle } from "@/lib/series";
import { getLecturerSession, isValidLecturerCsrfRequest } from "@/server/auth";
import { readJsonBody } from "@/server/request-json";
import { getLectureRepository } from "@/server/repository";
import { isValidSeriesId } from "@/server/route-params";
import { getStudentRepository } from "@/server/student-repository";

const MAX_BYTES = 2 * 1024;

const schema = z.object({
  code: z.string().trim().min(1).max(120)
});

/** Ensure the signed-in lecturer actually owns this series. */
async function lecturerOwnsSeries(email: string, seriesId: string): Promise<boolean> {
  const lectures = await getLectureRepository().listLectures(email);
  return lectures.some((lecture) => seriesIdFromTitle(lecture.seriesTitle) === seriesId);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getLecturerSession();
  if (!session) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  if (!isValidLecturerCsrfRequest(request, session)) {
    return NextResponse.json({ error: "Sicherheitsprüfung fehlgeschlagen." }, { status: 403 });
  }

  const { id } = await context.params;
  if (!isValidSeriesId(id)) {
    return NextResponse.json({ error: "Vorlesungsreihe nicht gefunden." }, { status: 404 });
  }
  if (!(await lecturerOwnsSeries(session.email, id))) {
    return NextResponse.json({ error: "Vorlesungsreihe nicht gefunden." }, { status: 404 });
  }

  const bodyResult = await readJsonBody(request, MAX_BYTES);
  if (!bodyResult.ok) {
    return NextResponse.json({ error: "Code konnte nicht gespeichert werden." }, { status: bodyResult.status });
  }
  const parsed = schema.safeParse(bodyResult.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Bitte einen gültigen Code eingeben." }, { status: 400 });
  }

  try {
    const joinCode = await getStudentRepository().setLectureSeriesJoinCode(session.email, id, parsed.data.code);
    const share = await getStudentRepository().getShareInfoForSeries(session.email, id);
    return NextResponse.json({ joinCode, share });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Code konnte nicht gespeichert werden.";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getLecturerSession();
  if (!session) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  if (!isValidLecturerCsrfRequest(request, session)) {
    return NextResponse.json({ error: "Sicherheitsprüfung fehlgeschlagen." }, { status: 403 });
  }

  const { id } = await context.params;
  if (!isValidSeriesId(id) || !(await lecturerOwnsSeries(session.email, id))) {
    return NextResponse.json({ error: "Vorlesungsreihe nicht gefunden." }, { status: 404 });
  }

  const share = await getStudentRepository().getShareInfoForSeries(session.email, id);
  if (!share?.joinCode) {
    return NextResponse.json({ error: "Kein aktiver Code." }, { status: 404 });
  }
  // Disable by resetting to a fresh disabled state: find and disable the series code.
  const repository = getStudentRepository();
  const resolved = await repository.resolveJoinCode(share.joinCode);
  if (resolved) {
    await repository.disableJoinCode(session.email, resolved.joinCode.id);
  }
  const updated = await repository.getShareInfoForSeries(session.email, id);
  return NextResponse.json({ share: updated });
}
