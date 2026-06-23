import { NextResponse } from "next/server";

import { getLecturerSession, isValidLecturerCsrfRequest } from "@/server/auth";
import { getLectureRepository } from "@/server/repository";
import { isDatabaseJobQueueEnabled } from "@/server/queued-jobs";
import type { Lecture, MaterialProcessingRun, MaterialProcessingStep } from "@/lib/types";
import { isValidRouteEntityId } from "@/server/route-params";

function clientSafeProcessingError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("LEARNBUDDY_EMBEDDING_BASE_URL")) {
    return "Embedding-Provider ist nicht korrekt konfiguriert.";
  }
  if (message.includes("Embedding provider request failed") || message.includes("Embedding provider request timed out")) {
    return "Embedding-Provider konnte nicht antworten.";
  }
  if (message.includes("Embedding provider returned")) {
    return "Embedding-Provider hat ein ungültiges Vektorformat geliefert.";
  }
  if (message.includes("Question generator is not configured")) {
    return "Fragegenerator ist nicht korrekt konfiguriert.";
  }
  if (message.includes("Question generator request failed") || message.includes("Question generator request timed out")) {
    return "Fragegenerator konnte nicht antworten.";
  }
  if (message.includes("Question generator returned")) {
    return "Fragegenerator hat ungültige Fragen geliefert.";
  }
  if (
    message.includes("LEARNBUDDY_JOB_") ||
    message.includes("Job provider request") ||
    message.includes("Job provider is not")
  ) {
    return "Materialverarbeitung konnte nicht gestartet werden.";
  }
  if (
    message.includes("LEARNBUDDY_STORAGE_") ||
    message.includes("Storage provider request") ||
    message.includes("Storage provider is not")
  ) {
    return "Materialverarbeitung konnte nicht gestartet werden.";
  }
  return "Materialverarbeitung fehlgeschlagen.";
}

function safeProcessingMessage(value?: string) {
  return clientSafeProcessingError(value ? new Error(value) : undefined);
}

function sanitizeProcessingStep(step: MaterialProcessingStep): MaterialProcessingStep {
  if (step.status !== "failed") return step;
  return {
    ...step,
    detail: safeProcessingMessage(step.detail)
  };
}

function sanitizeProcessingRun(run: MaterialProcessingRun): MaterialProcessingRun {
  if (run.status !== "failed" && run.status !== "dead_letter") return run;
  return {
    ...run,
    message: safeProcessingMessage(run.message),
    steps: run.steps.map(sanitizeProcessingStep)
  };
}

function sanitizeProcessingRuns(lecture: Lecture): Lecture {
  return {
    ...lecture,
    materialProcessingRuns: lecture.materialProcessingRuns?.map(sanitizeProcessingRun)
  };
}

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

  const repository = getLectureRepository();
  let lecture;
  try {
    if (isDatabaseJobQueueEnabled()) {
      if (!repository.enqueueMaterialProcessingRun) {
        throw new Error("LEARNBUDDY_JOB_PROVIDER=database requires Postgres repository.");
      }
      lecture = await repository.enqueueMaterialProcessingRun(id, session.email);
    } else {
      lecture = await repository.processMaterials(id, session.email);
    }
  } catch (error) {
    const lectures = await repository.listLectures(session.email);
    return NextResponse.json({
      error: clientSafeProcessingError(error),
      lectures: lectures.map(sanitizeProcessingRuns)
    }, { status: 500 });
  }
  if (!lecture) return NextResponse.json({ error: "Vorlesung nicht gefunden." }, { status: 404 });

  const lectures = await repository.listLectures(session.email);
  return NextResponse.json({ lecture, lectures, queued: isDatabaseJobQueueEnabled() }, {
    status: isDatabaseJobQueueEnabled() ? 202 : 200
  });
}
