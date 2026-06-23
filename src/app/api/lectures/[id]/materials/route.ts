import { NextResponse } from "next/server";

import {
  MaterialLectureAccessError,
  MaterialUploadLimitError,
  addLectureMaterialsFromForm,
  formatBytes,
  getMaterialUploadRequestLimitBytes,
  materialUploadErrorMessage
} from "@/server/material-actions";
import { getLecturerSession, isValidLecturerCsrfRequest } from "@/server/auth";
import { getLectureRepository } from "@/server/repository";
import { checkContentLength } from "@/server/request-size";
import { isValidRouteEntityId } from "@/server/route-params";

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

  const bodySize = checkContentLength(request, getMaterialUploadRequestLimitBytes());
  if (!bodySize.ok) {
    return NextResponse.json({
      error: `Upload-Anfrage zu groß: ${formatBytes(bodySize.sizeBytes)}. Erlaubt sind ${formatBytes(bodySize.maxBytes)} inklusive Formulardaten.`,
      code: "material_request_too_large",
      maxBytes: bodySize.maxBytes,
      sizeBytes: bodySize.sizeBytes
    }, { status: bodySize.status });
  }

  const formData = await request.formData();
  let created;
  try {
    created = await addLectureMaterialsFromForm(id, formData, session.email);
  } catch (error) {
    if (error instanceof MaterialLectureAccessError) {
      return NextResponse.json({ error: "Vorlesung nicht gefunden." }, { status: 404 });
    }
    if (error instanceof MaterialUploadLimitError) {
      return NextResponse.json({
        error: materialUploadErrorMessage(error),
        code: error.code,
        maxBytes: error.maxBytes,
        sizeBytes: error.sizeBytes
      }, { status: 413 });
    }
    throw error;
  }
  const repository = getLectureRepository();

  if (created.length === 0) {
    return NextResponse.json({ error: "Kein Material übergeben." }, { status: 400 });
  }

  const lectures = await repository.listLectures(session.email);
  return NextResponse.json({ materials: created, lectures }, { status: 201 });
}
