import { NextResponse } from "next/server";
import { z } from "zod";

import { getLecturerSession, isValidLecturerCsrfRequest } from "@/server/auth";
import { readJsonBody } from "@/server/request-json";
import { getLectureRepository } from "@/server/repository";
import { isValidRouteEntityId } from "@/server/route-params";

const MAX_ASSET_REVIEW_BYTES = 4096;
// Asset-IDs sind UUIDs (Postgres) oder lokal generierte IDs wie "asset-<uuid>".
const ASSET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

const assetReviewSchema = z.object({
  review: z.enum(["confirmed", "discarded"])
});

export async function PATCH(request: Request, context: { params: Promise<unknown> }) {
  const session = await getLecturerSession();
  if (!session) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  if (!isValidLecturerCsrfRequest(request, session)) {
    return NextResponse.json({ error: "Sicherheitsprüfung fehlgeschlagen." }, { status: 403 });
  }

  const { id, assetId } = (await context.params) as { id: string; assetId: string };
  if (!isValidRouteEntityId(id) || !ASSET_ID_PATTERN.test(assetId)) {
    return NextResponse.json({ error: "Asset nicht gefunden." }, { status: 404 });
  }

  const bodyResult = await readJsonBody(request, MAX_ASSET_REVIEW_BYTES);
  if (!bodyResult.ok) return NextResponse.json({ error: "Asset konnte nicht aktualisiert werden." }, { status: bodyResult.status });

  const parsed = assetReviewSchema.safeParse(bodyResult.body);
  if (!parsed.success) return NextResponse.json({ error: "Asset konnte nicht aktualisiert werden." }, { status: 400 });

  const repository = getLectureRepository();
  const lecture = await repository.reviewPresentationAsset(id, assetId, parsed.data.review, session.email);
  if (!lecture) return NextResponse.json({ error: "Asset nicht gefunden." }, { status: 404 });

  const lectures = await repository.listLectures(session.email);
  return NextResponse.json({ lecture, lectures });
}
