import { NextResponse } from "next/server";
import { z } from "zod";

import { getLecturerSession, isValidLecturerCsrfRequest } from "@/server/auth";
import { getAnalyticsRepository } from "@/server/analytics-repository";
import { readJsonBody } from "@/server/request-json";
import { getLectureRepository } from "@/server/repository";
import { isValidRouteEntityId } from "@/server/route-params";
import { slideDocumentSchema } from "@learnordie/slide-engine";

const MAX_UPDATE_LECTURE_BYTES = 2 * 1024 * 1024;

const evaluationConfigSchema = z.object({
  enabled: z.boolean(),
  version: z.coerce.number().int().min(1).optional(),
  updatedAt: z.string().optional(),
  title: z.string().min(2).max(80),
  intro: z.string().min(2).max(180),
  understandingLabel: z.string().min(2).max(120),
  paceLabel: z.string().min(2).max(120),
  aiHelpfulLabel: z.string().min(2).max(120),
  commentLabel: z.string().min(2).max(120),
  submitLabel: z.string().min(2).max(80)
});

const slideSchema = z.object({
  id: z.string().min(1),
  eyebrow: z.string().min(1).max(40),
  title: z.string().min(2).max(140),
  topic: z.string().min(2).max(80),
  copy: z.array(z.string().min(1).max(240)).min(1).max(4),
  diagram: z.enum(["bearing", "formula", "ramp"])
});

const answerSchema = z.object({
  key: z.enum(["A", "B", "C", "D"]),
  text: z.string().min(1).max(220),
  correct: z.boolean()
});

const questionSchema = z.object({
  level: z.enum(["4.0", "3.0", "2.0", "1.0"]),
  points: z.number().int().min(1).max(4),
  text: z.string().min(3).max(260),
  answers: z.array(answerSchema).length(4).refine((answers) => answers.filter((answer) => answer.correct).length === 1, "Genau eine Antwort muss korrekt sein."),
  explanation: z.string().min(1).max(520),
  promptVersion: z.string().min(1).optional(),
  sourceRef: z.string().min(1).optional(),
  learningObjective: z.string().min(1).optional(),
  reviewStatus: z.enum(["draft", "reviewed", "approved", "rejected"]).optional(),
  reviewerComment: z.string().optional()
});

const improvementDraftEventSchema = z.object({
  kind: z.enum(["slide", "question"]),
  targetLabel: z.string().min(1).max(180),
  targetId: z.string().min(1).max(180).optional(),
  title: z.string().min(1).max(180),
  before: z.string().min(1).max(1000),
  after: z.string().min(1).max(1000),
  diff: z.array(z.object({
    field: z.string().min(1).max(120),
    label: z.string().min(1).max(140),
    before: z.string().min(1).max(1000),
    after: z.string().min(1).max(1000)
  })).min(1).max(8).optional(),
  suggestionId: z.string().min(1).max(180).optional()
});

const updateLectureSchema = z.object({
  title: z.string().min(3).optional(),
  seriesTitle: z.string().min(3).optional(),
  liveAt: z.string().min(1).optional(),
  examDate: z.string().min(4).optional(),
  aiDailyLimit: z.coerce.number().int().min(1).max(200).optional(),
  aiDailyTokenLimit: z.coerce.number().int().min(100).max(200000).optional(),
  seriesAiDailyLimit: z.coerce.number().int().min(1).max(200).optional(),
  seriesAiDailyTokenLimit: z.coerce.number().int().min(100).max(200000).optional(),
  tenantAiDailyLimit: z.coerce.number().int().min(1).max(200).optional(),
  tenantAiDailyTokenLimit: z.coerce.number().int().min(100).max(200000).optional(),
  leaderboardEnabled: z.boolean().optional(),
  learnQuestionDensity: z.coerce.number().int().min(1).max(7).optional(),
  evaluationConfig: evaluationConfigSchema.optional(),
  saveEvaluationAsSeriesTemplate: z.boolean().optional(),
  slides: z.array(slideSchema).min(1).max(40).optional(),
  slideDocument: slideDocumentSchema.optional(),
  questions: z.array(questionSchema).length(4).optional(),
  improvementDraftEvent: improvementDraftEventSchema.optional(),
  status: z
    .enum(["draft", "material_processing", "question_review", "ready_for_live", "live", "learn_active", "archived"])
    .optional()
});

export async function PATCH(request: Request, context: { params: Promise<unknown> }) {
  const session = await getLecturerSession();
  if (!session) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  if (!isValidLecturerCsrfRequest(request, session)) {
    return NextResponse.json({ error: "Sicherheitsprüfung fehlgeschlagen." }, { status: 403 });
  }

  const { id } = (await context.params) as { id: string };
  if (!isValidRouteEntityId(id)) {
    return NextResponse.json({ error: "Vorlesung nicht gefunden." }, { status: 404 });
  }

  const bodyResult = await readJsonBody(request, MAX_UPDATE_LECTURE_BYTES);
  if (!bodyResult.ok) {
    return NextResponse.json({ error: "Vorlesung konnte nicht gespeichert werden." }, { status: bodyResult.status });
  }

  const parsed = updateLectureSchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Vorlesung konnte nicht gespeichert werden." }, { status: 400 });
  }

  const { improvementDraftEvent, ...updateData } = parsed.data;
  const lecture = await getLectureRepository().updateLecture(id, updateData, session.email);
  if (!lecture) return NextResponse.json({ error: "Vorlesung nicht gefunden." }, { status: 404 });

  if (improvementDraftEvent) {
    await getAnalyticsRepository().recordEvent({
      lectureToken: lecture.publicToken,
      eventType: "improvement_draft_applied",
      payload: {
        ...improvementDraftEvent,
        appliedBy: session.email
      }
    });
  }

  const lectures = await getLectureRepository().listLectures(session.email);
  return NextResponse.json({ lecture, lectures });
}
