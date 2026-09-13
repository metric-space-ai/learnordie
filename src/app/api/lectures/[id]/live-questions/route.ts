import { NextResponse } from "next/server";
import { z } from "zod";

import { questionsForSlide } from "@/lib/questions";
import { getLecturerSession, isValidLecturerCsrfRequest } from "@/server/auth";
import { acceptedTranscriptContext, generateLiveQuestionFamily, liveQuestionSlideContext } from "@/server/question-generation";
import { liveLecture, readLiveSession } from "@/server/live-session-repository";
import { readJsonBody } from "@/server/request-json";
import { getLectureRepository } from "@/server/repository";
import { isValidRouteEntityId } from "@/server/route-params";

// Eine KI-Anfrage dauert bis zu 45 s; die Funktion braucht etwas Reserve.
export const maxDuration = 60;

const MAX_BODY_BYTES = 16_384;
const MIN_TRANSCRIPT_CHARS = 120;

const liveQuestionSchema = z.object({
  slideId: z.string().min(1).max(120),
  transcript: z.string().max(8000).optional(),
  allowSlideContext: z.boolean().optional(),
  mode: z.enum(["transcript-only"]).optional()
});

function recentTranscript(lecture: Lecture) {
  return (lecture.transcriptSegments ?? [])
    .filter((segment) => segment.status === "accepted")
    .slice(0, 8)
    .reverse()
    .map((segment) => segment.text)
    .join(" ");
}

function clientSafeError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("timed out")) return "Die KI hat nicht rechtzeitig geantwortet. Die nächste Passage versucht es erneut.";
  if (message.includes("not configured") || /API_KEY.*is required/.test(message)) {
    return "Der Fragengenerator ist nicht konfiguriert. Bitte die KI-Zugangsdaten der Bereitstellung prüfen. Vorbereitete Fragen bleiben verfügbar.";
  }
  if (message.includes("duplicate")) return "Die KI hat eine bereits vorhandene Frage erzeugt; sie wurde verworfen.";
  return "Aus dieser Passage konnte keine gültige Frage erzeugt werden.";
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

  const bodyResult = await readJsonBody(request, MAX_BODY_BYTES);
  if (!bodyResult.ok) return NextResponse.json({ error: "Ungültige Anfrage." }, { status: bodyResult.status });
  const parsed = liveQuestionSchema.safeParse(bodyResult.body);
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });

  const repository = getLectureRepository();
  const lecture = (await repository.listLectures(session.email)).find((item) => item.id === id);
  if (!lecture) return NextResponse.json({ error: "Vorlesung nicht gefunden." }, { status: 404 });

  const slide = liveQuestionSlideContext(lecture, parsed.data.slideId);
  if (!slide) return NextResponse.json({ error: "Folie nicht gefunden." }, { status: 404 });

  let transcript = (parsed.data.transcript?.trim() || recentTranscript(lecture)).trim();
  let latestTranscript: string | undefined;
  if (parsed.data.mode === "transcript-only") {
    try {
      const liveContext = await liveLecture(lecture.publicToken, session.email);
      const live = await readLiveSession(liveContext, null, false);
      if (live.status !== "active" || live.sessionStartedAt === null) {
        return NextResponse.json({ error: "Für diese Live-Sitzung ist noch kein aktueller Transkriptabschnitt verfügbar." }, { status: 422 });
      }
      const current = acceptedTranscriptContext(lecture, live.sessionStartedAt);
      if (current.segmentCount === 0 || current.latestAt === null || Date.now() - current.latestAt > 120_000 || current.accumulated.length < MIN_TRANSCRIPT_CHARS) {
        return NextResponse.json({ error: "Das aktuelle Live-Transkript ist noch zu kurz für eine Frage." }, { status: 422 });
      }
      const supplied = parsed.data.transcript?.trim() ?? "";
      transcript = supplied && !current.accumulated.includes(supplied) && !supplied.includes(current.accumulated)
        ? `${current.accumulated} ${supplied}`.trim()
        : (supplied.length > current.accumulated.length ? supplied : current.accumulated);
      latestTranscript = current.latest;
      if (transcript.length < MIN_TRANSCRIPT_CHARS) {
        return NextResponse.json({ error: "Das aktuelle Live-Transkript ist noch zu kurz für eine Frage." }, { status: 422 });
      }
    } catch (error) {
      console.warn("transcript-only live context unavailable", error instanceof Error ? error.message : error);
      return NextResponse.json({ error: "Das aktuelle Live-Transkript ist nicht verfügbar. Bitte die nächste Passage abwarten." }, { status: 503 });
    }
  }

  const contextSource = parsed.data.mode === "transcript-only"
    ? "transcript"
    : transcript.length >= MIN_TRANSCRIPT_CHARS ? "transcript" : "slide";
  if (contextSource === "slide" && parsed.data.allowSlideContext) transcript = [slide.title, ...slide.lines].join("\n");
  if (parsed.data.mode === "transcript-only" && contextSource !== "transcript") {
    return NextResponse.json({ error: "Für diese Frage ist ein aktuelles Live-Transkript erforderlich." }, { status: 422 });
  }
  if (transcript.length < MIN_TRANSCRIPT_CHARS) {
    return NextResponse.json({ error: "Das Transkript ist noch zu kurz für eine Frage." }, { status: 422 });
  }

  const existingQuestionTexts = questionsForSlide(lecture.questions, parsed.data.slideId).map((question) => question.text);
  let variants;
  try {
    variants = await generateLiveQuestionFamily({
      lecture,
      slide,
      transcript,
      latestTranscript,
      scriptContext: await repository.getLectureScriptContext(id, session.email, transcript),
      existingQuestionTexts,
      contextSource,
      transcriptOnly: parsed.data.mode === "transcript-only"
    });
  } catch (error) {
    console.warn("live question generation failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: clientSafeError(error) }, { status: 502 });
  }

  const updated = await repository.appendQuestionFamily(
    id,
    { slideId: parsed.data.slideId, source: contextSource === "slide" ? "live_slide" : "live_transcript", variants },
    session.email
  );
  if (!updated) return NextResponse.json({ error: "Vorlesung nicht gefunden." }, { status: 404 });

  return NextResponse.json({
    questions: updated.questions,
    // Return this request's family, never a concurrently generated family.
    family: updated.questions.filter((question) => question.familyId === updated.appendedFamilyId)
  });
}
