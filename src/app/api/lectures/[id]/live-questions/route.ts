import { NextResponse } from "next/server";
import { z } from "zod";

import { questionsForSlide } from "@/lib/questions";
import type { Lecture } from "@/lib/types";
import { getLecturerSession, isValidLecturerCsrfRequest } from "@/server/auth";
import { generateLiveQuestionFamily, type LiveQuestionSlideContext } from "@/server/question-generation";
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
  allowSlideContext: z.boolean().optional()
});

function slideContext(lecture: Lecture, slideId: string): LiveQuestionSlideContext | null {
  const node = lecture.slideDocument?.slides.find((slide) => slide.id === slideId);
  if (node) {
    const lines: string[] = [];
    for (const element of node.canvas?.elements ?? []) {
      if (!element.isDeleted && element.type === "text" && element.text) lines.push(element.text);
    }
    // Native editable text is authoritative; old block projections may be stale.
    for (const block of node.canvas ? [] : node.blocks) {
      if (block.type === "heading" || block.type === "paragraph" || block.type === "quote") lines.push(block.text);
      else if (block.type === "callout") lines.push(block.text);
      else if (block.type === "bulletList" || block.type === "numberedList") lines.push(...block.items);
      else if (block.type === "formula") lines.push(block.latex ?? block.mathMl ?? "");
      else if (block.type === "definition") lines.push(`${block.term}: ${block.definition}`);
      else if (block.type === "scene3d") lines.push(`Interaktive Demonstration: ${block.altText}`);
    }
    for (const note of node.speakerNotes?.slice(0, 3) ?? []) lines.push(`Vortragsnotiz: ${note.text}`);
    return { title: node.title, lines: lines.filter(Boolean) };
  }
  const legacy = lecture.slides.find((slide) => slide.id === slideId);
  return legacy ? { title: legacy.title, lines: [legacy.topic, ...legacy.copy] } : null;
}

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

  const slide = slideContext(lecture, parsed.data.slideId);
  if (!slide) return NextResponse.json({ error: "Folie nicht gefunden." }, { status: 404 });

  let transcript = (parsed.data.transcript?.trim() || recentTranscript(lecture)).trim();
  const contextSource = transcript.length >= MIN_TRANSCRIPT_CHARS ? "transcript" : "slide";
  if (contextSource === "slide" && parsed.data.allowSlideContext) transcript = [slide.title, ...slide.lines].join("\n");
  if (transcript.length < MIN_TRANSCRIPT_CHARS) {
    return NextResponse.json({ error: "Das Transkript ist noch zu kurz für eine Frage." }, { status: 422 });
  }

  const existingQuestionTexts = questionsForSlide(lecture.questions, parsed.data.slideId).map((question) => question.text);
  let variants;
  try {
    variants = await generateLiveQuestionFamily({ lecture, slide, transcript, existingQuestionTexts, contextSource });
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
