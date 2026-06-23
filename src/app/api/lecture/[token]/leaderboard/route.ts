import { NextResponse } from "next/server";

import { getAnalyticsRepository } from "@/server/analytics-repository";
import { isValidPublicLectureToken, parsePublicAnonymousKey } from "@/server/public-params";
import { getLectureRepository } from "@/server/repository";

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  if (!isValidPublicLectureToken(token)) {
    return NextResponse.json({ error: "Vorlesung nicht gefunden." }, { status: 404 });
  }

  const lecture = await getLectureRepository().getLectureByToken(token);
  if (!lecture) return NextResponse.json({ error: "Vorlesung nicht gefunden." }, { status: 404 });

  if (!lecture.leaderboardEnabled) {
    return NextResponse.json({ entries: [], enabled: false });
  }

  const currentAnonymousKey = parsePublicAnonymousKey(new URL(request.url).searchParams.get("anonymousKey"));
  if (!currentAnonymousKey.ok) {
    return NextResponse.json({ error: "Ungültiger Leaderboard-Schlüssel." }, { status: 400 });
  }

  const entries = await getAnalyticsRepository().getLectureLeaderboard({
    lectureId: lecture.id,
    lectureToken: lecture.publicToken,
    currentAnonymousKey: currentAnonymousKey.value
  });

  return NextResponse.json({ entries, enabled: true });
}
