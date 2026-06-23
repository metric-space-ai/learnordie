import { NextResponse } from "next/server";
import { z } from "zod";

import { createLecturerAssistantSourceNote } from "@/server/lecturer-assistant";
import { getLecturerSession, isValidLecturerCsrfRequest } from "@/server/auth";
import { getStorageProvider } from "@/server/providers/storage";
import { readJsonBody } from "@/server/request-json";
import { getLectureRepository } from "@/server/repository";
import { isValidRouteEntityId } from "@/server/route-params";

const MAX_ASSISTANT_ACTION_BYTES = 8192;

const sourceNoteSchema = z.object({
  slideId: z.string().min(1).optional(),
  message: z.string().max(1200).optional()
});

function safeStorageName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "assistentenquelle";
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

  const bodyResult = await readJsonBody(request, MAX_ASSISTANT_ACTION_BYTES);
  if (!bodyResult.ok) {
    return NextResponse.json({ error: "Quellen-Notiz konnte nicht gelesen werden." }, { status: bodyResult.status });
  }

  const parsed = sourceNoteSchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Quellen-Notiz konnte nicht angelegt werden." }, { status: 400 });
  }

  const repository = getLectureRepository();
  const lecture = (await repository.listLectures(session.email)).find((item) => item.id === id);
  if (!lecture) return NextResponse.json({ error: "Vorlesung nicht gefunden." }, { status: 404 });

  const note = createLecturerAssistantSourceNote({
    lecture,
    slideId: parsed.data.slideId,
    message: parsed.data.message
  });
  const existingMaterial = lecture.materials?.find((material) => material.originalName === note.originalName);
  const storageUrl = existingMaterial?.storageUrl ?? (await getStorageProvider().putText(
    `lectures/${id}/assistant-notes/${Date.now()}-${safeStorageName(note.originalName)}.txt`,
    note.content,
    "text/plain"
  )).url;

  const updatedLecture = await repository.createLecturerAssistantSourceNote({
    lectureId: id,
    slideId: note.slide?.id,
    originalName: note.originalName,
    storageUrl,
    sizeBytes: new TextEncoder().encode(note.content).length
  }, session.email);
  if (!updatedLecture) return NextResponse.json({ error: "Vorlesung nicht gefunden." }, { status: 404 });

  const lectures = await repository.listLectures(session.email);
  return NextResponse.json({ lecture: updatedLecture, lectures }, { status: 201 });
}
