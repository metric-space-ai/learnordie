import { NextResponse } from "next/server";

import { isValidSeriesId } from "@/server/route-params";
import { getStudentRepository } from "@/server/student-repository";
import { getCurrentStudentProfile } from "@/server/student-session";

export async function GET(_request: Request, context: { params: Promise<{ seriesId: string }> }) {
  const profile = await getCurrentStudentProfile();
  if (!profile) {
    return NextResponse.json({ readiness: null });
  }

  const { seriesId } = await context.params;
  if (!isValidSeriesId(seriesId)) {
    return NextResponse.json({ error: "Vorlesungsreihe nicht gefunden." }, { status: 404 });
  }

  const readiness = await getStudentRepository().computeReadiness(profile.id, seriesId);
  return NextResponse.json({ readiness });
}
