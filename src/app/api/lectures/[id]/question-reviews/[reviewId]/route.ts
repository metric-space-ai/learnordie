import { NextResponse } from "next/server";
import { z } from "zod";

import { getLecturerSession, isValidLecturerCsrfRequest } from "@/server/auth";
import { readJsonBody } from "@/server/request-json";
import { getLectureRepository } from "@/server/repository";
import { isValidRouteEntityId } from "@/server/route-params";

const MAX_QUESTION_REVIEW_BYTES = 256 * 1024;

const answerSchema = z.object({
  key: z.enum(["A", "B", "C", "D"]),
  text: z.string().min(1),
  correct: z.boolean()
});

const promptHistorySchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["generation", "edit", "decision", "template", "test"]),
  title: z.string().min(1),
  promptVersion: z.string().optional(),
  model: z.string().optional(),
  actor: z.string().optional(),
  inputSummary: z.string().min(1),
  outputSummary: z.string().min(1),
  createdAt: z.string().min(1)
});

const promptWorkflowVerdictSchema = z.enum(["stabil", "prüfen", "kritisch"]);

const promptTestRunSchema = z.object({
  id: z.string().min(1),
  model: z.string().min(1),
  score: z.number().min(0).max(1),
  verdict: promptWorkflowVerdictSchema,
  inputSummary: z.string().min(1),
  outputSummary: z.string().min(1),
  latencyMs: z.number().int().min(0),
  estimatedCostEur: z.number().min(0),
  createdAt: z.string().min(1)
});

const promptModelComparisonSchema = z.object({
  id: z.string().min(1),
  model: z.string().min(1),
  score: z.number().min(0).max(1),
  verdict: promptWorkflowVerdictSchema,
  latencyMs: z.number().int().min(0),
  estimatedCostEur: z.number().min(0),
  createdAt: z.string().min(1)
});

const qualityDecisionSchema = z.object({
  status: z.enum(["draft", "reviewed", "approved", "rejected"]),
  reason: z.string().min(1),
  decidedBy: z.string().min(1),
  decidedAt: z.string().min(1)
});

const promptRegistrySchema = z.object({
  templateId: z.string().min(1),
  templateTitle: z.string().min(1),
  templateBody: z.string().min(1).optional(),
  promptVersion: z.string().min(1),
  model: z.string().min(1),
  modelParameters: z.object({
    temperature: z.number().min(0).max(2),
    topP: z.number().min(0).max(1),
    maxOutputTokens: z.number().int().min(1),
    retrievalMode: z.enum(["vector", "text", "hybrid"]),
    sourceLimit: z.number().int().min(0)
  }),
  qualityMetrics: z.object({
    difficultyLevel: z.enum(["4.0", "3.0", "2.0", "1.0"]),
    cognitiveTarget: z.string().min(1),
    sourceCoverage: z.number().min(0).max(1),
    reviewConfidence: z.number().min(0).max(1),
    revisionCount: z.number().int().min(0),
    lastDecision: z.enum(["draft", "reviewed", "approved", "rejected"]).optional()
  }),
  testRuns: z.array(promptTestRunSchema).optional(),
  modelComparisons: z.array(promptModelComparisonSchema).optional(),
  updatedAt: z.string().min(1)
});

const variantSchema = z.object({
  level: z.enum(["4.0", "3.0", "2.0", "1.0"]),
  points: z.number().int().min(1).max(4),
  text: z.string().min(3),
  answers: z.array(answerSchema).length(4).refine((answers) => answers.filter((answer) => answer.correct).length === 1, "Genau eine Antwort muss korrekt sein."),
  explanation: z.string().min(1),
  promptVersion: z.string().min(1).optional(),
  sourceRef: z.string().min(1).optional(),
  learningObjective: z.string().min(1).optional(),
  reviewStatus: z.enum(["draft", "reviewed", "approved", "rejected"]).optional(),
  reviewerComment: z.string().optional(),
  promptHistory: z.array(promptHistorySchema).optional(),
  promptRegistry: promptRegistrySchema.optional(),
  qualityDecision: qualityDecisionSchema.optional()
});

const reviewPatchSchema = z.object({
  decision: z.enum(["approved", "rejected"]).optional(),
  variants: z.array(variantSchema).length(4).optional()
}).refine((body) => Boolean(body.decision) !== Boolean(body.variants), "Genau eine Review-Aktion ist erlaubt.");

export async function PATCH(request: Request, context: { params: Promise<unknown> }) {
  const session = await getLecturerSession();
  if (!session) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  if (!isValidLecturerCsrfRequest(request, session)) {
    return NextResponse.json({ error: "Sicherheitsprüfung fehlgeschlagen." }, { status: 403 });
  }

  const { id, reviewId } = (await context.params) as { id: string; reviewId: string };
  if (!isValidRouteEntityId(id) || !isValidRouteEntityId(reviewId)) {
    return NextResponse.json({ error: "Review nicht gefunden." }, { status: 404 });
  }

  const bodyResult = await readJsonBody(request, MAX_QUESTION_REVIEW_BYTES);
  if (!bodyResult.ok) return NextResponse.json({ error: "Review konnte nicht gespeichert werden." }, { status: bodyResult.status });

  const parsed = reviewPatchSchema.safeParse(bodyResult.body);
  if (!parsed.success) return NextResponse.json({ error: "Review konnte nicht gespeichert werden." }, { status: 400 });

  const repository = getLectureRepository();
  const lecture = parsed.data.variants
    ? await repository.updateQuestionReview(id, reviewId, parsed.data.variants, session.email, session.email)
    : await repository.decideQuestionReview(id, reviewId, parsed.data.decision!, session.email, session.email);
  if (!lecture) return NextResponse.json({ error: "Review nicht gefunden." }, { status: 404 });

  const lectures = await repository.listLectures(session.email);
  return NextResponse.json({ lecture, lectures });
}
