import { NextResponse } from "next/server";

import { getLecturerSession, isValidLecturerCsrfRequest } from "@/server/auth";
import { getLectureRepository } from "@/server/repository";
import { isValidRouteEntityId } from "@/server/route-params";

export async function DELETE(request: Request, context: { params: Promise<unknown> }) {
  const session = await getLecturerSession();
  if (!session) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  if (!isValidLecturerCsrfRequest(request, session)) {
    return NextResponse.json({ error: "Sicherheitsprüfung fehlgeschlagen." }, { status: 403 });
  }

  const { id, materialId } = (await context.params) as { id: string; materialId: string };
  if (!isValidRouteEntityId(id) || !isValidRouteEntityId(materialId)) {
    return NextResponse.json({ error: "Material nicht gefunden." }, { status: 404 });
  }

  const repository = getLectureRepository();
  const lecture = await repository.deleteMaterial(id, materialId, session.email);
  if (!lecture) return NextResponse.json({ error: "Material nicht gefunden." }, { status: 404 });

  const lectures = await repository.listLectures(session.email);
  return NextResponse.json({ lecture, lectures });
}
