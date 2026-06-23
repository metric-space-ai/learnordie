import crypto from "node:crypto";
import { NextResponse } from "next/server";

import { getLecturerSession, isValidLecturerCsrfToken } from "@/server/auth";
import { getJobProvider } from "@/server/providers/jobs";
import { getStorageProvider } from "@/server/providers/storage";
import { isDatabaseJobQueueEnabled } from "@/server/queued-jobs";
import { getLectureRepository } from "@/server/repository";
import { checkContentLength } from "@/server/request-size";
import { isValidRouteEntityId } from "@/server/route-params";

const MAX_ACTION_FORM_BYTES = 4096;

function sha256(input: Buffer) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function safeFileName(input: string) {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "learnbuddy-archive";
}

function clientSafeExportJobMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (
    message.includes("LEARNBUDDY_JOB_") ||
    message.includes("LEARNBUDDY_STORAGE_") ||
    message.includes("Job provider") ||
    message.includes("Storage provider") ||
    message.includes("Export route returned") ||
    message.includes("fetch failed") ||
    message.includes("Failed to parse URL")
  ) {
    return "Archivjob konnte nicht gestartet werden.";
  }
  return message || "Archiv konnte nicht erzeugt werden.";
}

export async function POST(request: Request, context: { params: Promise<unknown> }) {
  const session = await getLecturerSession();
  if (!session) return NextResponse.redirect(new URL("/lecturer/login", request.url), 303);

  const { id } = (await context.params) as { id: string };
  const redirectUrl = new URL("/lecturer", request.url);
  if (!isValidRouteEntityId(id)) {
    redirectUrl.searchParams.set("error", "lecture-not-found");
    return NextResponse.redirect(redirectUrl, 303);
  }

  const repository = getLectureRepository();
  const lecture = (await repository.listLectures(session.email)).find((item) => item.id === id);
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

  if (!lecture) {
    redirectUrl.searchParams.set("error", "lecture-not-found");
    return NextResponse.redirect(redirectUrl, 303);
  }

  const job = await repository.createStandaloneExportJob({
    lectureId: lecture.id,
    format: "archive_zip",
    requestedBy: session.email
  }, session.email);
  const startedAt = new Date();

  try {
    if (isDatabaseJobQueueEnabled()) {
      if (job) {
        await repository.updateStandaloneExportJob(job.id, {
          status: "queued",
          provider: "database",
          providerJobId: `database:standalone_archive:${job.id}`,
          message: "Archiv wartet auf Worker."
        });
      }
      redirectUrl.searchParams.set("notice", "export-job-queued");
      return NextResponse.redirect(redirectUrl, 303);
    }

    const jobProvider = getJobProvider();
    if (job) {
      await repository.updateStandaloneExportJob(job.id, {
        status: "running",
        provider: jobProvider.name,
        startedAt: startedAt.toISOString(),
        message: "Archiv wird erzeugt."
      });
    }

    const run = await jobProvider.run({
      jobId: job?.id ?? `standalone_export_${lecture.id}_${startedAt.getTime()}`,
      kind: "standalone_archive"
    }, async () => {
      const exportUrl = new URL(`/api/lecture/${lecture.publicToken}/export`, request.url);
      exportUrl.searchParams.set("format", "zip");
      exportUrl.searchParams.set("record", "0");
      const response = await fetch(exportUrl, { cache: "no-store" });

      if (!response.ok) {
        throw new Error(`Export route returned ${response.status}`);
      }

      const bytes = Buffer.from(await response.arrayBuffer());
      const version = response.headers.get("x-learnbuddy-export-version") ?? `standalone-archive-v1-${Date.now()}`;
      const checksum = response.headers.get("x-learnbuddy-sha256") ?? sha256(bytes);
      const storage = await getStorageProvider().putBytes(
        `lectures/${lecture.id}/exports/${safeFileName(`${lecture.publicToken}-${version}.zip`)}`,
        bytes,
        "application/zip"
      );

      const exportRecord = await repository.recordStandaloneExport({
        lectureId: lecture.id,
        version,
        storageUrl: storage.url,
        sha256: checksum
      }, session.email);

      return { storageUrl: storage.url, checksum, exportRecordId: exportRecord?.id };
    });

    if (job) {
      const completedAt = new Date();
      await repository.updateStandaloneExportJob(job.id, {
        status: "succeeded",
        provider: run.provider,
        providerJobId: run.providerJobId,
        standaloneExportId: run.result.exportRecordId,
        storageUrl: run.result.storageUrl,
        sha256: run.result.checksum,
        completedAt: completedAt.toISOString(),
        durationMs: completedAt.getTime() - startedAt.getTime(),
        message: "Archiv gespeichert."
      });
    }

    redirectUrl.searchParams.set("notice", "export-job-succeeded");
    return NextResponse.redirect(redirectUrl, 303);
  } catch (error) {
    if (job) {
      const completedAt = new Date();
      await repository.updateStandaloneExportJob(job.id, {
        status: "failed",
        completedAt: completedAt.toISOString(),
        durationMs: completedAt.getTime() - startedAt.getTime(),
        message: clientSafeExportJobMessage(error)
      });
    }

    redirectUrl.searchParams.set("error", "export-job-failed");
    return NextResponse.redirect(redirectUrl, 303);
  }
}
