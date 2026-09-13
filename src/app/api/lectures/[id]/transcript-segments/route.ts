import { NextResponse } from "next/server";
import { z } from "zod";

import { getLecturerSession, isValidLecturerCsrfRequest } from "@/server/auth";
import { readJsonBody } from "@/server/request-json";
import { getLectureRepository } from "@/server/repository";
import { isValidRouteEntityId } from "@/server/route-params";
import { normalizeTranscriptTimeRange } from "@/server/transcript-time";
import { LiveSessionError, liveLecture, readLiveSession } from "@/server/live-session-repository";

const MAX_TRANSCRIPT_SEGMENT_BYTES = 4096;

const transcriptSchema = z.object({
  text: z.string().min(8).max(1200),
  sessionId: z.string().uuid().optional(),
  provider: z.string().min(2).max(80).optional(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional()
});

export async function POST(request: Request, context: { params: Promise<unknown> }) {
  const session = await getLecturerSession();
  if (!session) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  if (!isValidLecturerCsrfRequest(request, session)) {
    return NextResponse.json({ error: "Sicherheitsprüfung fehlgeschlagen." }, { status: 403 });
  }

  const { id } = (await context.params) as { id: string };
  if (!isValidRouteEntityId(id)) {
    return NextResponse.json({ error: "Vorlesung nicht gefunden." }, { status: 404 });
  }

  const bodyResult = await readJsonBody(request, MAX_TRANSCRIPT_SEGMENT_BYTES);
  if (!bodyResult.ok) {
    return NextResponse.json({ error: "Ungültiges Transkriptsegment." }, { status: bodyResult.status });
  }

  const parsed = transcriptSchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültiges Transkriptsegment." }, { status: 400 });
  }

  const timeRange = normalizeTranscriptTimeRange({
    startedAt: parsed.data.startedAt,
    endedAt: parsed.data.endedAt
  });
  if (!timeRange.ok) {
    return NextResponse.json({ error: "Ungültiges Transkriptsegment." }, { status: 400 });
  }

  const repository = getLectureRepository();
  if (parsed.data.sessionId) {
    const lecture = (await repository.listLectures(session.email)).find((item) => item.id === id);
    if (!lecture) return NextResponse.json({ error: "Vorlesung nicht gefunden." }, { status: 404 });
    try {
      const liveContext = await liveLecture(lecture.publicToken, session.email);
      const live = await readLiveSession(liveContext, null, false);
      if (live.sessionId !== parsed.data.sessionId) {
        return NextResponse.json({ error: "Die Live-Sitzung hat sich geändert. Bitte erneut versuchen." }, { status: 409 });
      }
    } catch (error) {
      return NextResponse.json({ error: "Die aktuelle Live-Sitzung ist nicht verfügbar." }, { status: error instanceof LiveSessionError ? error.status : 503 });
    }
  }

  const segment = await repository.submitTranscriptSegment({
    lectureId: id,
    ...parsed.data,
    startedAt: timeRange.startedAt,
    endedAt: timeRange.endedAt
  }, session.email);
  if (!segment) return NextResponse.json(
    { error: parsed.data.sessionId ? "Die Live-Sitzung hat sich geändert. Bitte erneut versuchen." : "Vorlesung nicht gefunden." },
    { status: parsed.data.sessionId ? 409 : 404 }
  );

  return NextResponse.json({
    segment,
    accepted: segment.status === "accepted",
    message: segment.status === "accepted"
      ? "Transkriptsegment wurde als Fragequelle übernommen."
      : "Transkriptsegment wurde gespeichert, aber nicht als Fragequelle übernommen."
  }, { status: 201 });
}
