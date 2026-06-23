import { NextResponse } from "next/server";
import { z } from "zod";

import { getLecturerSession, isValidLecturerCsrfRequest } from "@/server/auth";
import { readJsonBody } from "@/server/request-json";
import { getLectureRepository } from "@/server/repository";

const MAX_CREATE_LECTURE_BYTES = 4096;

const createLectureSchema = z.object({
  title: z.string().min(3),
  seriesTitle: z.string().min(3),
  liveAt: z.string().min(1),
  examDate: z.string().min(4)
});

export async function GET() {
  const session = await getLecturerSession();
  if (!session) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const lectures = await getLectureRepository().listLectures(session.email);
  return NextResponse.json({ lectures });
}

export async function POST(request: Request) {
  const session = await getLecturerSession();
  if (!session) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  if (!isValidLecturerCsrfRequest(request, session)) {
    return NextResponse.json({ error: "Sicherheitsprüfung fehlgeschlagen." }, { status: 403 });
  }

  const bodyResult = await readJsonBody(request, MAX_CREATE_LECTURE_BYTES);
  if (!bodyResult.ok) {
    return NextResponse.json({ error: "Vorlesung konnte nicht angelegt werden." }, { status: bodyResult.status });
  }

  const parsed = createLectureSchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Vorlesung konnte nicht angelegt werden." }, { status: 400 });
  }

  const lecture = await getLectureRepository().createLecture(parsed.data, session.email);
  const lectures = await getLectureRepository().listLectures(session.email);
  return NextResponse.json({ lecture, lectures }, { status: 201 });
}
