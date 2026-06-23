import crypto from "node:crypto";

import { and, count, desc, eq, gte, inArray, isNull } from "drizzle-orm";

import { demoLecture } from "@/lib/demo-data";
import { normalizeEvaluationConfig, normalizeEvaluationConfigForUpdate } from "@/lib/evaluation";
import { normalizeLearnQuestionDensity } from "@/lib/learn-settings";
import type {
  AnswerOption,
  Lecture,
  LecturerAssistantMetadata,
  LecturerAssistantMessage,
  LecturerAssistantMessageRole,
  LecturerAssistantToolPlanItem,
  LectureMaterial,
  LectureStatus,
  MaterialProcessingRun,
  MaterialProcessingRunStatus,
  MaterialProcessingStep,
  MaterialProcessingStepStatus,
  QuestionLevel,
  QuestionPromptHistoryItem,
  QuestionPromptRegistry,
  QuestionQualityDecision,
  QuestionReviewItem,
  QuestionReviewStatus,
  QuestionVariantReviewStatus,
  QuestionVariant,
  Slide,
  StandaloneExport,
  StandaloneExportJob,
  StandaloneExportJobStatus,
  StudentChatQuestion,
  TranscriptSegment
} from "@/lib/types";
import {
  configuredDefaultAiDailyLimit,
  configuredDefaultAiDailyTokenLimit,
  normalizeAiDailyLimit,
  normalizeAiDailyTokenLimit
} from "./ai-budget";
import { moderateStudentChatQuestion as moderateChatQuestionWithProvider } from "./chat-question-moderation";
import { evaluateStudentChatQuestion } from "./chat-question-filter";
import { getDb } from "./db/client";
import {
  assetChunks,
  lectureAssets,
  lectureSeries,
  lectures,
  lecturerAssistantMessages,
  materialProcessingRuns,
  participantSessions,
  questions,
  questionReviewItems,
  questionVariants,
  slides,
  standaloneExportJobs,
  standaloneExports,
  studentChatQuestions,
  transcriptSegments,
  users
} from "./db/schema";
import {
  aiAccessUntilFromExamDate,
  clone,
  createLecturerAssistantReviewMaterial,
  createReviewItemFromLecturerAssistant,
  createReviewItemFromChatQuestion,
  createReviewItemFromTranscriptSegment,
  createDefaultSlides,
  normalizeExamDate,
  slugify
} from "./lecture-factory";
import { applyQualityDecision, recordReviewEdits } from "./question-review-metadata";
import { processMaterialContent } from "./material-pipeline";
import { generateQuestionVariantsForMaterial } from "./question-generation";
import { getJobProvider } from "./providers/jobs";
import { getStorageProvider } from "./providers/storage";
import { configuredWorkerMaxAttempts } from "./worker-policy";
import type {
  AddMaterialInput,
  ApplyLecturerAssistantEvaluationFocusInput,
  ApplyLecturerAssistantLearnDensityInput,
  ApplyLecturerAssistantSlidePointInput,
  CreateLecturerAssistantSourceNoteInput,
  CreateLecturerAssistantReviewInput,
  CreateStandaloneExportJobInput,
  CreateLectureInput,
  LectureRepository,
  ModerateChatQuestionInput,
  RecordStandaloneExportInput,
  SubmitLecturerAssistantMessageInput,
  SubmitChatQuestionInput,
  SubmitTranscriptSegmentInput,
  UpdateStandaloneExportJobInput,
  UpdateLectureInput
} from "./repository";
import { createLecturerAssistantEvaluationFocus, createLecturerAssistantLearnDensity, createLecturerAssistantSlidePoint, generateLecturerAssistantReply } from "./lecturer-assistant";

const questionLevelOrder: Record<QuestionLevel, number> = {
  "4.0": 0,
  "3.0": 1,
  "2.0": 2,
  "1.0": 3
};

function shouldAutoSeedDemo() {
  const configured = process.env.LEARNBUDDY_AUTO_SEED?.trim().toLowerCase();
  if (configured) return configured === "1" || configured === "true" || configured === "yes";
  return process.env.NODE_ENV !== "production";
}

