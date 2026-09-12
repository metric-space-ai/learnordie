import { NextResponse } from "next/server";

import { isValidPublicLectureToken } from "@/server/public-params";
import { getLectureRepository } from "@/server/repository";

// Studierende holen waehrend der Live-Vorlesung neu erzeugte Fragen ab.
export async function GET(_request: Request, context: { params: Promise<unknown> }) {
  const { token } = (await context.params) as { token: string };
  if (!isValidPublicLectureToken(token)) {
    return NextResponse.json({ error: "Vorlesung nicht gefunden." }, { status: 404 });
  }
  const lecture = await getLectureRepository().getLectureByToken(token);
  if (!lecture) return NextResponse.json({ error: "Vorlesung nicht gefunden." }, { status: 404 });
  return NextResponse.json({ questions: lecture.questions });
}
