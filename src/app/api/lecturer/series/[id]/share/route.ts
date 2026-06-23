import { NextResponse } from "next/server";

import { seriesIdFromTitle } from "@/lib/series";
import { getLecturerSession } from "@/server/auth";
import { getLectureRepository } from "@/server/repository";
import { isValidSeriesId } from "@/server/route-params";
import { getStudentRepository } from "@/server/student-repository";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getLecturerSession();
  if (!session) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const { id } = await context.params;
  if (!isValidSeriesId(id)) {
    return NextResponse.json({ error: "Vorlesungsreihe nicht gefunden." }, { status: 404 });
  }

  const lectures = await getLectureRepository().listLectures(session.email);
  if (!lectures.some((lecture) => seriesIdFromTitle(lecture.seriesTitle) === id)) {
    return NextResponse.json({ error: "Vorlesungsreihe nicht gefunden." }, { status: 404 });
  }

  const share = await getStudentRepository().getShareInfoForSeries(session.email, id);
  return NextResponse.json({ share });
}
