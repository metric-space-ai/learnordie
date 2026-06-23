import { NextResponse } from "next/server";

import { getLecturerSession, isValidLecturerCsrfToken } from "@/server/auth";
import {
  MaterialLectureAccessError,
  MaterialUploadLimitError,
  addLectureMaterialsFromForm,
  getMaterialUploadRequestLimitBytes,
  materialUploadErrorMessage
} from "@/server/material-actions";
import { checkContentLength } from "@/server/request-size";
import { isValidRouteEntityId } from "@/server/route-params";

export async function POST(request: Request, context: { params: Promise<unknown> }) {
  const session = await getLecturerSession();
  if (!session) return NextResponse.redirect(new URL("/lecturer/login", request.url), 303);

  const { id } = (await context.params) as { id: string };
  const redirectUrl = new URL("/lecturer", request.url);
  redirectUrl.searchParams.set("tool", "materials");
  if (!isValidRouteEntityId(id)) {
    redirectUrl.searchParams.set("error", "lecture-not-found");
    return NextResponse.redirect(redirectUrl, 303);
  }

  const bodySize = checkContentLength(request, getMaterialUploadRequestLimitBytes());
  if (!bodySize.ok) {
    redirectUrl.searchParams.set("error", "upload-too-large");
    redirectUrl.searchParams.set("message", "Upload-Anfrage zu groß. Bitte kleinere Quelle wählen.");
    return NextResponse.redirect(redirectUrl, 303);
  }

  const formData = await request.formData().catch(() => new FormData());

  if (!isValidLecturerCsrfToken(formData.get("csrfToken")?.toString(), session)) {
    redirectUrl.searchParams.set("error", "csrf");
    return NextResponse.redirect(redirectUrl, 303);
  }

  let created;
  try {
    created = await addLectureMaterialsFromForm(id, formData, session.email);
  } catch (error) {
    if (error instanceof MaterialLectureAccessError) {
      redirectUrl.searchParams.set("error", "lecture-not-found");
      return NextResponse.redirect(redirectUrl, 303);
    }
    if (error instanceof MaterialUploadLimitError) {
      redirectUrl.searchParams.set("error", "upload-too-large");
      redirectUrl.searchParams.set("message", materialUploadErrorMessage(error));
      return NextResponse.redirect(redirectUrl, 303);
    }
    redirectUrl.searchParams.set("error", "material-upload-failed");
    return NextResponse.redirect(redirectUrl, 303);
  }

  redirectUrl.searchParams.set(created.length > 0 ? "notice" : "error", created.length > 0 ? "material-added" : "missing-material");
  return NextResponse.redirect(redirectUrl, 303);
}
