import { NextResponse } from "next/server";

import { getLecturerSession, isValidLecturerCsrfToken } from "@/server/auth";
import { isDatabaseJobQueueEnabled } from "@/server/queued-jobs";
import { getLectureRepository } from "@/server/repository";
import { checkContentLength } from "@/server/request-size";
import { isValidRouteEntityId } from "@/server/route-params";

const MAX_ACTION_FORM_BYTES = 4096;

export async function POST(request: Request, context: { params: Promise<unknown> }) {
  const session = await getLecturerSession();
  if (!session) return NextResponse.redirect(new URL("/lecturer/login", request.url), 303);

  const { id } = (await context.params) as { id: string };
  const redirectUrl = new URL("/lecturer", request.url);
  if (!isValidRouteEntityId(id)) {
    redirectUrl.searchParams.set("error", "lecture-not-found");
    return NextResponse.redirect(redirectUrl, 303);
  }

  const bodySize = checkContentLength(request, MAX_ACTION_FORM_BYTES);
  if (!bodySize.ok) {
    redirectUrl.searchParams.set("error", "request-too-large");
    return NextResponse.redirect(redirectUrl, 303);
  }

  const formData = await request.formData().catch(() => new FormData());
  if (!isValidLecturerCsrfToken(formData.get("csrfToken")?.toString(), session)) {
    redirectUrl.searchParams.set("error", "csrf");
    return NextResponse.redirect(redirectUrl, 303);
  }

  try {
    const repository = getLectureRepository();
    const lecture = isDatabaseJobQueueEnabled()
      ? await repository.enqueueMaterialProcessingRun?.(id, session.email)
      : await repository.processMaterials(id, session.email);
    redirectUrl.searchParams.set(lecture ? "notice" : "error", lecture ? (isDatabaseJobQueueEnabled() ? "material-queued" : "material-processed") : "lecture-not-found");
  } catch {
    redirectUrl.searchParams.set("error", "material-processing-failed");
  }
  return NextResponse.redirect(redirectUrl, 303);
}
