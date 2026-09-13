import { NextResponse } from "next/server";
import { z } from "zod";

import { PSEUDONYM_MAX_LENGTH, validateClaimablePseudonym } from "@/lib/student-pseudonym";
import { getAnalyticsRepository } from "@/server/analytics-repository";
import { readJsonBody } from "@/server/request-json";
import { getStudentRepository } from "@/server/student-repository";
import { getCurrentStudentProfile, getStudentAnonymousKey, isValidAnonymousKey, setStudentCookie, toPublicProfile } from "@/server/student-session";

const MAX_PROFILE_BYTES = 4 * 1024;

const profileSchema = z.object({
  anonymousKey: z.string().refine(isValidAnonymousKey, "Ungültiger Schlüssel."),
  pseudonym: z.string().trim().min(1).max(PSEUDONYM_MAX_LENGTH).optional(),
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

  if (parsed.data.pseudonym && !validateClaimablePseudonym(parsed.data.pseudonym)) {
    return NextResponse.json({ error: "Bitte ein gültiges Pseudonym wählen (kein Klarname)." }, { status: 400 });
  }

  const repository = getStudentRepository();
  // The browser key bootstraps a profile only before a cookie identity exists.
  // Once established, an arbitrary request body must not rotate server identity.
  const anonymousKey = (await getStudentAnonymousKey()) ?? parsed.data.anonymousKey;
  const existing = await repository.getProfileByAnonymousKey(anonymousKey);
  const profile = await repository.getOrCreateStudentProfile({ ...parsed.data, anonymousKey });
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
