import { NextResponse } from "next/server";

import { suggestPseudonyms } from "@/lib/student-pseudonym";
import { getStudentRepository } from "@/server/student-repository";
import { getCurrentStudentProfile } from "@/server/student-session";

export async function GET(request: Request) {
  const seriesId = new URL(request.url).searchParams.get("seriesId")?.trim() ?? "";
  const profile = await getCurrentStudentProfile();
  if (!seriesId) {
    return NextResponse.json({ suggestions: suggestPseudonyms({ count: 3 }) });
  }
  const suggestions = await getStudentRepository().listAvailablePseudonyms(seriesId, 3, profile?.id);
  return NextResponse.json({ suggestions });
}
