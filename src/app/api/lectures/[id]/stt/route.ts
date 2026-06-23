import { NextResponse } from "next/server";
import { z } from "zod";

import { getLecturerSession, isValidLecturerCsrfRequest } from "@/server/auth";
import { getSTTProvider } from "@/server/providers/stt";
import { getLectureRepository } from "@/server/repository";
import { checkContentLength } from "@/server/request-size";
import { isValidRouteEntityId } from "@/server/route-params";
import { normalizeTranscriptTimeRange } from "@/server/transcript-time";

const MAX_STT_AUDIO_BYTES = 5_000_000;
const MAX_STT_FORM_BYTES = MAX_STT_AUDIO_BYTES + 64 * 1024;
const sttMetaSchema = z.object({
  slideTopic: z.string().max(120).optional()
});

function isFileLike(value: FormDataEntryValue | null): value is File {
  if (!value || typeof value !== "object") return false;
  return true
    && "arrayBuffer" in value
    && typeof value.arrayBuffer === "function"
    && "size" in value
    && typeof value.size === "number";
}

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

  const repository = getLectureRepository();
  const lecture = (await repository.listLectures(session.email)).find((item) => item.id === id);
  if (!lecture) return NextResponse.json({ error: "Vorlesung nicht gefunden." }, { status: 404 });

  const bodySize = checkContentLength(request, MAX_STT_FORM_BYTES);
  if (!bodySize.ok) {
    return NextResponse.json({ error: "Audiopassage ist zu groß." }, { status: bodySize.status });
  }

  const formData = await request.formData();
  const audio = formData.get("audio");
  if (!isFileLike(audio) || audio.size < 1) {
    return NextResponse.json({ error: "Keine Audiodaten empfangen." }, { status: 400 });
  }
  if (audio.size > MAX_STT_AUDIO_BYTES) {
    return NextResponse.json({ error: "Audiopassage ist zu groß." }, { status: 413 });
  }

  const meta = sttMetaSchema.safeParse({
    slideTopic: formData.get("slideTopic")?.toString()
  });
  if (!meta.success) {
    return NextResponse.json({ error: "Ungültige STT-Metadaten." }, { status: 400 });
  }

  const fallbackEndedAt = new Date();
  const fallbackStartedAt = new Date(fallbackEndedAt.getTime() - 5000);
  const timeRange = normalizeTranscriptTimeRange({
    startedAt: formData.get("startedAt")?.toString() || fallbackStartedAt.toISOString(),
    endedAt: formData.get("endedAt")?.toString() || fallbackEndedAt.toISOString()
  }, fallbackEndedAt);
  if (!timeRange.ok || !timeRange.startedAt || !timeRange.endedAt) {
    return NextResponse.json({ error: "Ungültige STT-Metadaten." }, { status: 400 });
  }

  let result;
  try {
    const provider = getSTTProvider();
    result = await provider.transcribeAudio({
      audio: await audio.arrayBuffer(),
      mimeType: audio.type || "application/octet-stream",
      lectureTitle: lecture.title,
      language: lecture.language,
      slideTopic: meta.data.slideTopic
    });
  } catch (error) {
    console.error("STT provider failed", error);
    return NextResponse.json({ error: "STT konnte nicht ausgeführt werden." }, { status: 502 });
  }

  return NextResponse.json({
    ...result,
    startedAt: timeRange.startedAt,
    endedAt: timeRange.endedAt,
    status: "transcribed"
  });
}
