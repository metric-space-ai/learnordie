import { NextResponse } from "next/server";
import { z } from "zod";

import { getAnalyticsRepository } from "@/server/analytics-repository";
import { readJsonBody } from "@/server/request-json";
import { getStudentRepository } from "@/server/student-repository";
import { getStudentAnonymousKey } from "@/server/student-session";

const MAX_RESOLVE_BYTES = 2 * 1024;

const resolveSchema = z.object({
  code: z.string().trim().min(1).max(120)
});

export async function POST(request: Request) {
  const bodyResult = await readJsonBody(request, MAX_RESOLVE_BYTES);
  if (!bodyResult.ok) {
    return NextResponse.json({ error: "Code konnte nicht geprüft werden." }, { status: bodyResult.status });
  }

  const parsed = resolveSchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Bitte einen gültigen Code eingeben." }, { status: 400 });
  }

  const resolved = await getStudentRepository().resolveJoinCode(parsed.data.code);
  if (!resolved) {
    // No demo fallback: unknown codes are a clear, honest error.
    return NextResponse.json({ error: "Diesen Code kennen wir nicht. Bitte prüfen und erneut eingeben." }, { status: 404 });
  }

  await getAnalyticsRepository().recordEvent({
    eventType: "join_code_resolved",
    payload: { scope: resolved.scope, seriesId: resolved.seriesId },
    anonymousKey: (await getStudentAnonymousKey()) ?? undefined
  });

  return NextResponse.json({ target: resolved });
}