function toTimestamp(value: string) {
  if (!value) return new Date();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T00:00:00.000Z`);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return new Date(`${value}:00.000Z`);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) return new Date(`${value}.000Z`);
  return new Date(value);
}

function normalizeSlidePatch(slide: Slide) {
  const copy = slide.copy.map((line) => line.trim()).filter(Boolean).slice(0, 4);
  return {
    title: slide.title.trim(),
    contentJson: {
      eyebrow: slide.eyebrow.trim(),
      topic: slide.topic.trim(),
      copy,
      diagram: slide.diagram === "formula" || slide.diagram === "ramp" ? slide.diagram : "bearing"
    }
  };
}

function toIso(value: Date | null) {
  return value?.toISOString() ?? new Date().toISOString();
}

function normalizeOwnerEmail(value?: string) {
  const clean = value?.trim().toLowerCase();
  return clean || undefined;
}

function coerceLectureStatus(value: string): LectureStatus {
  if (
    value === "draft" ||
    value === "material_processing" ||
    value === "question_review" ||
    value === "ready_for_live" ||
    value === "live" ||
    value === "learn_active" ||
    value === "archived"
  ) {
    return value;
  }

  return "draft";
}

function coerceMaterialKind(value: string): LectureMaterial["kind"] {
  if (value === "pptx" || value === "pdf" || value === "url" || value === "notes" || value === "audio" || value === "other") return value;
  return "other";
}

function coerceMaterialSource(value: string): LectureMaterial["source"] {
  if (value === "upload" || value === "url" || value === "notes") return value;
  return "upload";
}

function coerceMaterialStatus(value: string): LectureMaterial["status"] {
  if (value === "uploaded" || value === "processing" || value === "ready") return value;
  return "uploaded";
}

function coerceProcessingRunStatus(value: string): MaterialProcessingRunStatus {
  if (value === "queued" || value === "running" || value === "succeeded" || value === "failed" || value === "dead_letter") return value;
  return "queued";
}

function coerceProcessingStepStatus(value: unknown): MaterialProcessingStepStatus {
  if (value === "running" || value === "done" || value === "failed" || value === "skipped") return value;
  return "done";
}

function coerceProcessingSteps(value: unknown): MaterialProcessingStep[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      label: typeof item.label === "string" ? item.label : "Verarbeitungsschritt",
      status: coerceProcessingStepStatus(item.status),
      detail: typeof item.detail === "string" ? item.detail : undefined,
      at: typeof item.at === "string" ? item.at : new Date().toISOString()
    }));
}

function coerceReviewStatus(value: string): QuestionReviewStatus {
  if (value === "draft" || value === "approved" || value === "rejected") return value;
  return "draft";
}

function coerceChatQuestionStatus(value: string): StudentChatQuestion["status"] {
  if (value === "accepted" || value === "ignored") return value;
  return "ignored";
}

function coerceTranscriptSegmentStatus(value: string): TranscriptSegment["status"] {
  if (value === "accepted" || value === "ignored") return value;
  return "ignored";
}

function coerceAssistantRole(value: string): LecturerAssistantMessageRole {
  return value === "assistant" ? "assistant" : "lecturer";
}

function coerceStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function coerceAssistantMetadata(value: unknown): LecturerAssistantMetadata | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const metadata: LecturerAssistantMetadata = {};

  if (typeof record.provider === "string" && record.provider.trim()) metadata.provider = record.provider;
  if (typeof record.model === "string" && record.model.trim()) metadata.model = record.model;
  if (typeof record.agentRunId === "string" && record.agentRunId.trim()) metadata.agentRunId = record.agentRunId;
  if (typeof record.strategy === "string" && record.strategy.trim()) metadata.strategy = record.strategy;

  if (Array.isArray(record.steps)) {
    metadata.steps = record.steps.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const step = item as Record<string, unknown>;
      const title = typeof step.title === "string" ? step.title.trim() : "";
      const detail = typeof step.detail === "string" ? step.detail.trim() : "";
      const status = step.status === "suggested" || step.status === "blocked" ? step.status : "done";
      return title && detail ? [{ title, detail, status }] : [];
    });
  }

  if (Array.isArray(record.sourceWeights)) {
    metadata.sourceWeights = record.sourceWeights.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const source = item as Record<string, unknown>;
      const label = typeof source.label === "string" ? source.label.trim() : "";
      const reason = typeof source.reason === "string" ? source.reason.trim() : "";
      const weight = typeof source.weight === "number" && Number.isFinite(source.weight)
        ? Math.max(0, Math.min(1, source.weight))
        : 0;
      return label && reason ? [{ label, reason, weight }] : [];
    });
  }

  if (Array.isArray(record.toolSuggestions)) {
    metadata.toolSuggestions = record.toolSuggestions.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const tool = item as Record<string, unknown>;
      const action = tool.action === "review_draft" || tool.action === "slide_point" || tool.action === "source_note" || tool.action === "evaluation_focus" || tool.action === "learn_density"
        ? tool.action
        : undefined;
      const label = typeof tool.label === "string" ? tool.label.trim() : "";
      const reason = typeof tool.reason === "string" ? tool.reason.trim() : "";
      return action && label && reason ? [{ action, label, reason }] : [];
    });
  }

  if (Array.isArray(record.toolPlan)) {
    metadata.toolPlan = record.toolPlan.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const tool = item as Record<string, unknown>;
      const action: LecturerAssistantToolPlanItem["action"] | undefined = tool.action === "review_draft" || tool.action === "slide_point" || tool.action === "source_note" || tool.action === "evaluation_focus" || tool.action === "learn_density"
        ? tool.action
        : undefined;
      const label = typeof tool.label === "string" ? tool.label.trim() : "";
      const reason = typeof tool.reason === "string" ? tool.reason.trim() : "";
      const order = typeof tool.order === "number" && Number.isFinite(tool.order) ? Math.max(1, Math.round(tool.order)) : 1;
      const status: LecturerAssistantToolPlanItem["status"] = tool.status === "blocked" ? "blocked" : "suggested";
      const prerequisite = typeof tool.prerequisite === "string" && tool.prerequisite.trim() ? tool.prerequisite.trim() : undefined;
      return action && label && reason ? [{ action, label, reason, order, status, prerequisite }] : [];
    }).sort((left, right) => left.order - right.order);
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function coerceLevel(value: string): QuestionLevel {
  if (value === "4.0" || value === "3.0" || value === "2.0" || value === "1.0") return value;
  return "4.0";
}

function coerceVariantReviewStatus(value: unknown): QuestionVariantReviewStatus {
  if (value === "draft" || value === "reviewed" || value === "approved" || value === "rejected") return value;
  return "draft";
}

function coerceStandaloneExportJobStatus(value: unknown): StandaloneExportJobStatus {
  if (value === "queued" || value === "running" || value === "succeeded" || value === "failed" || value === "dead_letter") return value;
  return "queued";
}

function coerceAnswers(value: unknown, correctAnswerKey?: string): AnswerOption[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => {
      const key = item.key === "A" || item.key === "B" || item.key === "C" || item.key === "D" ? item.key : "A";
      return {
        key,
        text: typeof item.text === "string" ? item.text : "",
        correct: typeof item.correct === "boolean" ? item.correct : key === correctAnswerKey
      };
    });
}

function coercePromptHistory(value: unknown): QuestionPromptHistoryItem[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const coerceKind = (kind: unknown): QuestionPromptHistoryItem["kind"] =>
    kind === "edit" || kind === "decision" || kind === "template" || kind === "test" ? kind : "generation";
  const items = value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      id: typeof item.id === "string" ? item.id : "prompt_unknown",
      kind: coerceKind(item.kind),
      title: typeof item.title === "string" ? item.title : "Prompt-Historie",
      promptVersion: typeof item.promptVersion === "string" ? item.promptVersion : undefined,
      model: typeof item.model === "string" ? item.model : undefined,
      actor: typeof item.actor === "string" ? item.actor : undefined,
      inputSummary: typeof item.inputSummary === "string" ? item.inputSummary : "Keine Eingabezusammenfassung",
      outputSummary: typeof item.outputSummary === "string" ? item.outputSummary : "Keine Ausgabezusammenfassung",
      createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date(0).toISOString()
    }));
  return items.length > 0 ? items : undefined;
}

function coercePromptWorkflowVerdict(value: unknown): "stabil" | "prüfen" | "kritisch" {
  if (value === "stabil" || value === "prüfen" || value === "kritisch") return value;
  return "prüfen";
}

function coercePromptTestRuns(value: unknown): QuestionPromptRegistry["testRuns"] {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      id: typeof item.id === "string" ? item.id : "prompt_test_unknown",
      model: typeof item.model === "string" ? item.model : "unknown",
      score: typeof item.score === "number" ? Math.max(0, Math.min(1, item.score)) : 0,
      verdict: coercePromptWorkflowVerdict(item.verdict),
      inputSummary: typeof item.inputSummary === "string" ? item.inputSummary : "Kein Testinput erfasst",
      outputSummary: typeof item.outputSummary === "string" ? item.outputSummary : "Kein Testergebnis erfasst",
      latencyMs: typeof item.latencyMs === "number" ? Math.max(0, Math.round(item.latencyMs)) : 0,
      estimatedCostEur: typeof item.estimatedCostEur === "number" ? Math.max(0, item.estimatedCostEur) : 0,
      createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date(0).toISOString()
    }));
  return items.length > 0 ? items : undefined;
}

function coercePromptModelComparisons(value: unknown): QuestionPromptRegistry["modelComparisons"] {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      id: typeof item.id === "string" ? item.id : "prompt_model_unknown",
      model: typeof item.model === "string" ? item.model : "unknown",
      score: typeof item.score === "number" ? Math.max(0, Math.min(1, item.score)) : 0,
      verdict: coercePromptWorkflowVerdict(item.verdict),
      latencyMs: typeof item.latencyMs === "number" ? Math.max(0, Math.round(item.latencyMs)) : 0,
      estimatedCostEur: typeof item.estimatedCostEur === "number" ? Math.max(0, item.estimatedCostEur) : 0,
      createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date(0).toISOString()
    }));
  return items.length > 0 ? items : undefined;
}

function coercePromptRegistry(value: unknown): QuestionPromptRegistry | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  const parameters = item.modelParameters && typeof item.modelParameters === "object"
    ? item.modelParameters as Record<string, unknown>
    : {};
  const metrics = item.qualityMetrics && typeof item.qualityMetrics === "object"
    ? item.qualityMetrics as Record<string, unknown>
    : {};
  const retrievalMode = parameters.retrievalMode === "vector" || parameters.retrievalMode === "text" || parameters.retrievalMode === "hybrid"
    ? parameters.retrievalMode
    : "hybrid";
  const lastDecision = metrics.lastDecision === "draft"
    || metrics.lastDecision === "reviewed"
    || metrics.lastDecision === "approved"
    || metrics.lastDecision === "rejected"
    ? metrics.lastDecision
    : undefined;

  return {
    templateId: typeof item.templateId === "string" ? item.templateId : "learnbuddy-mcq-unknown-v1",
    templateTitle: typeof item.templateTitle === "string" ? item.templateTitle : "MCQ Prompt",
    templateBody: typeof item.templateBody === "string" ? item.templateBody : undefined,
    promptVersion: typeof item.promptVersion === "string" ? item.promptVersion : "unknown",
    model: typeof item.model === "string" ? item.model : "unknown",
    modelParameters: {
      temperature: typeof parameters.temperature === "number" ? parameters.temperature : 0.3,
      topP: typeof parameters.topP === "number" ? parameters.topP : 0.9,
      maxOutputTokens: typeof parameters.maxOutputTokens === "number" ? parameters.maxOutputTokens : 520,
      retrievalMode,
      sourceLimit: typeof parameters.sourceLimit === "number" ? parameters.sourceLimit : 4
    },
    qualityMetrics: {
      difficultyLevel: coerceLevel(String(metrics.difficultyLevel ?? "4.0")),
      cognitiveTarget: typeof metrics.cognitiveTarget === "string" ? metrics.cognitiveTarget : "Nicht erfasst",
      sourceCoverage: typeof metrics.sourceCoverage === "number" ? metrics.sourceCoverage : 0,
      reviewConfidence: typeof metrics.reviewConfidence === "number" ? metrics.reviewConfidence : 0,
      revisionCount: typeof metrics.revisionCount === "number" ? metrics.revisionCount : 0,
      lastDecision
    },
    testRuns: coercePromptTestRuns(item.testRuns),
    modelComparisons: coercePromptModelComparisons(item.modelComparisons),
    updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : new Date(0).toISOString()
  };
}

function coerceQualityDecision(value: unknown): QuestionQualityDecision | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  return {
    status: coerceVariantReviewStatus(item.status),
    reason: typeof item.reason === "string" ? item.reason : "Keine Begründung erfasst.",
    decidedBy: typeof item.decidedBy === "string" ? item.decidedBy : "unbekannt",
    decidedAt: typeof item.decidedAt === "string" ? item.decidedAt : new Date(0).toISOString()
  };
}

function coerceVariants(value: unknown): QuestionVariant[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      level: coerceLevel(String(item.level)),
      points: typeof item.points === "number" ? item.points : 1,
      text: typeof item.text === "string" ? item.text : "",
      explanation: typeof item.explanation === "string" ? item.explanation : "",
      answers: coerceAnswers(item.answers),
      promptVersion: typeof item.promptVersion === "string" ? item.promptVersion : "unknown",
      sourceRef: typeof item.sourceRef === "string" ? item.sourceRef : undefined,
      learningObjective: typeof item.learningObjective === "string" ? item.learningObjective : undefined,
      reviewStatus: coerceVariantReviewStatus(item.reviewStatus),
      reviewerComment: typeof item.reviewerComment === "string" ? item.reviewerComment : "",
      promptHistory: coercePromptHistory(item.promptHistory),
      promptRegistry: coercePromptRegistry(item.promptRegistry),
      qualityDecision: coerceQualityDecision(item.qualityDecision)
    }))
    .sort((left, right) => questionLevelOrder[left.level] - questionLevelOrder[right.level]);
}

type LectureRow = typeof lectures.$inferSelect;
type SeriesRow = typeof lectureSeries.$inferSelect;
type AssetRow = typeof lectureAssets.$inferSelect;
type ChunkRow = typeof assetChunks.$inferSelect;
type ProcessingRunRow = typeof materialProcessingRuns.$inferSelect;
type ChatQuestionRow = typeof studentChatQuestions.$inferSelect;
type TranscriptSegmentRow = typeof transcriptSegments.$inferSelect;
type AssistantMessageRow = typeof lecturerAssistantMessages.$inferSelect;
type SlideRow = typeof slides.$inferSelect;
type QuestionRow = typeof questions.$inferSelect;
type VariantRow = typeof questionVariants.$inferSelect;
type ReviewRow = typeof questionReviewItems.$inferSelect;
type StandaloneExportRow = typeof standaloneExports.$inferSelect;
type StandaloneExportJobRow = typeof standaloneExportJobs.$inferSelect;
type UserRow = typeof users.$inferSelect;

type LectureJoinRow = {
  lecture: LectureRow;
  series: SeriesRow | null;
  owner: UserRow | null;
};

export class PostgresLectureRepository implements LectureRepository {
  private readonly db = getDb();
  private seeded = false;

  async listLectures(ownerEmail?: string) {
    await this.ensureSeeded();
    const owner = normalizeOwnerEmail(ownerEmail);
    const selectLectures = () => this.db
      .select({ lecture: lectures, series: lectureSeries, owner: users })
      .from(lectures)
      .leftJoin(lectureSeries, eq(lectures.seriesId, lectureSeries.id))
      .leftJoin(users, eq(lectureSeries.ownerId, users.id));
    const rows = owner
      ? await selectLectures().where(eq(users.email, owner)).orderBy(desc(lectures.createdAt))
      : await selectLectures().orderBy(desc(lectures.createdAt));

    return this.hydrateLectures(rows);
  }

  async getLectureByToken(token: string) {
    await this.ensureSeeded();
    const rows = await this.db
      .select({ lecture: lectures, series: lectureSeries, owner: users })
      .from(lectures)
      .leftJoin(lectureSeries, eq(lectures.seriesId, lectureSeries.id))
      .leftJoin(users, eq(lectureSeries.ownerId, users.id))
      .where(eq(lectures.publicToken, token))
      .limit(1);

    const [lecture] = await this.hydrateLectures(rows);
    return lecture ?? null;
  }

  async createLecture(input: CreateLectureInput, ownerEmail?: string) {
    await this.ensureSeeded();
    const title = input.title.trim();
    const examDate = normalizeExamDate(input.examDate);
    const owner = ownerEmail ? await this.findOrCreateUser(ownerEmail) : null;
    const series = await this.findOrCreateSeries(input.seriesTitle.trim(), owner?.id);
    const publicToken = `${slugify(title)}-${crypto.randomBytes(3).toString("hex")}`;
    const [lecture] = await this.db
      .insert(lectures)
      .values({
        seriesId: series.id,
        publicToken,
        title,
        status: "draft",
        liveAt: toTimestamp(input.liveAt),
        examDate: toTimestamp(examDate),
        aiAccessUntil: toTimestamp(aiAccessUntilFromExamDate(examDate)),
        aiDailyLimit: configuredDefaultAiDailyLimit(),
        aiDailyTokenLimit: configuredDefaultAiDailyTokenLimit(),
        leaderboardEnabled: true,
        learnQuestionDensity: normalizeLearnQuestionDensity(undefined),
        evaluationConfig: normalizeEvaluationConfig(series.evaluationConfig)
      })
      .returning();

    await this.insertSlides(lecture.id, createDefaultSlides(title));
    await this.replaceActiveQuestions(lecture.id, clone(demoLecture.questions), "initial_seed");

    const created = await this.getLectureById(lecture.id, ownerEmail);
    if (!created) throw new Error("Created lecture could not be reloaded.");
    return created;
  }

  async updateLecture(id: string, input: UpdateLectureInput, ownerEmail?: string) {
    await this.ensureSeeded();
    const existingScopedLecture = await this.getLectureById(id, ownerEmail);
    if (!existingScopedLecture) return null;
    const [existingLecture] = await this.db
      .select({ seriesId: lectures.seriesId, evaluationConfig: lectures.evaluationConfig })
      .from(lectures)
      .where(eq(lectures.id, id))
      .limit(1);
    if (!existingLecture) return null;

    const owner = ownerEmail ? await this.findOrCreateUser(ownerEmail) : null;
    const patch: Partial<typeof lectures.$inferInsert> = {};
    let targetSeriesId = existingLecture.seriesId;

    if (input.title !== undefined) patch.title = input.title.trim();
    if (input.liveAt !== undefined) patch.liveAt = toTimestamp(input.liveAt);
    if (input.examDate !== undefined) {
      const examDate = normalizeExamDate(input.examDate);
      patch.examDate = toTimestamp(examDate);
      patch.aiAccessUntil = toTimestamp(aiAccessUntilFromExamDate(examDate));
    }
    if (input.status !== undefined) patch.status = input.status;
    if (input.leaderboardEnabled !== undefined) patch.leaderboardEnabled = input.leaderboardEnabled;
    if (input.learnQuestionDensity !== undefined) patch.learnQuestionDensity = normalizeLearnQuestionDensity(input.learnQuestionDensity);
    if (input.aiDailyLimit !== undefined) patch.aiDailyLimit = normalizeAiDailyLimit(input.aiDailyLimit);
    if (input.aiDailyTokenLimit !== undefined) patch.aiDailyTokenLimit = normalizeAiDailyTokenLimit(input.aiDailyTokenLimit);
    if (input.seriesTitle !== undefined) {
      const series = await this.findOrCreateSeries(input.seriesTitle.trim(), owner?.id);
      patch.seriesId = series.id;
      targetSeriesId = series.id;
    }
    if (input.evaluationConfig !== undefined) patch.evaluationConfig = normalizeEvaluationConfigForUpdate(existingLecture.evaluationConfig, input.evaluationConfig);

    if (Object.keys(patch).length > 0) {
      await this.db.update(lectures).set(patch).where(eq(lectures.id, id));
    }

    if (input.slides !== undefined) {
      await this.updateSlides(id, input.slides);
    }

    if (input.questions !== undefined) {
      await this.replaceActiveQuestions(id, input.questions, "improvement_draft");
    }

    if (input.saveEvaluationAsSeriesTemplate && input.evaluationConfig !== undefined && targetSeriesId) {
      await this.db
        .update(lectureSeries)
        .set({ evaluationConfig: normalizeEvaluationConfig(patch.evaluationConfig) })
        .where(eq(lectureSeries.id, targetSeriesId));
    }

    if ((input.seriesAiDailyLimit !== undefined || input.seriesAiDailyTokenLimit !== undefined) && targetSeriesId) {
      const seriesPatch: Partial<typeof lectureSeries.$inferInsert> = {};
      if (owner) seriesPatch.ownerId = owner.id;
      if (input.seriesAiDailyLimit !== undefined) {
        seriesPatch.aiDailyLimit = normalizeAiDailyLimit(input.seriesAiDailyLimit);
      }
      if (input.seriesAiDailyTokenLimit !== undefined) {
        seriesPatch.aiDailyTokenLimit = normalizeAiDailyTokenLimit(input.seriesAiDailyTokenLimit);
      }

      await this.db.update(lectureSeries).set(seriesPatch).where(eq(lectureSeries.id, targetSeriesId));
    }

    if ((input.tenantAiDailyLimit !== undefined || input.tenantAiDailyTokenLimit !== undefined) && owner) {
      const userPatch: Partial<typeof users.$inferInsert> = {};
      if (input.tenantAiDailyLimit !== undefined) {
        userPatch.aiDailyLimit = normalizeAiDailyLimit(input.tenantAiDailyLimit);
      }
      if (input.tenantAiDailyTokenLimit !== undefined) {
        userPatch.aiDailyTokenLimit = normalizeAiDailyTokenLimit(input.tenantAiDailyTokenLimit);
      }
      await this.db.update(users).set(userPatch).where(eq(users.id, owner.id));
      if (targetSeriesId) {
        await this.db.update(lectureSeries).set({ ownerId: owner.id }).where(eq(lectureSeries.id, targetSeriesId));
      }
    }

    return this.getLectureById(id, ownerEmail);
  }

  async addMaterial(lectureId: string, input: AddMaterialInput, ownerEmail?: string) {
    await this.ensureSeeded();
    const ownedLecture = await this.getLectureById(lectureId, ownerEmail);
    if (!ownedLecture) return null;
    const [lecture] = await this.db.select({ id: lectures.id, status: lectures.status }).from(lectures).where(eq(lectures.id, lectureId)).limit(1);
    if (!lecture) return null;

    const [material] = await this.db
      .insert(lectureAssets)
      .values({
        lectureId,
        kind: input.kind,
        source: input.source,
        originalName: input.originalName,
        storageKey: input.storageUrl,
        sizeBytes: input.sizeBytes,
        status: input.kind === "audio" ? "ready" : "uploaded"
      })
      .returning();

    if (input.kind !== "audio" && lecture.status === "draft") {
      await this.db.update(lectures).set({ status: "material_processing" }).where(eq(lectures.id, lectureId));
    }

    return this.materialFromRow(material);
  }

  async processMaterials(lectureId: string, ownerEmail?: string) {
    await this.ensureSeeded();
    const lecture = await this.getLectureById(lectureId, ownerEmail);
    if (!lecture) return null;

    const run = await this.createMaterialProcessingRun(lecture, "running");
    try {
      const jobProvider = getJobProvider();
      await this.db.update(materialProcessingRuns).set({ provider: jobProvider.name }).where(eq(materialProcessingRuns.id, run.id));
      const jobResult = await jobProvider.run({ jobId: run.id, kind: "material_processing" }, async () =>
        this.performMaterialProcessingWork(run.id, lecture, new Date(run.startedAt), coerceProcessingSteps(run.stepsJson))
      );
      await this.db.update(materialProcessingRuns).set({
        provider: jobResult.provider,
        providerJobId: jobResult.providerJobId
      }).where(eq(materialProcessingRuns.id, run.id));
    } catch (error) {
      const [currentRun] = await this.db.select().from(materialProcessingRuns).where(eq(materialProcessingRuns.id, run.id)).limit(1);
      if (currentRun?.status !== "failed") {
        const completedAt = new Date();
        const steps = coerceProcessingSteps(currentRun?.stepsJson ?? run.stepsJson);
        const errorMessage = error instanceof Error ? error.message : "Unbekannter Fehler";
        steps.push({
          label: "Materialverarbeitung fehlgeschlagen",
          status: "failed",
          detail: errorMessage,
          at: completedAt.toISOString()
        });
        await this.db.update(materialProcessingRuns).set({
          status: "failed",
          message: errorMessage,
          stepsJson: steps,
          completedAt,
          durationMs: completedAt.getTime() - new Date(run.startedAt).getTime()
        }).where(eq(materialProcessingRuns.id, run.id));
      }
      throw error;
    }

    return this.getLectureById(lectureId, ownerEmail);
  }

  async enqueueMaterialProcessingRun(lectureId: string, ownerEmail?: string) {
    await this.ensureSeeded();
    const lecture = await this.getLectureById(lectureId, ownerEmail);
    if (!lecture) return null;

    const run = await this.createMaterialProcessingRun(lecture, "queued");
    await this.db.update(materialProcessingRuns).set({
      provider: "database",
      providerJobId: `database:material_processing:${run.id}`,
      message: "Materialverarbeitung wartet auf Worker."
    }).where(eq(materialProcessingRuns.id, run.id));

    return this.getLectureById(lectureId, ownerEmail);
  }

  async executeMaterialProcessingRun(runId: string) {
    await this.ensureSeeded();
    const [run] = await this.db.select().from(materialProcessingRuns).where(eq(materialProcessingRuns.id, runId)).limit(1);
    if (!run || (run.status !== "queued" && run.status !== "running")) return null;

    const lecture = await this.getLectureById(run.lectureId);
    if (!lecture) return null;

    await this.db.update(materialProcessingRuns).set({
      status: "running",
      provider: run.provider ?? "database",
      providerJobId: run.providerJobId ?? `database:material_processing:${run.id}`,
      message: "Materialverarbeitung läuft."
    }).where(eq(materialProcessingRuns.id, run.id));

    await this.performMaterialProcessingWork(run.id, lecture, run.startedAt, coerceProcessingSteps(run.stepsJson));
    return this.getLectureById(run.lectureId);
  }

  private materialsToReviewForLecture(lecture: Lecture) {
    const existingMaterialIds = new Set((lecture.questionReviews ?? []).map((review) => review.sourceMaterialId));
    return (lecture.materials ?? []).filter(
      (material) => material.kind !== "audio" && (material.status !== "ready" || !existingMaterialIds.has(material.id))
    );
  }

  private async createMaterialProcessingRun(lecture: Lecture, status: "queued" | "running") {
    const materialsToReview = this.materialsToReviewForLecture(lecture);
    const startedAt = new Date();
    const steps: MaterialProcessingStep[] = [{
      label: status === "queued" ? "Materialverarbeitung vorgemerkt" : "Materialverarbeitung gestartet",
      status: "done",
      detail: `${materialsToReview.length} Material${materialsToReview.length === 1 ? "" : "ien"} in der Warteschlange.`,
      at: startedAt.toISOString()
    }];

    const [run] = await this.db
      .insert(materialProcessingRuns)
      .values({
        lectureId: lecture.id,
        status,
        materialCount: materialsToReview.length,
        maxAttempts: configuredWorkerMaxAttempts(),
        message: status === "queued" ? "Materialverarbeitung wartet auf Worker." : "Materialverarbeitung läuft.",
        stepsJson: steps
      })
      .returning();

    return run;
  }

  private async performMaterialProcessingWork(
    runId: string,
    lecture: Lecture,
    startedAt: Date,
    steps: MaterialProcessingStep[]
  ) {
    const storage = getStorageProvider();
    const existingMaterialIds = new Set((lecture.questionReviews ?? []).map((review) => review.sourceMaterialId));
    const materialsToReview = this.materialsToReviewForLecture(lecture);
    let chunkCount = 0;
    let reviewCount = 0;
    const runStartedAt = new Date();
    steps.push({
      label: "Worker-Ausführung gestartet",
      status: "done",
      detail: `${materialsToReview.length} Material${materialsToReview.length === 1 ? "" : "ien"} werden verarbeitet.`,
      at: runStartedAt.toISOString()
    });
    await this.db.update(materialProcessingRuns).set({
      status: "running",
      materialCount: materialsToReview.length,
      stepsJson: steps,
      message: "Materialverarbeitung läuft."
    }).where(eq(materialProcessingRuns.id, runId));

    try {
      for (const material of materialsToReview) {
        steps.push({
          label: `Quelle lesen: ${material.originalName}`,
          status: "done",
          detail: material.kind,
          at: new Date().toISOString()
        });
        await this.db.update(lectureAssets).set({ status: "processing" }).where(eq(lectureAssets.id, material.id));
        let storedText = "";
        try {
          storedText = await storage.readText(material.storageUrl);
        } catch {
          storedText = "";
        }

        const processed = await processMaterialContent({ lecture, material, storedText });
        await this.db.delete(assetChunks).where(eq(assetChunks.assetId, material.id));
        if (processed.chunks.length > 0) {
          await this.db.insert(assetChunks).values(
            processed.chunks.map((chunk) => ({
              lectureId: lecture.id,
              assetId: material.id,
              sourceRef: chunk.sourceRef,
              content: chunk.content,
              embedding: chunk.embedding
            }))
          );
        }
        chunkCount += processed.chunks.length;
        steps.push({
          label: `Chunks gespeichert: ${material.originalName}`,
          status: "done",
          detail: `${processed.chunks.length} ${processed.chunks.length === 1 ? "Chunk" : "Chunks"}`,
          at: new Date().toISOString()
        });
        for (const warning of processed.warnings) {
          steps.push({
            label: `Extraktion eingeschränkt: ${material.originalName}`,
            status: "skipped",
            detail: warning,
            at: new Date().toISOString()
          });
        }
        await this.db.update(lectureAssets).set({ status: "ready" }).where(eq(lectureAssets.id, material.id));

        if (!existingMaterialIds.has(material.id) && processed.chunks.length > 0) {
          const processedMaterial: LectureMaterial = {
            ...material,
            status: "ready",
            chunkCount: processed.chunks.length,
            extractedTextPreview: processed.preview,
            sourceRefs: processed.sourceRefs
          };
          await this.db.insert(questionReviewItems).values({
            lectureId: lecture.id,
            sourceMaterialId: material.id,
            sourceTitle: material.originalName,
            status: "draft",
            variantsJson: await generateQuestionVariantsForMaterial({
              lecture,
              material: processedMaterial,
              chunks: processed.chunks
            })
          });
          reviewCount += 1;
          steps.push({
            label: `Review-Vorschlag erzeugt: ${material.originalName}`,
            status: "done",
            detail: "4 Niveauvarianten",
            at: new Date().toISOString()
          });
        } else if (!existingMaterialIds.has(material.id)) {
          steps.push({
            label: `Review-Vorschlag übersprungen: ${material.originalName}`,
            status: "skipped",
            detail: "Keine verwertbaren Fachtext-Chunks vorhanden.",
            at: new Date().toISOString()
          });
        } else {
          steps.push({
            label: `Review bereits vorhanden: ${material.originalName}`,
            status: "skipped",
            at: new Date().toISOString()
          });
        }
      }

      if (materialsToReview.length > 0) {
        await this.db.update(lectures).set({ status: "question_review" }).where(eq(lectures.id, lecture.id));
      }

      const completedAt = new Date();
      steps.push({
        label: "Materialverarbeitung abgeschlossen",
        status: "done",
        detail: `${chunkCount} ${chunkCount === 1 ? "Chunk" : "Chunks"}, ${reviewCount} Review-${reviewCount === 1 ? "Vorschlag" : "Vorschläge"}`,
        at: completedAt.toISOString()
      });
      await this.db.update(materialProcessingRuns).set({
        status: "succeeded",
        chunkCount,
        reviewCount,
        message: materialsToReview.length > 0 ? "Materialverarbeitung erfolgreich abgeschlossen." : "Keine offenen Materialien gefunden.",
        stepsJson: steps,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime()
      }).where(eq(materialProcessingRuns.id, runId));
    } catch (error) {
      const completedAt = new Date();
      const errorMessage = error instanceof Error ? error.message : "Unbekannter Fehler";
      steps.push({
        label: "Materialverarbeitung fehlgeschlagen",
        status: "failed",
        detail: errorMessage,
        at: completedAt.toISOString()
      });
      await this.db.update(materialProcessingRuns).set({
        status: "failed",
        chunkCount,
        reviewCount,
        message: errorMessage,
        stepsJson: steps,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime()
      }).where(eq(materialProcessingRuns.id, runId));
      throw error;
    }
  }

  async submitStudentChatQuestion(input: SubmitChatQuestionInput) {
    await this.ensureSeeded();
    const lecture = await this.getLectureByToken(input.lectureToken);
    if (!lecture) return null;

    const cleanText = input.text.replace(/\s+/g, " ").trim();
    const moderation = await moderateChatQuestionWithProvider(lecture, cleanText);
    const participantSessionId = input.anonymousKey
      ? await this.findOrCreateParticipantSession({
          lectureId: lecture.id,
          anonymousKey: input.anonymousKey,
          pseudonym: input.pseudonym.trim() || "Pseudonym"
        })
      : null;

    const [created] = await this.db
      .insert(studentChatQuestions)
      .values({
        lectureId: lecture.id,
        participantSessionId,
        pseudonym: input.pseudonym.trim() || "Pseudonym",
        anonymousKey: input.anonymousKey,
        questionText: cleanText,
        status: moderation.status,
        relevanceReason: moderation.reason,
        sourceTopic: moderation.sourceTopic,
        moderationProvider: moderation.provider,
        moderationModel: moderation.model,
        moderationConfidence: moderation.confidence,
        moderationSignals: moderation.signals
      })
      .returning();

    const chatQuestion = this.chatQuestionFromRow(created);
    if (chatQuestion.status === "accepted") {
      const reviewItem = createReviewItemFromChatQuestion(lecture, chatQuestion);
      await this.db.insert(questionReviewItems).values({
        lectureId: lecture.id,
        sourceTitle: reviewItem.sourceTitle,
        status: "draft",
        variantsJson: reviewItem.variants
      });
      if (lecture.status === "draft" || lecture.status === "material_processing") {
        await this.db.update(lectures).set({ status: "question_review" }).where(eq(lectures.id, lecture.id));
      }
    }

    return chatQuestion;
  }

  async countRecentStudentChatQuestions(input: { lectureToken: string; anonymousKey: string; since: Date }) {
    await this.ensureSeeded();
    const [lecture] = await this.db
      .select({ id: lectures.id })
      .from(lectures)
      .where(eq(lectures.publicToken, input.lectureToken))
      .limit(1);

    if (!lecture) return null;

    const [result] = await this.db
      .select({ value: count() })
      .from(studentChatQuestions)
      .where(and(
        eq(studentChatQuestions.lectureId, lecture.id),
        eq(studentChatQuestions.anonymousKey, input.anonymousKey),
        gte(studentChatQuestions.createdAt, input.since)
      ));

    return result?.value ?? 0;
  }

  async moderateStudentChatQuestion(input: ModerateChatQuestionInput, ownerEmail?: string) {
    await this.ensureSeeded();
    const lecture = await this.getLectureById(input.lectureId, ownerEmail);
    if (!lecture) return null;

    await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(studentChatQuestions)
        .where(and(eq(studentChatQuestions.id, input.chatQuestionId), eq(studentChatQuestions.lectureId, input.lectureId)))
        .limit(1);

      if (!existing) return;

      const relevanceReason = input.status === "accepted"
        ? `Vom Referenten als Fragequelle übernommen${input.actor ? ` (${input.actor})` : ""}.`
        : `Vom Referenten ignoriert${input.actor ? ` (${input.actor})` : ""}.`;

      const [updated] = await tx
        .update(studentChatQuestions)
        .set({
          status: input.status,
          relevanceReason,
          sourceTopic: input.status === "accepted" ? existing.sourceTopic ?? lecture.title : existing.sourceTopic,
          moderationProvider: "referent",
          moderationModel: "manual-review",
          moderationConfidence: 100,
          moderationSignals: [input.status === "accepted" ? "manuell übernommen" : "manuell ignoriert"]
        })
        .where(and(eq(studentChatQuestions.id, input.chatQuestionId), eq(studentChatQuestions.lectureId, input.lectureId)))
        .returning();

      if (!updated) return;

      const chatQuestion = this.chatQuestionFromRow(updated);
      const reviewItem = createReviewItemFromChatQuestion(lecture, chatQuestion);
      const [existingReview] = await tx
        .select({ id: questionReviewItems.id, status: questionReviewItems.status })
        .from(questionReviewItems)
        .where(and(eq(questionReviewItems.lectureId, input.lectureId), eq(questionReviewItems.sourceTitle, reviewItem.sourceTitle)))
        .limit(1);

      if (input.status === "accepted" && !existingReview) {
        await tx.insert(questionReviewItems).values({
          lectureId: input.lectureId,
          sourceTitle: reviewItem.sourceTitle,
          status: "draft",
          variantsJson: clone(reviewItem.variants)
        });
      }

      if (input.status === "ignored" && existingReview?.status === "draft") {
        await tx.delete(questionReviewItems).where(eq(questionReviewItems.id, existingReview.id));
      }

      const reviewStatuses = await tx
        .select({ status: questionReviewItems.status })
        .from(questionReviewItems)
        .where(eq(questionReviewItems.lectureId, input.lectureId));
      const hasApproved = reviewStatuses.some((item) => item.status === "approved");
      const hasDraft = reviewStatuses.some((item) => item.status === "draft");
      const [lectureStatus] = await tx.select({ status: lectures.status }).from(lectures).where(eq(lectures.id, input.lectureId)).limit(1);
      if (lectureStatus?.status !== "live" && lectureStatus?.status !== "archived") {
        const status: LectureStatus = hasApproved ? "ready_for_live" : hasDraft ? "question_review" : "material_processing";
        await tx.update(lectures).set({ status }).where(eq(lectures.id, input.lectureId));
      }
    });

    return this.getLectureById(input.lectureId, ownerEmail);
  }

  async submitTranscriptSegment(input: SubmitTranscriptSegmentInput, ownerEmail?: string) {
    await this.ensureSeeded();
    const lecture = await this.getLectureById(input.lectureId, ownerEmail);
    if (!lecture) return null;

    const cleanText = input.text.replace(/\s+/g, " ").trim();
    const relevance = evaluateStudentChatQuestion(lecture, cleanText);
    const [created] = await this.db
      .insert(transcriptSegments)
      .values({
        lectureId: lecture.id,
        text: cleanText,
        provider: input.provider?.trim() || "voxtral-realtime",
        status: relevance.status,
        relevanceReason: relevance.reason,
        sourceTopic: relevance.sourceTopic,
        startedAt: input.startedAt ? toTimestamp(input.startedAt) : undefined,
        endedAt: input.endedAt ? toTimestamp(input.endedAt) : undefined
      })
      .returning();

    const segment = this.transcriptSegmentFromRow(created);
    if (segment.status === "accepted") {
      const reviewItem = createReviewItemFromTranscriptSegment(lecture, segment);
      await this.db.insert(questionReviewItems).values({
        lectureId: lecture.id,
        sourceTitle: reviewItem.sourceTitle,
        status: "draft",
        variantsJson: reviewItem.variants
      });
      if (lecture.status === "draft" || lecture.status === "material_processing") {
        await this.db.update(lectures).set({ status: "question_review" }).where(eq(lectures.id, lecture.id));
      }
    }

    return segment;
  }

  async submitLecturerAssistantMessage(input: SubmitLecturerAssistantMessageInput, ownerEmail?: string) {
    await this.ensureSeeded();
    const lecture = await this.getLectureById(input.lectureId, ownerEmail);
    if (!lecture) return null;

    const cleanMessage = input.message.replace(/\s+/g, " ").trim();
    const slideId = input.slideId && lecture.slides.some((slide) => slide.id === input.slideId) ? input.slideId : undefined;
    if (!cleanMessage) return lecture;

    const createdAt = new Date();
    const assistantReply = await generateLecturerAssistantReply({ lecture, message: cleanMessage, slideId });
    await this.db.insert(lecturerAssistantMessages).values([
      {
        lectureId: input.lectureId,
        slideId,
        role: "lecturer",
        content: cleanMessage,
        sourceRefs: [],
        createdAt
      },
      {
        lectureId: input.lectureId,
        slideId,
        role: "assistant",
        content: assistantReply.content,
        sourceRefs: assistantReply.sourceRefs,
        metadataJson: assistantReply.metadata,
        createdAt: new Date(createdAt.getTime() + 1)
      }
    ]);

    return this.getLectureById(input.lectureId, ownerEmail);
  }

  async createLecturerAssistantReview(input: CreateLecturerAssistantReviewInput, ownerEmail?: string) {
    await this.ensureSeeded();
    const lecture = await this.getLectureById(input.lectureId, ownerEmail);
    if (!lecture) return null;

    const slideId = input.slideId && lecture.slides.some((slide) => slide.id === input.slideId) ? input.slideId : undefined;
    const reviewMaterial = createLecturerAssistantReviewMaterial(lecture, { ...input, slideId });
    const variants = await generateQuestionVariantsForMaterial({
      lecture,
      material: reviewMaterial.material
    });
    const reviewItem = createReviewItemFromLecturerAssistant(lecture, { ...input, slideId, variants });
    const createdAt = new Date();
    await this.db.transaction(async (tx) => {
      const [existingReview] = await tx
        .select({ id: questionReviewItems.id })
        .from(questionReviewItems)
        .where(and(eq(questionReviewItems.lectureId, input.lectureId), eq(questionReviewItems.sourceTitle, reviewItem.sourceTitle)))
        .limit(1);

      if (!existingReview) {
        await tx.insert(questionReviewItems).values({
          lectureId: input.lectureId,
          sourceTitle: reviewItem.sourceTitle,
          status: "draft",
          variantsJson: reviewItem.variants,
          createdAt
        });
        if (lecture.status === "draft" || lecture.status === "material_processing") {
          await tx.update(lectures).set({ status: "question_review" }).where(eq(lectures.id, input.lectureId));
        }
      }

      await tx.insert(lecturerAssistantMessages).values({
        lectureId: input.lectureId,
        slideId,
        role: "assistant",
        content: existingReview
          ? `Der Fragenentwurf "${reviewItem.sourceTitle}" existiert bereits. Ich öffne ihn im Fragenreview.`
          : `Ich habe einen Fragenentwurf für "${reviewItem.sourceTitle.replace(/^Assistent: /, "")}" angelegt. Du kannst die vier Niveaus jetzt im Fragenreview bearbeiten oder freigeben.`,
        sourceRefs: [reviewItem.sourceTitle],
        createdAt: new Date(createdAt.getTime() + 1)
      });
    });

    return this.getLectureById(input.lectureId, ownerEmail);
  }

  async applyLecturerAssistantSlidePoint(input: ApplyLecturerAssistantSlidePointInput, ownerEmail?: string) {
    await this.ensureSeeded();
    const lecture = await this.getLectureById(input.lectureId, ownerEmail);
    if (!lecture) return null;

    const slideId = input.slideId && lecture.slides.some((slide) => slide.id === input.slideId) ? input.slideId : undefined;
    const { slide, line } = createLecturerAssistantSlidePoint({ lecture, ...input, slideId });
    if (!slide) return lecture;

    const copy = slide.copy.includes(line)
      ? slide.copy
      : slide.copy.length >= 4
        ? [...slide.copy.slice(0, 3), line]
        : [...slide.copy, line];

    await this.db.transaction(async (tx) => {
      if (!slide.copy.includes(line)) {
        await tx
          .update(slides)
          .set(normalizeSlidePatch({ ...slide, copy }))
          .where(and(eq(slides.id, slide.id), eq(slides.lectureId, input.lectureId)));
      }

      await tx.insert(lecturerAssistantMessages).values({
        lectureId: input.lectureId,
        slideId: slide.id,
        role: "assistant",
        content: slide.copy.includes(line)
          ? `Der Folienpunkt ist bereits vorhanden: ${line}`
          : `Ich habe diesen Folienpunkt übernommen: ${line}`,
        sourceRefs: [`${slide.eyebrow}: ${slide.title}`],
        createdAt: new Date()
      });
    });

    return this.getLectureById(input.lectureId, ownerEmail);
  }

  async applyLecturerAssistantEvaluationFocus(input: ApplyLecturerAssistantEvaluationFocusInput, ownerEmail?: string) {
    await this.ensureSeeded();
    const lecture = await this.getLectureById(input.lectureId, ownerEmail);
    if (!lecture) return null;

    const slideId = input.slideId && lecture.slides.some((slide) => slide.id === input.slideId) ? input.slideId : undefined;
    const { slide, focus, config } = createLecturerAssistantEvaluationFocus({ lecture, ...input, slideId });
    const evaluationConfig = normalizeEvaluationConfigForUpdate(lecture.evaluationConfig, config);

    await this.db.transaction(async (tx) => {
      await tx
        .update(lectures)
        .set({ evaluationConfig })
        .where(eq(lectures.id, input.lectureId));

      await tx.insert(lecturerAssistantMessages).values({
        lectureId: input.lectureId,
        slideId: slide?.id,
        role: "assistant",
        content: `Ich habe die Evaluation auf "${focus}" ausgerichtet.`,
        sourceRefs: slide ? [`${slide.eyebrow}: ${slide.title}`] : [lecture.title],
        createdAt: new Date()
      });
    });

    return this.getLectureById(input.lectureId, ownerEmail);
  }

  async applyLecturerAssistantLearnDensity(input: ApplyLecturerAssistantLearnDensityInput, ownerEmail?: string) {
    await this.ensureSeeded();
    const lecture = await this.getLectureById(input.lectureId, ownerEmail);
    if (!lecture) return null;

    const slideId = input.slideId && lecture.slides.some((slide) => slide.id === input.slideId) ? input.slideId : undefined;
    const { slide, density, reason } = createLecturerAssistantLearnDensity({ lecture, ...input, slideId });

    await this.db.transaction(async (tx) => {
      await tx
        .update(lectures)
        .set({ learnQuestionDensity: density })
        .where(eq(lectures.id, input.lectureId));

      await tx.insert(lecturerAssistantMessages).values({
        lectureId: input.lectureId,
        slideId: slide?.id,
        role: "assistant",
        content: `Ich habe die Learn-Fragedichte auf ${density} gesetzt. ${reason}`,
        sourceRefs: slide ? [`${slide.eyebrow}: ${slide.title}`] : [lecture.title],
        createdAt: new Date()
      });
    });

    return this.getLectureById(input.lectureId, ownerEmail);
  }

  async createLecturerAssistantSourceNote(input: CreateLecturerAssistantSourceNoteInput, ownerEmail?: string) {
    await this.ensureSeeded();
    const lecture = await this.getLectureById(input.lectureId, ownerEmail);
    if (!lecture) return null;

    const slideId = input.slideId && lecture.slides.some((slide) => slide.id === input.slideId) ? input.slideId : undefined;
    const [lectureRow] = await this.db
      .select({ status: lectures.status })
      .from(lectures)
      .where(eq(lectures.id, input.lectureId))
      .limit(1);
    if (!lectureRow) return null;

    await this.db.transaction(async (tx) => {
      const [existingMaterial] = await tx
        .select({ id: lectureAssets.id })
        .from(lectureAssets)
        .where(and(eq(lectureAssets.lectureId, input.lectureId), eq(lectureAssets.originalName, input.originalName)))
        .limit(1);

      if (!existingMaterial) {
        await tx.insert(lectureAssets).values({
          lectureId: input.lectureId,
          kind: "notes",
          source: "notes",
          originalName: input.originalName,
          storageKey: input.storageUrl,
          sizeBytes: input.sizeBytes,
          status: "uploaded"
        });

        if (lectureRow.status === "draft") {
          await tx.update(lectures).set({ status: "material_processing" }).where(eq(lectures.id, input.lectureId));
        }
      }

      await tx.insert(lecturerAssistantMessages).values({
        lectureId: input.lectureId,
        slideId,
        role: "assistant",
        content: existingMaterial
          ? `Die Quellen-Notiz ist bereits vorhanden: ${input.originalName}`
          : `Ich habe eine Quellen-Notiz angelegt: ${input.originalName}`,
        sourceRefs: [input.originalName],
        createdAt: new Date()
      });
    });

    return this.getLectureById(input.lectureId, ownerEmail);
  }

  async recordStandaloneExport(input: RecordStandaloneExportInput, ownerEmail?: string) {
    await this.ensureSeeded();
    const lecture = await this.getLectureById(input.lectureId, ownerEmail);
    if (!lecture) return null;

    const [created] = await this.db
      .insert(standaloneExports)
      .values({
        lectureId: input.lectureId,
        version: input.version,
        storageUrl: input.storageUrl,
        sha256: input.sha256
      })
      .returning();

    return this.standaloneExportFromRow(created);
  }

  async createStandaloneExportJob(input: CreateStandaloneExportJobInput, ownerEmail?: string) {
    await this.ensureSeeded();
    const lecture = await this.getLectureById(input.lectureId, ownerEmail);
    if (!lecture) return null;

    const [created] = await this.db
      .insert(standaloneExportJobs)
      .values({
        lectureId: input.lectureId,
        format: input.format,
        requestedBy: input.requestedBy,
        maxAttempts: configuredWorkerMaxAttempts()
      })
      .returning();

    return this.standaloneExportJobFromRow(created);
  }

  async updateStandaloneExportJob(jobId: string, input: UpdateStandaloneExportJobInput) {
    await this.ensureSeeded();
    const [updated] = await this.db
      .update(standaloneExportJobs)
      .set({
        status: input.status,
        standaloneExportId: input.standaloneExportId,
        provider: input.provider,
        providerJobId: input.providerJobId,
        storageUrl: input.storageUrl,
        sha256: input.sha256,
        message: input.message,
        nextAttemptAt: input.nextAttemptAt ? new Date(input.nextAttemptAt) : undefined,
        deadLetterAt: input.deadLetterAt ? new Date(input.deadLetterAt) : undefined,
        startedAt: input.startedAt ? new Date(input.startedAt) : undefined,
        completedAt: input.completedAt ? new Date(input.completedAt) : undefined,
        durationMs: input.durationMs
      })
      .where(eq(standaloneExportJobs.id, jobId))
      .returning();

    return updated ? this.standaloneExportJobFromRow(updated) : null;
  }

  async decideQuestionReview(lectureId: string, reviewId: string, decision: "approved" | "rejected", actor = "referent", ownerEmail?: string) {
    await this.ensureSeeded();
    const lecture = await this.getLectureById(lectureId, ownerEmail);
    if (!lecture) return null;
    await this.db.transaction(async (tx) => {
      const [review] = await tx
        .select()
        .from(questionReviewItems)
        .where(and(eq(questionReviewItems.id, reviewId), eq(questionReviewItems.lectureId, lectureId)))
        .limit(1);

      if (!review) return;

      const decidedVariants = applyQualityDecision({
        variants: coerceVariants(review.variantsJson),
        decision,
        actor
      });

      await tx
        .update(questionReviewItems)
        .set({
          status: decision,
          reviewedAt: new Date(),
          variantsJson: clone(decidedVariants)
        })
        .where(and(eq(questionReviewItems.id, reviewId), eq(questionReviewItems.lectureId, lectureId)));

      if (decision === "approved") {
        await this.replaceActiveQuestionsInTransaction(tx, lectureId, decidedVariants, review.sourceTitle);
        await tx.update(lectures).set({ status: "ready_for_live" }).where(eq(lectures.id, lectureId));
        return;
      }

      const reviews = await tx.select({ status: questionReviewItems.status }).from(questionReviewItems).where(eq(questionReviewItems.lectureId, lectureId));
      const hasApproved = reviews.some((item) => item.status === "approved");
      const hasDraft = reviews.some((item) => item.status === "draft");
      const status: LectureStatus = hasApproved ? "ready_for_live" : hasDraft ? "question_review" : "material_processing";
      await tx.update(lectures).set({ status }).where(eq(lectures.id, lectureId));
    });

    return this.getLectureById(lectureId, ownerEmail);
  }

  async updateQuestionReview(lectureId: string, reviewId: string, variants: QuestionVariant[], actor = "referent", ownerEmail?: string) {
    await this.ensureSeeded();
    const lecture = await this.getLectureById(lectureId, ownerEmail);
    if (!lecture) return null;
    await this.db.transaction(async (tx) => {
      const [review] = await tx
        .select()
        .from(questionReviewItems)
        .where(and(eq(questionReviewItems.id, reviewId), eq(questionReviewItems.lectureId, lectureId)))
        .limit(1);

      if (!review) return;

      const nextVariants = recordReviewEdits({
        previousVariants: coerceVariants(review.variantsJson),
        nextVariants: variants,
        actor
      });

      await tx
        .update(questionReviewItems)
        .set({ variantsJson: clone(nextVariants) })
        .where(and(eq(questionReviewItems.id, reviewId), eq(questionReviewItems.lectureId, lectureId)));

      if (review.status === "approved") {
        await this.replaceActiveQuestionsInTransaction(tx, lectureId, nextVariants, review.sourceTitle);
      }
    });

    return this.getLectureById(lectureId, ownerEmail);
  }

  private async getLectureById(id: string, ownerEmail?: string) {
    const owner = normalizeOwnerEmail(ownerEmail);
    const selectLecture = () => this.db
      .select({ lecture: lectures, series: lectureSeries, owner: users })
      .from(lectures)
      .leftJoin(lectureSeries, eq(lectures.seriesId, lectureSeries.id))
      .leftJoin(users, eq(lectureSeries.ownerId, users.id));
    const rows = owner
      ? await selectLecture().where(and(eq(lectures.id, id), eq(users.email, owner))).limit(1)
      : await selectLecture().where(eq(lectures.id, id)).limit(1);

    const [lecture] = await this.hydrateLectures(rows);
    return lecture ?? null;
  }

  private async findOrCreateSeries(title: string, ownerId?: string) {
    if (ownerId) {
      const [owned] = await this.db
        .select({
          id: lectureSeries.id,
          evaluationConfig: lectureSeries.evaluationConfig,
          aiDailyLimit: lectureSeries.aiDailyLimit,
          aiDailyTokenLimit: lectureSeries.aiDailyTokenLimit,
          ownerId: lectureSeries.ownerId
        })
        .from(lectureSeries)
        .where(and(eq(lectureSeries.title, title), eq(lectureSeries.ownerId, ownerId)))
        .limit(1);
      if (owned) return owned;

      const [unowned] = await this.db
        .select({
          id: lectureSeries.id,
          evaluationConfig: lectureSeries.evaluationConfig,
          aiDailyLimit: lectureSeries.aiDailyLimit,
          aiDailyTokenLimit: lectureSeries.aiDailyTokenLimit,
          ownerId: lectureSeries.ownerId
        })
        .from(lectureSeries)
        .where(and(eq(lectureSeries.title, title), isNull(lectureSeries.ownerId)))
        .limit(1);
      if (unowned) {
        await this.db.update(lectureSeries).set({ ownerId }).where(eq(lectureSeries.id, unowned.id));
        return { ...unowned, ownerId };
      }
    }

    const [existing] = await this.db
      .select({
        id: lectureSeries.id,
        evaluationConfig: lectureSeries.evaluationConfig,
        aiDailyLimit: lectureSeries.aiDailyLimit,
        aiDailyTokenLimit: lectureSeries.aiDailyTokenLimit,
        ownerId: lectureSeries.ownerId
      })
      .from(lectureSeries)
      .where(eq(lectureSeries.title, title))
      .limit(1);
    if (existing && !ownerId) return existing;

    const [created] = await this.db
      .insert(lectureSeries)
      .values({
        title,
        language: "de",
        ownerId,
        aiDailyLimit: configuredDefaultAiDailyLimit(),
        aiDailyTokenLimit: configuredDefaultAiDailyTokenLimit(),
        evaluationConfig: normalizeEvaluationConfig(undefined)
      })
      .returning({
        id: lectureSeries.id,
        evaluationConfig: lectureSeries.evaluationConfig,
        aiDailyLimit: lectureSeries.aiDailyLimit,
        aiDailyTokenLimit: lectureSeries.aiDailyTokenLimit,
        ownerId: lectureSeries.ownerId
      });
    return created;
  }

  private async findOrCreateUser(email: string) {
    const cleanEmail = email.trim().toLowerCase();
    const [user] = await this.db
      .insert(users)
      .values({
        email: cleanEmail,
        role: "lecturer",
        aiDailyLimit: configuredDefaultAiDailyLimit(),
        aiDailyTokenLimit: configuredDefaultAiDailyTokenLimit()
      })
      .onConflictDoUpdate({
        target: users.email,
        set: {
          email: cleanEmail
        }
      })
      .returning();

    return user;
  }

  private async findOrCreateParticipantSession(input: { lectureId: string; anonymousKey: string; pseudonym: string }) {
    const [session] = await this.db
      .insert(participantSessions)
      .values({
        lectureId: input.lectureId,
        anonymousKey: input.anonymousKey,
        pseudonym: input.pseudonym
      })
      .onConflictDoUpdate({
        target: [participantSessions.lectureId, participantSessions.anonymousKey],
        set: {
          pseudonym: input.pseudonym,
          lastSeenAt: new Date()
        }
      })
      .returning({ id: participantSessions.id });

    return session.id;
  }

  private async ensureSeeded() {
    if (this.seeded) return;
    if (!shouldAutoSeedDemo()) {
      this.seeded = true;
      return;
    }

    const [existingDemo] = await this.db
      .select({ id: lectures.id })
      .from(lectures)
      .where(eq(lectures.publicToken, demoLecture.publicToken))
      .limit(1);

    if (existingDemo) {
      this.seeded = true;
      return;
    }

    const series = await this.findOrCreateSeries(demoLecture.seriesTitle);
    await this.db
      .update(lectureSeries)
      .set({
        aiDailyLimit: normalizeAiDailyLimit(demoLecture.seriesAiDailyLimit ?? demoLecture.aiDailyLimit),
        aiDailyTokenLimit: normalizeAiDailyTokenLimit(demoLecture.seriesAiDailyTokenLimit ?? demoLecture.aiDailyTokenLimit),
        evaluationConfig: normalizeEvaluationConfig(demoLecture.evaluationConfig)
      })
      .where(eq(lectureSeries.id, series.id));
    const [lecture] = await this.db
      .insert(lectures)
      .values({
        seriesId: series.id,
        publicToken: demoLecture.publicToken,
        title: demoLecture.title,
        status: demoLecture.status,
        liveAt: toTimestamp(demoLecture.liveAt),
        examDate: toTimestamp(demoLecture.examDate),
        aiAccessUntil: toTimestamp(demoLecture.aiAccessUntil),
        aiDailyLimit: normalizeAiDailyLimit(demoLecture.aiDailyLimit),
        aiDailyTokenLimit: normalizeAiDailyTokenLimit(demoLecture.aiDailyTokenLimit),
        leaderboardEnabled: demoLecture.leaderboardEnabled,
        learnQuestionDensity: normalizeLearnQuestionDensity(demoLecture.learnQuestionDensity),
        evaluationConfig: normalizeEvaluationConfig(demoLecture.evaluationConfig)
      })
      .returning();

    await this.insertSlides(lecture.id, demoLecture.slides);
    await this.replaceActiveQuestions(lecture.id, clone(demoLecture.questions), "demo_seed");
    this.seeded = true;
  }

  private async insertSlides(lectureId: string, slideItems: Slide[]) {
    if (slideItems.length === 0) return;

    await this.db.insert(slides).values(
      slideItems.map((slide, index) => ({
        lectureId,
        position: index + 1,
        title: slide.title,
        contentJson: {
          eyebrow: slide.eyebrow,
          topic: slide.topic,
          copy: slide.copy,
          diagram: slide.diagram
        }
      }))
    );
  }

  private async updateSlides(lectureId: string, slideItems: Slide[]) {
    if (slideItems.length === 0) return;

    await this.db.transaction(async (tx) => {
      for (const slide of slideItems) {
        await tx
          .update(slides)
          .set(normalizeSlidePatch(slide))
          .where(and(eq(slides.id, slide.id), eq(slides.lectureId, lectureId)));
      }
    });
  }

  private async replaceActiveQuestions(lectureId: string, variants: QuestionVariant[], source: string) {
    await this.db.transaction(async (tx) => {
      await this.replaceActiveQuestionsInTransaction(tx, lectureId, variants, source);
    });
  }

  private async replaceActiveQuestionsInTransaction(
    tx: Parameters<Parameters<typeof this.db.transaction>[0]>[0],
    lectureId: string,
    variants: QuestionVariant[],
    source: string
  ) {
    const existingQuestions = await tx.select({ id: questions.id }).from(questions).where(eq(questions.lectureId, lectureId));
    const questionIds = existingQuestions.map((question) => question.id);

    if (questionIds.length > 0) {
      await tx.delete(questionVariants).where(inArray(questionVariants.questionId, questionIds));
      await tx.delete(questions).where(eq(questions.lectureId, lectureId));
    }

    const [question] = await tx.insert(questions).values({ lectureId, source }).returning({ id: questions.id });
    await tx.insert(questionVariants).values(
      variants.map((variant) => ({
        questionId: question.id,
        level: variant.level,
        points: variant.points,
        text: variant.text,
        answersJson: clone(variant.answers),
        correctAnswerKey: variant.answers.find((answer) => answer.correct)?.key ?? "A",
        explanation: variant.explanation,
        promptVersion: variant.promptVersion ?? "unknown"
      }))
    );
  }

  private async hydrateLectures(rows: LectureJoinRow[]) {
    const lectureIds = rows.map((row) => row.lecture.id);
    if (lectureIds.length === 0) return [];

    const [
      slideRows,
      assetRows,
      chunkRows,
      processingRunRows,
      chatQuestionRows,
      transcriptSegmentRows,
      assistantMessageRows,
      standaloneExportRows,
      standaloneExportJobRows,
      reviewRows,
      questionRows
    ] = await Promise.all([
      this.db.select().from(slides).where(inArray(slides.lectureId, lectureIds)),
      this.db.select().from(lectureAssets).where(inArray(lectureAssets.lectureId, lectureIds)),
      this.db.select().from(assetChunks).where(inArray(assetChunks.lectureId, lectureIds)),
      this.db.select().from(materialProcessingRuns).where(inArray(materialProcessingRuns.lectureId, lectureIds)),
      this.db.select().from(studentChatQuestions).where(inArray(studentChatQuestions.lectureId, lectureIds)),
      this.db.select().from(transcriptSegments).where(inArray(transcriptSegments.lectureId, lectureIds)),
      this.db.select().from(lecturerAssistantMessages).where(inArray(lecturerAssistantMessages.lectureId, lectureIds)),
      this.db.select().from(standaloneExports).where(inArray(standaloneExports.lectureId, lectureIds)),
      this.db.select().from(standaloneExportJobs).where(inArray(standaloneExportJobs.lectureId, lectureIds)),
      this.db.select().from(questionReviewItems).where(inArray(questionReviewItems.lectureId, lectureIds)),
      this.db.select().from(questions).where(inArray(questions.lectureId, lectureIds))
    ]);

    const questionIds = questionRows.map((question) => question.id);
    const variantRows = questionIds.length > 0
      ? await this.db.select().from(questionVariants).where(inArray(questionVariants.questionId, questionIds))
      : [];

    return rows.map((row) =>
      this.lectureFromRows(
        row,
        slideRows.filter((slide) => slide.lectureId === row.lecture.id),
        assetRows.filter((asset) => asset.lectureId === row.lecture.id),
        chunkRows.filter((chunk) => chunk.lectureId === row.lecture.id),
        processingRunRows.filter((runItem) => runItem.lectureId === row.lecture.id),
        chatQuestionRows.filter((chatQuestion) => chatQuestion.lectureId === row.lecture.id),
        transcriptSegmentRows.filter((segment) => segment.lectureId === row.lecture.id),
        assistantMessageRows.filter((message) => message.lectureId === row.lecture.id),
        standaloneExportRows.filter((exportRecord) => exportRecord.lectureId === row.lecture.id),
        standaloneExportJobRows.filter((job) => job.lectureId === row.lecture.id),
        reviewRows.filter((review) => review.lectureId === row.lecture.id),
        questionRows.filter((question) => question.lectureId === row.lecture.id),
        variantRows
      )
    );
  }

  private lectureFromRows(
    row: LectureJoinRow,
    slideRows: SlideRow[],
    assetRows: AssetRow[],
    chunkRows: ChunkRow[],
    processingRunRows: ProcessingRunRow[],
    chatQuestionRows: ChatQuestionRow[],
    transcriptSegmentRows: TranscriptSegmentRow[],
    assistantMessageRows: AssistantMessageRow[],
    standaloneExportRows: StandaloneExportRow[],
    standaloneExportJobRows: StandaloneExportJobRow[],
    reviewRows: ReviewRow[],
    questionRows: QuestionRow[],
    variantRows: VariantRow[]
  ): Lecture {
    const questionIds = new Set(questionRows.map((question) => question.id));
    const questionsForLecture = variantRows
      .filter((variant) => questionIds.has(variant.questionId))
      .map((variant) => this.variantFromRow(variant))
      .sort((left, right) => questionLevelOrder[left.level] - questionLevelOrder[right.level]);

    return {
      id: row.lecture.id,
      publicToken: row.lecture.publicToken,
      title: row.lecture.title,
      seriesTitle: row.series?.title ?? "Maschinenelemente I",
      language: "de",
      status: coerceLectureStatus(row.lecture.status),
      liveAt: toIso(row.lecture.liveAt),
      examDate: normalizeExamDate(row.lecture.examDate),
      aiAccessUntil: toIso(row.lecture.aiAccessUntil),
      aiDailyLimit: normalizeAiDailyLimit(row.lecture.aiDailyLimit),
      aiDailyTokenLimit: normalizeAiDailyTokenLimit(row.lecture.aiDailyTokenLimit),
      seriesAiDailyLimit: normalizeAiDailyLimit(row.series?.aiDailyLimit, row.lecture.aiDailyLimit),
      seriesAiDailyTokenLimit: normalizeAiDailyTokenLimit(row.series?.aiDailyTokenLimit, row.lecture.aiDailyTokenLimit),
      tenantAiDailyLimit: normalizeAiDailyLimit(row.owner?.aiDailyLimit, row.series?.aiDailyLimit ?? row.lecture.aiDailyLimit),
      tenantAiDailyTokenLimit: normalizeAiDailyTokenLimit(row.owner?.aiDailyTokenLimit, row.series?.aiDailyTokenLimit ?? row.lecture.aiDailyTokenLimit),
      tenantBudgetKey: row.owner?.id ?? row.series?.id ?? row.lecture.id,
      leaderboardEnabled: row.lecture.leaderboardEnabled,
      learnQuestionDensity: normalizeLearnQuestionDensity(row.lecture.learnQuestionDensity),
      evaluationConfig: normalizeEvaluationConfig(row.lecture.evaluationConfig),
      slides: slideRows.sort((left, right) => left.position - right.position).map((slide) => this.slideFromRow(slide)),
      questions: questionsForLecture,
      materials: assetRows
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
        .map((asset) => this.materialFromRow(asset, chunkRows.filter((chunk) => chunk.assetId === asset.id))),
      materialProcessingRuns: processingRunRows
        .sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime())
        .map((runItem) => this.processingRunFromRow(runItem)),
      studentChatQuestions: chatQuestionRows
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
        .map((chatQuestion) => this.chatQuestionFromRow(chatQuestion)),
      transcriptSegments: transcriptSegmentRows
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
        .map((segment) => this.transcriptSegmentFromRow(segment)),
      assistantMessages: assistantMessageRows
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
        .map((message) => this.assistantMessageFromRow(message)),
      standaloneExports: standaloneExportRows
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
        .map((exportRecord) => this.standaloneExportFromRow(exportRecord)),
      standaloneExportJobs: standaloneExportJobRows
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
        .map((job) => this.standaloneExportJobFromRow(job)),
      questionReviews: reviewRows
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
        .map((review) => this.reviewFromRow(review))
    };
  }

  private slideFromRow(row: SlideRow): Slide {
    const content = row.contentJson as Partial<Slide>;
    return {
      id: row.id,
      eyebrow: typeof content.eyebrow === "string" ? content.eyebrow : `Folie ${row.position}`,
      title: row.title,
      topic: typeof content.topic === "string" ? content.topic : row.title,
      copy: Array.isArray(content.copy) ? content.copy.filter((line): line is string => typeof line === "string") : [],
      diagram: content.diagram === "formula" || content.diagram === "ramp" ? content.diagram : "bearing"
    };
  }

  private materialFromRow(row: AssetRow, chunkRows: ChunkRow[] = []): LectureMaterial {
    const orderedChunks = chunkRows.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
    const preview = orderedChunks[0]?.content.replace(/\s+/g, " ").slice(0, 220);
    return {
      id: row.id,
      lectureId: row.lectureId,
      kind: coerceMaterialKind(row.kind),
      source: coerceMaterialSource(row.source),
      originalName: row.originalName,
      storageUrl: row.storageKey,
      sizeBytes: row.sizeBytes ?? undefined,
      status: coerceMaterialStatus(row.status),
      chunkCount: orderedChunks.length || undefined,
      extractedTextPreview: preview || undefined,
      sourceRefs: orderedChunks.length > 0 ? orderedChunks.map((chunk) => chunk.sourceRef) : undefined,
      createdAt: row.createdAt.toISOString()
    };
  }

  private processingRunFromRow(row: ProcessingRunRow): MaterialProcessingRun {
    return {
      id: row.id,
      lectureId: row.lectureId,
      status: coerceProcessingRunStatus(row.status),
      materialCount: row.materialCount,
      chunkCount: row.chunkCount,
      reviewCount: row.reviewCount,
      attemptCount: row.attemptCount,
      maxAttempts: row.maxAttempts,
      provider: row.provider ?? undefined,
      providerJobId: row.providerJobId ?? undefined,
      message: row.message ?? undefined,
      steps: coerceProcessingSteps(row.stepsJson),
      nextAttemptAt: row.nextAttemptAt?.toISOString(),
      deadLetterAt: row.deadLetterAt?.toISOString(),
      startedAt: row.startedAt.toISOString(),
      completedAt: row.completedAt?.toISOString(),
      durationMs: row.durationMs ?? undefined
    };
  }

  private chatQuestionFromRow(row: ChatQuestionRow): StudentChatQuestion {
    return {
      id: row.id,
      lectureId: row.lectureId,
      pseudonym: row.pseudonym,
      anonymousKey: row.anonymousKey ?? undefined,
      text: row.questionText,
      status: coerceChatQuestionStatus(row.status),
      relevanceReason: row.relevanceReason,
      sourceTopic: row.sourceTopic ?? undefined,
      moderationProvider: row.moderationProvider ?? undefined,
      moderationModel: row.moderationModel ?? undefined,
      moderationConfidence: row.moderationConfidence ?? undefined,
      moderationSignals: Array.isArray(row.moderationSignals)
        ? row.moderationSignals.filter((item): item is string => typeof item === "string")
        : undefined,
      createdAt: row.createdAt.toISOString()
    };
  }

  private transcriptSegmentFromRow(row: TranscriptSegmentRow): TranscriptSegment {
    return {
      id: row.id,
      lectureId: row.lectureId,
      text: row.text,
      provider: row.provider,
      status: coerceTranscriptSegmentStatus(row.status),
      relevanceReason: row.relevanceReason,
      sourceTopic: row.sourceTopic ?? undefined,
      startedAt: row.startedAt?.toISOString(),
      endedAt: row.endedAt?.toISOString(),
      createdAt: row.createdAt.toISOString()
    };
  }

  private assistantMessageFromRow(row: AssistantMessageRow): LecturerAssistantMessage {
    return {
      id: row.id,
      lectureId: row.lectureId,
      role: coerceAssistantRole(row.role),
      content: row.content,
      slideId: row.slideId ?? undefined,
      sourceRefs: coerceStringArray(row.sourceRefs),
      metadata: coerceAssistantMetadata(row.metadataJson),
      createdAt: row.createdAt.toISOString()
    };
  }

  private standaloneExportFromRow(row: StandaloneExportRow): StandaloneExport {
    return {
      id: row.id,
      lectureId: row.lectureId,
      version: row.version,
      storageUrl: row.storageUrl ?? undefined,
      sha256: row.sha256 ?? undefined,
      createdAt: row.createdAt.toISOString()
    };
  }

  private standaloneExportJobFromRow(row: StandaloneExportJobRow): StandaloneExportJob {
    return {
      id: row.id,
      lectureId: row.lectureId,
      status: coerceStandaloneExportJobStatus(row.status),
      format: "archive_zip",
      requestedBy: row.requestedBy ?? undefined,
      attemptCount: row.attemptCount,
      maxAttempts: row.maxAttempts,
      provider: row.provider ?? undefined,
      providerJobId: row.providerJobId ?? undefined,
      standaloneExportId: row.standaloneExportId ?? undefined,
      storageUrl: row.storageUrl ?? undefined,
      sha256: row.sha256 ?? undefined,
      message: row.message ?? undefined,
      nextAttemptAt: row.nextAttemptAt?.toISOString(),
      deadLetterAt: row.deadLetterAt?.toISOString(),
      startedAt: row.startedAt?.toISOString(),
      completedAt: row.completedAt?.toISOString(),
      durationMs: row.durationMs ?? undefined,
      createdAt: row.createdAt.toISOString()
    };
  }

  private variantFromRow(row: VariantRow): QuestionVariant {
    return {
      level: coerceLevel(row.level),
      points: row.points,
      text: row.text,
      answers: coerceAnswers(row.answersJson, row.correctAnswerKey),
      explanation: row.explanation,
      promptVersion: row.promptVersion,
      reviewStatus: "approved"
    };
  }

  private reviewFromRow(row: ReviewRow): QuestionReviewItem {
    return {
      id: row.id,
      lectureId: row.lectureId,
      sourceMaterialId: row.sourceMaterialId ?? undefined,
      sourceTitle: row.sourceTitle,
      status: coerceReviewStatus(row.status),
      variants: coerceVariants(row.variantsJson),
      createdAt: row.createdAt.toISOString(),
      reviewedAt: row.reviewedAt?.toISOString()
    };
  }
}
