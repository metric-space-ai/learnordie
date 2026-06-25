import { NextResponse } from "next/server";
import { z } from "zod";

import { getLecturerSession, isValidLecturerCsrfRequest } from "@/server/auth";
import { readJsonBody } from "@/server/request-json";
import { getLectureRepository } from "@/server/repository";
import { isValidRouteEntityId } from "@/server/route-params";

const MAX_AGENT_ACCEPT_BYTES = 8 * 1024;

const acceptAgentThreadSchema = z.object({
  operationIds: z.array(z.string().min(1).max(180)).max(40).optional()
}).default({});

export async function POST(request: Request, context: { params: Promise<unknown> }) {
  const session = await getLecturerSession();
  if (!session) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  if (!isValidLecturerCsrfRequest(request, session)) {
    return NextResponse.json({ error: "Sicherheitsprüfung fehlgeschlagen." }, { status: 403 });
  }

  const { id, threadId } = (await context.params) as { id: string; threadId: string };
  if (!isValidRouteEntityId(id) || !isValidRouteEntityId(threadId)) {
    return NextResponse.json({ error: "Agent-Thread nicht gefunden." }, { status: 404 });
  }

  const bodyResult = await readJsonBody(request, MAX_AGENT_ACCEPT_BYTES);
  const body = bodyResult.ok ? bodyResult.body : {};
  const parsed = acceptAgentThreadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Agent-Patch konnte nicht gelesen werden." }, { status: 400 });
  }

  const repository = getLectureRepository();
  const lecture = await repository.acceptAgentThread({
    lectureId: id,
    threadId,
    operationIds: parsed.data.operationIds
  }, session.email);
  if (!lecture) return NextResponse.json({ error: "Agent-Thread nicht gefunden." }, { status: 404 });

  const lectures = await repository.listLectures(session.email);
  return NextResponse.json({ lecture, lectures });
}
