import { NextResponse } from "next/server";
import { z } from "zod";

import type { Lecture, LecturerAssistantToolPlanItem } from "@/lib/types";
import { createLecturerAssistantSourceNote } from "@/server/lecturer-assistant";
import { getLecturerSession, isValidLecturerCsrfRequest } from "@/server/auth";
import { getStorageProvider } from "@/server/providers/storage";
import { readJsonBody } from "@/server/request-json";
import { getLectureRepository } from "@/server/repository";
import { isValidRouteEntityId } from "@/server/route-params";

const MAX_ASSISTANT_PLAN_BYTES = 4096;

const applyPlanSchema = z.object({
  slideId: z.string().min(1).optional()
});

function safeStorageName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "assistentenquelle";
}

function latestAssistantWithToolPlan(lecture: Lecture, slideId?: string) {
  const messages = [...(lecture.assistantMessages ?? [])].reverse();
  return messages.find((message) => {
    if (message.role !== "assistant") return false;
    if (!message.metadata?.toolPlan?.length) return false;
    return !slideId || !message.slideId || message.slideId === slideId;
  });
}

function executablePlan(plan: LecturerAssistantToolPlanItem[]) {
  const seen = new Set<string>();
  return [...plan]
    .filter((item) => item.status !== "blocked")
    .sort((left, right) => left.order - right.order)
    .filter((item) => {
      if (!["source_note", "slide_point", "review_draft", "evaluation_focus", "learn_density"].includes(item.action)) return false;
      if (seen.has(item.action)) return false;
      seen.add(item.action);
      return true;
    })
    .slice(0, 3);
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

  const bodyResult = await readJsonBody(request, MAX_ASSISTANT_PLAN_BYTES);
  if (!bodyResult.ok) {
    return NextResponse.json({ error: "Toolkette konnte nicht gelesen werden." }, { status: bodyResult.status });
  }

  const parsed = applyPlanSchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Toolkette konnte nicht ausgeführt werden." }, { status: 400 });
  }

  const repository = getLectureRepository();
  let lecture = (await repository.listLectures(session.email)).find((item) => item.id === id);
  if (!lecture) return NextResponse.json({ error: "Vorlesung nicht gefunden." }, { status: 404 });

  const slideId = parsed.data.slideId && lecture.slides.some((slide) => slide.id === parsed.data.slideId)
    ? parsed.data.slideId
    : undefined;
  const latestAssistant = latestAssistantWithToolPlan(lecture, slideId);
  const plan = executablePlan(latestAssistant?.metadata?.toolPlan ?? []);
  if (plan.length === 0) {
    return NextResponse.json({ error: "Es gibt keine ausführbare Toolkette." }, { status: 400 });
  }
  const actionContext = latestAssistant?.content;

  const executed: Array<{ action: LecturerAssistantToolPlanItem["action"]; label: string }> = [];

  for (const item of plan) {
    if (item.action === "slide_point") {
      const updated = await repository.applyLecturerAssistantSlidePoint({
        lectureId: id,
        slideId,
        message: actionContext ?? item.reason
      }, session.email);
      if (!updated) return NextResponse.json({ error: "Vorlesung nicht gefunden." }, { status: 404 });
      lecture = updated;
      executed.push({ action: item.action, label: item.label });
      continue;
    }

    if (item.action === "review_draft") {
      let updated: Lecture | null;
      try {
        updated = await repository.createLecturerAssistantReview({
          lectureId: id,
          slideId,
          message: actionContext ?? item.reason
        }, session.email);
      } catch {
        return NextResponse.json({ error: "Fragenentwurf konnte nicht angelegt werden." }, { status: 502 });
      }
      if (!updated) return NextResponse.json({ error: "Vorlesung nicht gefunden." }, { status: 404 });
      lecture = updated;
      executed.push({ action: item.action, label: item.label });
      continue;
    }

    if (item.action === "evaluation_focus") {
      const updated = await repository.applyLecturerAssistantEvaluationFocus({
        lectureId: id,
        slideId,
        message: actionContext ?? item.reason
      }, session.email);
      if (!updated) return NextResponse.json({ error: "Vorlesung nicht gefunden." }, { status: 404 });
      lecture = updated;
      executed.push({ action: item.action, label: item.label });
      continue;
    }

    if (item.action === "learn_density") {
      const updated = await repository.applyLecturerAssistantLearnDensity({
        lectureId: id,
        slideId,
        message: item.reason || actionContext
      }, session.email);
      if (!updated) return NextResponse.json({ error: "Vorlesung nicht gefunden." }, { status: 404 });
      lecture = updated;
      executed.push({ action: item.action, label: item.label });
      continue;
    }

    if (item.action === "source_note") {
      const note = createLecturerAssistantSourceNote({
        lecture,
        slideId,
        message: actionContext ?? item.reason
      });
      const existingMaterial = lecture.materials?.find((material) => material.originalName === note.originalName);
      const storageUrl = existingMaterial?.storageUrl ?? (await getStorageProvider().putText(
        `lectures/${id}/assistant-notes/${Date.now()}-${safeStorageName(note.originalName)}.txt`,
        note.content,
        "text/plain"
      )).url;
      const updated = await repository.createLecturerAssistantSourceNote({
        lectureId: id,
        slideId: note.slide?.id,
        originalName: note.originalName,
        storageUrl,
        sizeBytes: new TextEncoder().encode(note.content).length
      }, session.email);
      if (!updated) return NextResponse.json({ error: "Vorlesung nicht gefunden." }, { status: 404 });
      lecture = updated;
      executed.push({ action: item.action, label: item.label });
    }
  }

  const lectures = await repository.listLectures(session.email);
  return NextResponse.json({ lecture, lectures, executed });
}
