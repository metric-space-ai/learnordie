import { NextResponse } from "next/server";

import { getLecturerSession } from "@/server/auth";
import { getLectureRepository } from "@/server/repository";
import { buildRetentionSummary } from "@/server/retention";
import { isValidRouteEntityId } from "@/server/route-params";

export async function GET(_request: Request, context: { params: Promise<unknown> }) {
  const session = await getLecturerSession();
  if (!session) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const { id } = (await context.params) as { id: string };
  if (!isValidRouteEntityId(id)) {
    return NextResponse.json({ error: "Vorlesung nicht gefunden." }, { status: 404 });
  }

  const lecture = (await getLectureRepository().listLectures(session.email)).find((item) => item.id === id);
  if (!lecture) return NextResponse.json({ error: "Vorlesung nicht gefunden." }, { status: 404 });

  return NextResponse.json({ summary: await buildRetentionSummary(lecture) });
}
