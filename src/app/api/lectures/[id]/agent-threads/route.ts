import { NextResponse } from "next/server";
import { z } from "zod";

import { getLecturerSession, isValidLecturerCsrfRequest } from "@/server/auth";
import { readJsonBody } from "@/server/request-json";
import { getLectureRepository } from "@/server/repository";
import { isValidRouteEntityId } from "@/server/route-params";

const MAX_AGENT_THREAD_BYTES = 16 * 1024;

const createAgentThreadSchema = z.object({
  mode: z.enum(["studio_slide_edit", "lecturer_assistant", "quiz_authoring", "material_processing", "qa_repair"]).default("studio_slide_edit"),
  prompt: z.string().min(1).max(2000),
  slideId: z.string().min(1).optional(),
  blockId: z.string().min(1).max(160).optional(),
  assetId: z.string().min(1).max(160).optional(),
  studentContext: z.unknown().optional()
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

  const bodyResult = await readJsonBody(request, MAX_AGENT_THREAD_BYTES);
  if (!bodyResult.ok) {
    return NextResponse.json({ error: "Agent-Prompt konnte nicht gelesen werden." }, { status: bodyResult.status });
  }

  const parsed = createAgentThreadSchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Agent-Prompt ist ungültig." }, { status: 400 });
  }

  const repository = getLectureRepository();
  const thread = await repository.createAgentThread({
    lectureId: id,
    mode: parsed.data.mode,
    prompt: parsed.data.prompt,
    slideId: parsed.data.slideId,
    blockId: parsed.data.blockId,
    assetId: parsed.data.assetId,
    studentContext: parsed.data.studentContext
  }, session.email);

  if (!thread) return NextResponse.json({ error: "Vorlesung nicht gefunden." }, { status: 404 });

  const lectures = await repository.listLectures(session.email);
  const lecture = lectures.find((item) => item.id === id) ?? null;
  return NextResponse.json({ thread, lecture, lectures });
}
