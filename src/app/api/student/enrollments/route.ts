import { NextResponse } from "next/server";
import { z } from "zod";

import { getAnalyticsRepository } from "@/server/analytics-repository";
import { readJsonBody } from "@/server/request-json";
import { getStudentRepository } from "@/server/student-repository";
import { getCurrentStudentProfile } from "@/server/student-session";

const MAX_ENROLL_BYTES = 4 * 1024;

const enrollSchema = z.union([
  z.object({
    joinCodeId: z.string().trim().min(1).max(120),
    source: z.enum(["code", "direct_live_link", "direct_learn_link", "lecturer_invite"]).optional()
  }),
  z.object({
    seriesId: z.string().trim().min(1).max(80),
    seriesTitle: z.string().trim().min(1).max(160),
    lectureId: z.string().trim().min(1).max(120).optional(),
    source: z.enum(["code", "direct_live_link", "direct_learn_link", "lecturer_invite"])
  })
]);

export async function POST(request: Request) {
  const profile = await getCurrentStudentProfile();
  if (!profile) {
    return NextResponse.json({ error: "Bitte zuerst ein Pseudonym wählen." }, { status: 401 });
  }

  const bodyResult = await readJsonBody(request, MAX_ENROLL_BYTES);
  if (!bodyResult.ok) {
    return NextResponse.json({ error: "Vorlesung konnte nicht hinzugefügt werden." }, { status: bodyResult.status });
  }

  const parsed = enrollSchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });
  }

  const repository = getStudentRepository();
  const enrollment =
    "joinCodeId" in parsed.data
      ? await repository.createEnrollmentFromJoinCode(profile.id, parsed.data.joinCodeId, parsed.data.source ?? "code")
      : await repository.createDirectEnrollment(profile.id, {
          seriesId: parsed.data.seriesId,
          seriesTitle: parsed.data.seriesTitle,
          lectureId: parsed.data.lectureId,
          source: parsed.data.source
        });

  if (!enrollment) {
    return NextResponse.json({ error: "Diese Vorlesung konnte nicht hinzugefügt werden." }, { status: 404 });
  }

  await getAnalyticsRepository().recordEvent({
    eventType: "student_enrolled",
    payload: { seriesId: enrollment.seriesId, source: enrollment.source },
    anonymousKey: profile.anonymousKey,
    pseudonym: profile.pseudonym
  });

  return NextResponse.json({ enrollment });
}
