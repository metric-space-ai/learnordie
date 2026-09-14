import { NextResponse } from "next/server";
import { z } from "zod";

import { PSEUDONYM_MAX_LENGTH, validateClaimablePseudonym } from "@/lib/student-pseudonym";
import { readJsonBody } from "@/server/request-json";
import { ClaimRequiredError, getStudentRepository, PseudonymTakenError } from "@/server/student-repository";
import { getCurrentStudentProfile } from "@/server/student-session";

export async function GET(request: Request) {
  const seriesId = new URL(request.url).searchParams.get("seriesId")?.trim() ?? "";
  const profile = await getCurrentStudentProfile();
  if (!profile || !seriesId) {
    return NextResponse.json({ claim: null });
  }
  const claim = await getStudentRepository().getActiveClaim(profile.id, seriesId);
  return NextResponse.json({
    claim: claim?.displayName
      ? { displayName: claim.displayName, seriesId: claim.seriesId, status: claim.status }
      : null
  });
}

const claimSchema = z.object({
  seriesId: z.string().trim().min(1).max(80),
  displayName: z.string().trim().min(2).max(PSEUDONYM_MAX_LENGTH)
});

export async function POST(request: Request) {
  const profile = await getCurrentStudentProfile();
  if (!profile) {
    return NextResponse.json({ error: "Bitte zuerst ein Pseudonym wählen.", code: "claim_required" }, { status: 401 });
  }

  const bodyResult = await readJsonBody(request, 4 * 1024);
  if (!bodyResult.ok) {
    return NextResponse.json({ error: "Name konnte nicht gespeichert werden." }, { status: bodyResult.status });
  }

  const parsed = claimSchema.safeParse(bodyResult.body);
  if (!parsed.success || !validateClaimablePseudonym(parsed.data.displayName)) {
    return NextResponse.json({ error: "Bitte ein gültiges Pseudonym wählen (kein Klarname)." }, { status: 400 });
  }

  const repository = getStudentRepository();
  try {
    const claim = await repository.claimDisplayName(profile.id, parsed.data.seriesId, parsed.data.displayName);
    return NextResponse.json({
      claim: {
        displayName: claim.displayName,
        seriesId: claim.seriesId,
        status: claim.status
      }
    });
  } catch (error) {
    if (error instanceof PseudonymTakenError) {
      const suggestions = await repository.listAvailablePseudonyms(
        parsed.data.seriesId,
        3,
        profile.id,
        [parsed.data.displayName]
      );
      return NextResponse.json(
        {
          error: "Dieses Pseudonym ist in dieser Vorlesung schon vergeben.",
          code: "pseudonym_taken",
          suggestions
        },
        { status: 409 }
      );
    }
    if (error instanceof ClaimRequiredError) {
      return NextResponse.json({ error: error.message, code: "claim_required" }, { status: 409 });
    }
    if (error instanceof Error && error.message === "INVALID_PSEUDONYM") {
      return NextResponse.json({ error: "Bitte ein gültiges Pseudonym wählen (kein Klarname)." }, { status: 400 });
    }
    throw error;
  }
}
