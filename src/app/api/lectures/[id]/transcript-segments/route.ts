import { NextResponse } from "next/server";
import { z } from "zod";

import { getLecturerSession, isValidLecturerCsrfRequest } from "@/server/auth";
import { readJsonBody } from "@/server/request-json";
import { getLectureRepository } from "@/server/repository";
import { isValidRouteEntityId } from "@/server/route-params";
import { normalizeTranscriptTimeRange } from "@/server/transcript-time";

const MAX_TRANSCRIPT_SEGMENT_BYTES = 4096;

const transcriptSchema = z.object({
  text: z.string().min(8).max(1200),
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

  const segment = await getLectureRepository().submitTranscriptSegment({
    lectureId: id,
    ...parsed.data,
    startedAt: timeRange.startedAt,
    endedAt: timeRange.endedAt
  }, session.email);
  if (!segment) return NextResponse.json({ error: "Vorlesung nicht gefunden." }, { status: 404 });

  return NextResponse.json({
    segment,
    accepted: segment.status === "accepted",
    message: segment.status === "accepted"
      ? "Transkriptsegment wurde als Fragequelle übernommen."
      : "Transkriptsegment wurde gespeichert, aber nicht als Fragequelle übernommen."
  }, { status: 201 });
}
