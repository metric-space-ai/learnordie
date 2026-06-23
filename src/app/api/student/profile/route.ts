import { NextResponse } from "next/server";
import { z } from "zod";

import { getAnalyticsRepository } from "@/server/analytics-repository";
import { readJsonBody } from "@/server/request-json";
import { getStudentRepository } from "@/server/student-repository";
import { getCurrentStudentProfile, isValidAnonymousKey, setStudentCookie, toPublicProfile } from "@/server/student-session";

const MAX_PROFILE_BYTES = 4 * 1024;

const profileSchema = z.object({
  anonymousKey: z.string().refine(isValidAnonymousKey, "Ungültiger Schlüssel."),
  pseudonym: z.string().trim().min(1).max(80).optional(),
  locale: z.string().trim().min(2).max(10).optional()
});

export async function GET() {
  const profile = await getCurrentStudentProfile();
  return NextResponse.json({ profile: profile ? toPublicProfile(profile) : null });
}

export async function POST(request: Request) {
  const bodyResult = await readJsonBody(request, MAX_PROFILE_BYTES);
  if (!bodyResult.ok) {
    return NextResponse.json({ error: "Profil konnte nicht gespeichert werden." }, { status: bodyResult.status });
  }

  const parsed = profileSchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Bitte ein gültiges Pseudonym wählen (kein Klarname)." }, { status: 400 });
  }

  const repository = getStudentRepository();
  const existing = await repository.getProfileByAnonymousKey(parsed.data.anonymousKey);
  const profile = await repository.getOrCreateStudentProfile(parsed.data);
  await setStudentCookie(profile.anonymousKey);

  if (!existing) {
    await getAnalyticsRepository().recordEvent({
      eventType: "student_profile_created",
      payload: { locale: profile.locale },
      anonymousKey: profile.anonymousKey,
      pseudonym: profile.pseudonym
    });
  }

  return NextResponse.json({ profile: toPublicProfile(profile) });
}
