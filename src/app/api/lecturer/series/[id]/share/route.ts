import { NextResponse } from "next/server";

import { getLecturerSession } from "@/server/auth";
import { isValidSeriesId } from "@/server/route-params";
import { getStudentRepository } from "@/server/student-repository";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getLecturerSession();
  if (!session) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const { id } = await context.params;
  if (!isValidSeriesId(id)) {
    return NextResponse.json({ error: "Vorlesungsreihe nicht gefunden." }, { status: 404 });
  }

  const share = await getStudentRepository().getShareInfoForSeries(session.email, id);
  if (!share) {
    return NextResponse.json({ error: "Vorlesungsreihe nicht gefunden." }, { status: 404 });
  }

  return NextResponse.json({ share });
}
