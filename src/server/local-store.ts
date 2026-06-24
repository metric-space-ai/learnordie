import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { demoLecture } from "@/lib/demo-data";
import { normalizeEvaluationConfig, normalizeEvaluationConfigForUpdate } from "@/lib/evaluation";
import { normalizeLearnQuestionDensity } from "@/lib/learn-settings";
import {
  buildLegacyLectureSlideDocument,
  legacySlidesFromSlideDocument,
  normalizeLectureSlideDocument
} from "@/lib/slide-documents";
import type {
  Lecture,
  LecturerAssistantMessage,
  LectureMaterial,
  LectureStatus,
  MaterialProcessingRun,
  MaterialProcessingStep,
  QuestionReviewItem,
  QuestionVariant,
  Slide,
  StandaloneExport,
  StandaloneExportJob,
  StandaloneExportJobStatus,
  StudentChatQuestion,
  TranscriptSegment
} from "@/lib/types";
import type { SlideDocument } from "@learnordie/slide-engine";
import { moderateStudentChatQuestion as moderateChatQuestionWithProvider } from "./chat-question-moderation";
import { evaluateStudentChatQuestion } from "./chat-question-filter";
import {
  configuredDefaultAiDailyLimit,
  configuredDefaultAiDailyTokenLimit,
  normalizeAiDailyLimit,
  normalizeAiDailyTokenLimit
} from "./ai-budget";
import {
  aiAccessUntilFromExamDate,
  clone,
  createLecturerAssistantReviewMaterial,
  createDefaultSlides,
  createReviewItemFromLecturerAssistant,
  createReviewItemFromChatQuestion,
  createReviewItemFromTranscriptSegment,
  normalizeExamDate,
  slugify
} from "./lecture-factory";
import { createPresentationAssetDrafts, processMaterialContent } from "./material-pipeline";
import { generateQuestionVariantsForMaterial } from "./question-generation";
import { getJobProvider } from "./providers/jobs";
import { getStorageProvider } from "./providers/storage";
import { applyQualityDecision, recordReviewEdits } from "./question-review-metadata";
import { createLecturerAssistantEvaluationFocus, createLecturerAssistantLearnDensity, createLecturerAssistantSlidePoint, generateLecturerAssistantReply } from "./lecturer-assistant";

const STORE_PATH = path.join(process.cwd(), ".data", "learnbuddy-local.json");

type LocalStoreData = {
  lectures: Lecture[];
  seriesEvaluationTemplates?: Record<string, Lecture["evaluationConfig"]>;
  seriesAiBudgets?: Record<string, { aiDailyLimit: number; aiDailyTokenLimit: number }>;
  tenantAiBudgets?: Record<string, { aiDailyLimit: number; aiDailyTokenLimit: number }>;
};

type CreateLectureInput = {
  title: string;
  seriesTitle: string;
  liveAt: string;
  examDate: string;
};

type UpdateLectureInput = {
  title?: string;
  seriesTitle?: string;
  liveAt?: string;
  examDate?: string;
  status?: LectureStatus;
  aiDailyLimit?: number;
  aiDailyTokenLimit?: number;
  seriesAiDailyLimit?: number;
  seriesAiDailyTokenLimit?: number;
  tenantAiDailyLimit?: number;
  tenantAiDailyTokenLimit?: number;
  leaderboardEnabled?: boolean;
  learnQuestionDensity?: number;
  evaluationConfig?: unknown;
  saveEvaluationAsSeriesTemplate?: boolean;
  slides?: Slide[];
  slideDocument?: SlideDocument;
  questions?: QuestionVariant[];
};

type AddMaterialInput = {
  kind: LectureMaterial["kind"];
  source: LectureMaterial["source"];
  originalName: string;
  storageUrl: string;
  sizeBytes?: number;
};

function normalizeSlideUpdate(existing: Slide, next?: Slide): Slide {
  if (!next) return existing;
  const copy = Array.isArray(next.copy)
    ? next.copy.map((line) => line.trim()).filter(Boolean).slice(0, 4)
    : existing.copy;

  return {
    ...existing,
    eyebrow: next.eyebrow?.trim() || existing.eyebrow,
    title: next.title?.trim() || existing.title,
    topic: next.topic?.trim() || existing.topic,
    copy: copy.length > 0 ? copy : existing.copy,
    diagram: next.diagram === "formula" || next.diagram === "ramp" || next.diagram === "bearing" ? next.diagram : existing.diagram
  };
}

type ReviewDecision = "approved" | "rejected";

function normalizeDateTime(value: string) {
  if (!value) return new Date().toISOString();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00.000Z`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return `${value}:00.000Z`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) return `${value}.000Z`;
  return new Date(value).toISOString();
}

function normalizeOwnerEmail(value?: string) {
  const clean = value?.trim().toLowerCase();
  return clean || undefined;
}

function canAccessLecture(lecture: Lecture, ownerEmail?: string) {
  const owner = normalizeOwnerEmail(ownerEmail);
  if (!owner) return true;
  return !lecture.ownerEmail || lecture.ownerEmail === owner;
}

async function readStoredText(storageUrl: string) {
  try {
    return await getStorageProvider().readText(storageUrl);
  } catch {
    return "";
  }
}

function localSeriesBudget(store: LocalStoreData, seriesTitle: string) {
  const stored = store.seriesAiBudgets?.[seriesTitle];
  return {
    aiDailyLimit: normalizeAiDailyLimit(stored?.aiDailyLimit, configuredDefaultAiDailyLimit()),
    aiDailyTokenLimit: normalizeAiDailyTokenLimit(stored?.aiDailyTokenLimit, configuredDefaultAiDailyTokenLimit())
  };
}

function setLocalSeriesBudget(store: LocalStoreData, seriesTitle: string, budget: { aiDailyLimit?: number; aiDailyTokenLimit?: number }) {
  const current = localSeriesBudget(store, seriesTitle);
  store.seriesAiBudgets ??= {};
  store.seriesAiBudgets[seriesTitle] = {
    aiDailyLimit: normalizeAiDailyLimit(budget.aiDailyLimit, current.aiDailyLimit),
    aiDailyTokenLimit: normalizeAiDailyTokenLimit(budget.aiDailyTokenLimit, current.aiDailyTokenLimit)
  };
}

function applyLocalSeriesBudgets(store: LocalStoreData) {
  for (const lecture of store.lectures) {
    const seriesBudget = localSeriesBudget(store, lecture.seriesTitle);
    lecture.seriesAiDailyLimit = seriesBudget.aiDailyLimit;
    lecture.seriesAiDailyTokenLimit = seriesBudget.aiDailyTokenLimit;
  }
}

function localTenantBudget(store: LocalStoreData, ownerEmail?: string) {
  const key = normalizeOwnerEmail(ownerEmail) ?? "local";
  const stored = store.tenantAiBudgets?.[key];
  return {
    key,
    aiDailyLimit: normalizeAiDailyLimit(stored?.aiDailyLimit, configuredDefaultAiDailyLimit()),
    aiDailyTokenLimit: normalizeAiDailyTokenLimit(stored?.aiDailyTokenLimit, configuredDefaultAiDailyTokenLimit())
  };
}

function setLocalTenantBudget(store: LocalStoreData, ownerEmail: string | undefined, budget: { aiDailyLimit?: number; aiDailyTokenLimit?: number }) {
  const current = localTenantBudget(store, ownerEmail);
  store.tenantAiBudgets ??= {};
  store.tenantAiBudgets[current.key] = {
    aiDailyLimit: normalizeAiDailyLimit(budget.aiDailyLimit, current.aiDailyLimit),
    aiDailyTokenLimit: normalizeAiDailyTokenLimit(budget.aiDailyTokenLimit, current.aiDailyTokenLimit)
  };
}

function applyLocalTenantBudgets(store: LocalStoreData, ownerEmail?: string) {
  if (!ownerEmail) {
    for (const lecture of store.lectures) {
      const tenantBudget = localTenantBudget(store, lecture.ownerEmail);
      lecture.tenantAiDailyLimit = tenantBudget.aiDailyLimit;
      lecture.tenantAiDailyTokenLimit = tenantBudget.aiDailyTokenLimit;
      lecture.tenantBudgetKey = tenantBudget.key;
    }
    return;
  }

  const tenantBudget = localTenantBudget(store, ownerEmail);
  for (const lecture of store.lectures) {
    if (ownerEmail && !canAccessLecture(lecture, ownerEmail)) continue;
    lecture.tenantAiDailyLimit = tenantBudget.aiDailyLimit;
    lecture.tenantAiDailyTokenLimit = tenantBudget.aiDailyTokenLimit;
    lecture.tenantBudgetKey = tenantBudget.key;
  }
}

async function ensureStore() {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });

  try {
    await fs.access(STORE_PATH);
  } catch {
    const demoSlides = clone(demoLecture.slides);
    const seed: LocalStoreData = {
      lectures: [{
        ...clone(demoLecture),
        slides: demoSlides,
        slideDocument: buildLegacyLectureSlideDocument({
          id: demoLecture.id,
          title: demoLecture.title,
          seriesTitle: demoLecture.seriesTitle,
          language: demoLecture.language,
          slides: demoSlides
        }),
        materials: [],
        questionReviews: [],
        materialProcessingRuns: [],
        studentChatQuestions: [],
        transcriptSegments: [],
        assistantMessages: [],
        standaloneExports: [],
        standaloneExportJobs: []
      }]
    };
    await writeStore(seed);
  }
}

async function readStore() {
  await ensureStore();
  const raw = await fs.readFile(STORE_PATH, "utf8");
  const data = JSON.parse(raw) as LocalStoreData;
  data.seriesEvaluationTemplates = Object.fromEntries(
    Object.entries(data.seriesEvaluationTemplates ?? {}).map(([seriesTitle, config]) => [
      seriesTitle,
      normalizeEvaluationConfig(config)
    ])
  );
  data.seriesAiBudgets = Object.fromEntries(
    Object.entries(data.seriesAiBudgets ?? {}).map(([seriesTitle, budget]) => [
      seriesTitle,
      {
        aiDailyLimit: normalizeAiDailyLimit(budget.aiDailyLimit, configuredDefaultAiDailyLimit()),
        aiDailyTokenLimit: normalizeAiDailyTokenLimit(budget.aiDailyTokenLimit, configuredDefaultAiDailyTokenLimit())
      }
    ])
  );
  data.tenantAiBudgets = Object.fromEntries(
    Object.entries(data.tenantAiBudgets ?? {}).map(([tenantKey, budget]) => [
      tenantKey,
      {
        aiDailyLimit: normalizeAiDailyLimit(budget.aiDailyLimit, configuredDefaultAiDailyLimit()),
        aiDailyTokenLimit: normalizeAiDailyTokenLimit(budget.aiDailyTokenLimit, configuredDefaultAiDailyTokenLimit())
      }
    ])
  );
  data.lectures = data.lectures.map((lecture) => {
    const slides = Array.isArray(lecture.slides) ? lecture.slides : [];
    return {
      ...lecture,
      slides,
      slideDocument: normalizeLectureSlideDocument(lecture.slideDocument, {
        id: lecture.id,
        title: lecture.title,
        seriesTitle: lecture.seriesTitle,
        language: lecture.language,
        slides
      }),
      leaderboardEnabled: lecture.leaderboardEnabled ?? true,
      learnQuestionDensity: normalizeLearnQuestionDensity(lecture.learnQuestionDensity),
      aiDailyLimit: normalizeAiDailyLimit(lecture.aiDailyLimit, configuredDefaultAiDailyLimit()),
      aiDailyTokenLimit: normalizeAiDailyTokenLimit(lecture.aiDailyTokenLimit, configuredDefaultAiDailyTokenLimit()),
      seriesAiDailyLimit: normalizeAiDailyLimit(lecture.seriesAiDailyLimit, localSeriesBudget(data, lecture.seriesTitle).aiDailyLimit),
      seriesAiDailyTokenLimit: normalizeAiDailyTokenLimit(lecture.seriesAiDailyTokenLimit, localSeriesBudget(data, lecture.seriesTitle).aiDailyTokenLimit),
      tenantAiDailyLimit: normalizeAiDailyLimit(lecture.tenantAiDailyLimit, configuredDefaultAiDailyLimit()),
      tenantAiDailyTokenLimit: normalizeAiDailyTokenLimit(lecture.tenantAiDailyTokenLimit, configuredDefaultAiDailyTokenLimit()),
      tenantBudgetKey: lecture.tenantBudgetKey || "local",
      evaluationConfig: normalizeEvaluationConfig(lecture.evaluationConfig),
      assistantMessages: lecture.assistantMessages ?? []
    };
  });
  applyLocalSeriesBudgets(data);
  applyLocalTenantBudgets(data);
  return data;
}

async function writeStore(data: LocalStoreData) {
  const tmp = `${STORE_PATH}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await fs.rename(tmp, STORE_PATH);
}

export class LocalLectureStore {
  async listLectures(ownerEmail?: string) {
    const store = await readStore();
    return store.lectures.filter((lecture) => canAccessLecture(lecture, ownerEmail));
  }

  async getLectureByToken(token: string) {
    const store = await readStore();
    return store.lectures.find((lecture) => lecture.publicToken === token) ?? null;
  }

  async createLecture(input: CreateLectureInput, ownerEmail?: string) {
    const store = await readStore();
    const id = `lecture_${crypto.randomUUID()}`;
    const shortId = crypto.randomBytes(3).toString("hex");
    const examDate = normalizeExamDate(input.examDate);
    const title = input.title.trim();
    const seriesTitle = input.seriesTitle.trim();
    const seriesBudget = localSeriesBudget(store, seriesTitle);
    const tenantBudget = localTenantBudget(store, ownerEmail);
    const defaultSlides = createDefaultSlides(title);
    const lecture: Lecture = {
      id,
      publicToken: `${slugify(title)}-${shortId}`,
      ownerEmail: normalizeOwnerEmail(ownerEmail),
      title,
      seriesTitle,
      language: "de",
      status: "draft",
      liveAt: normalizeDateTime(input.liveAt),
      examDate,
      aiAccessUntil: aiAccessUntilFromExamDate(examDate),
      aiDailyLimit: configuredDefaultAiDailyLimit(),
      aiDailyTokenLimit: configuredDefaultAiDailyTokenLimit(),
      seriesAiDailyLimit: seriesBudget.aiDailyLimit,
      seriesAiDailyTokenLimit: seriesBudget.aiDailyTokenLimit,
      tenantAiDailyLimit: tenantBudget.aiDailyLimit,
      tenantAiDailyTokenLimit: tenantBudget.aiDailyTokenLimit,
      tenantBudgetKey: tenantBudget.key,
      leaderboardEnabled: true,
      learnQuestionDensity: normalizeLearnQuestionDensity(undefined),
      evaluationConfig: normalizeEvaluationConfig(store.seriesEvaluationTemplates?.[seriesTitle]),
      slides: defaultSlides,
      slideDocument: buildLegacyLectureSlideDocument({
        id,
        title,
        seriesTitle,
        language: "de",
        slides: defaultSlides
      }),
      questions: clone(demoLecture.questions),
      materials: [],
      questionReviews: [],
        materialProcessingRuns: [],
        studentChatQuestions: [],
        transcriptSegments: [],
        assistantMessages: [],
        standaloneExports: [],
        standaloneExportJobs: []
      };

    store.lectures = [lecture, ...store.lectures];
    await writeStore(store);
    return lecture;
  }

  async updateLecture(id: string, input: UpdateLectureInput, ownerEmail?: string) {
    const store = await readStore();
    const lecture = store.lectures.find((item) => item.id === id && canAccessLecture(item, ownerEmail));
    if (!lecture) return null;

    if (input.title !== undefined) lecture.title = input.title.trim();
    if (input.seriesTitle !== undefined) lecture.seriesTitle = input.seriesTitle.trim();
    if (input.liveAt !== undefined) lecture.liveAt = normalizeDateTime(input.liveAt);
    if (input.examDate !== undefined) {
      lecture.examDate = normalizeExamDate(input.examDate);
      lecture.aiAccessUntil = aiAccessUntilFromExamDate(lecture.examDate);
    }
    if (input.status !== undefined) lecture.status = input.status;
    if (input.leaderboardEnabled !== undefined) lecture.leaderboardEnabled = input.leaderboardEnabled;
    if (input.learnQuestionDensity !== undefined) {
      lecture.learnQuestionDensity = normalizeLearnQuestionDensity(input.learnQuestionDensity, lecture.learnQuestionDensity);
    }
    if (input.aiDailyLimit !== undefined) lecture.aiDailyLimit = normalizeAiDailyLimit(input.aiDailyLimit, lecture.aiDailyLimit);
    if (input.aiDailyTokenLimit !== undefined) {
      lecture.aiDailyTokenLimit = normalizeAiDailyTokenLimit(input.aiDailyTokenLimit, lecture.aiDailyTokenLimit);
    }
    if (input.seriesAiDailyLimit !== undefined || input.seriesAiDailyTokenLimit !== undefined) {
      setLocalSeriesBudget(store, lecture.seriesTitle, {
        aiDailyLimit: input.seriesAiDailyLimit,
        aiDailyTokenLimit: input.seriesAiDailyTokenLimit
      });
      applyLocalSeriesBudgets(store);
    }
    if (input.tenantAiDailyLimit !== undefined || input.tenantAiDailyTokenLimit !== undefined) {
      setLocalTenantBudget(store, ownerEmail, {
        aiDailyLimit: input.tenantAiDailyLimit,
        aiDailyTokenLimit: input.tenantAiDailyTokenLimit
      });
      applyLocalTenantBudgets(store, ownerEmail);
    }
    if (input.evaluationConfig !== undefined) {
      lecture.evaluationConfig = normalizeEvaluationConfigForUpdate(lecture.evaluationConfig, input.evaluationConfig);
    }
    if (input.slides !== undefined) {
      const incoming = new Map(input.slides.map((slide) => [slide.id, slide]));
      lecture.slides = lecture.slides.map((slide) => normalizeSlideUpdate(slide, incoming.get(slide.id)));
      if (input.slideDocument === undefined) {
        lecture.slideDocument = buildLegacyLectureSlideDocument({
          id: lecture.id,
          title: lecture.title,
          seriesTitle: lecture.seriesTitle,
          language: lecture.language,
          slides: lecture.slides
        });
      }
    }
    if (input.slideDocument !== undefined) {
      lecture.slideDocument = input.slideDocument;
      lecture.slides = legacySlidesFromSlideDocument(input.slideDocument, lecture.slides);
    }
    if (input.questions !== undefined) {
      lecture.questions = clone(input.questions);
    }
    if (input.saveEvaluationAsSeriesTemplate && input.evaluationConfig !== undefined) {
      store.seriesEvaluationTemplates ??= {};
      store.seriesEvaluationTemplates[lecture.seriesTitle] = normalizeEvaluationConfig(lecture.evaluationConfig);
    }

    await writeStore(store);
    return lecture;
  }

  async addMaterial(lectureId: string, input: AddMaterialInput, ownerEmail?: string) {
    const store = await readStore();
    const lecture = store.lectures.find((item) => item.id === lectureId && canAccessLecture(item, ownerEmail));
    if (!lecture) return null;

    const material: LectureMaterial = {
      id: `material_${crypto.randomUUID()}`,
      lectureId,
      kind: input.kind,
      source: input.source,
      originalName: input.originalName,
      storageUrl: input.storageUrl,
      sizeBytes: input.sizeBytes,
      status: input.kind === "audio" ? "ready" : "uploaded",
      createdAt: new Date().toISOString()
    };

    lecture.materials = [material, ...(lecture.materials ?? [])];
    if (input.kind !== "audio" && lecture.status === "draft") lecture.status = "material_processing";
    await writeStore(store);
    return material;
  }

  async processMaterials(lectureId: string, ownerEmail?: string) {
    const store = await readStore();
    const lecture = store.lectures.find((item) => item.id === lectureId && canAccessLecture(item, ownerEmail));
    if (!lecture) return null;

    const materials = lecture.materials ?? [];
    const existingMaterialIds = new Set((lecture.questionReviews ?? []).map((review) => review.sourceMaterialId));
    const reviewsToAdd: QuestionReviewItem[] = [];
    const materialsToProcess = materials.filter((item) =>
      item.kind !== "audio" && (item.status !== "ready" || !existingMaterialIds.has(item.id))
    );
    const startedAt = new Date();
    const steps: MaterialProcessingStep[] = [{
      label: "Materialverarbeitung gestartet",
      status: "done",
      detail: `${materialsToProcess.length} Material${materialsToProcess.length === 1 ? "" : "ien"} in der Warteschlange.`,
      at: startedAt.toISOString()
    }];
    let chunkCount = 0;
    let reviewCount = 0;
    const run: MaterialProcessingRun = {
      id: `run_${crypto.randomUUID()}`,
      lectureId,
      status: "running" as const,
      materialCount: materialsToProcess.length,
      chunkCount: 0,
      reviewCount: 0,
      message: "Materialverarbeitung läuft.",
      steps,
      startedAt: startedAt.toISOString()
    };

    lecture.materialProcessingRuns = [run, ...(lecture.materialProcessingRuns ?? [])];
    try {
      const jobProvider = getJobProvider();
      run.provider = jobProvider.name;
      const jobResult = await jobProvider.run({ jobId: run.id, kind: "material_processing" }, async () => {
        for (const material of materialsToProcess) {
          material.status = "processing";
          steps.push({
            label: `Quelle lesen: ${material.originalName}`,
            status: "done",
            detail: material.kind,
            at: new Date().toISOString()
          });
          const processed = await processMaterialContent({
            lecture,
            material,
            storedText: await readStoredText(material.storageUrl)
          });
          material.status = "ready";
          material.chunkCount = processed.chunks.length;
          material.extractedTextPreview = processed.preview;
          material.sourceRefs = processed.sourceRefs;
          const presentationAssetDrafts = createPresentationAssetDrafts({ lecture, material, processed });
          lecture.presentationAssets = [
            ...presentationAssetDrafts.map((draft) => ({
              id: `asset-${crypto.randomUUID()}`,
              lectureId: lecture.id,
              ...draft,
              createdAt: new Date().toISOString()
            })),
            ...(lecture.presentationAssets ?? []).filter((asset) => asset.source.materialId !== material.id)
          ];
          chunkCount += processed.chunks.length;
          steps.push({
            label: `Assets gespeichert: ${material.originalName}`,
            status: "done",
            detail: `${processed.chunks.length} ${processed.chunks.length === 1 ? "Chunk" : "Chunks"} · ${presentationAssetDrafts.length} ${presentationAssetDrafts.length === 1 ? "Asset" : "Assets"}`,
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

          if (!existingMaterialIds.has(material.id) && processed.chunks.length > 0) {
            reviewsToAdd.push({
              id: `review_${crypto.randomUUID()}`,
              lectureId: lecture.id,
              sourceMaterialId: material.id,
              sourceTitle: material.originalName,
              status: "draft",
              variants: await generateQuestionVariantsForMaterial({
                lecture,
                material,
                chunks: processed.chunks
              }),
              createdAt: new Date().toISOString()
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

        lecture.questionReviews = [...reviewsToAdd, ...(lecture.questionReviews ?? [])];
        if (reviewsToAdd.length > 0) lecture.status = "question_review";
        const completedAt = new Date();
        steps.push({
          label: "Materialverarbeitung abgeschlossen",
          status: "done",
          detail: `${chunkCount} ${chunkCount === 1 ? "Chunk" : "Chunks"}, ${reviewCount} Review-${reviewCount === 1 ? "Vorschlag" : "Vorschläge"}`,
          at: completedAt.toISOString()
        });
        return { completedAt };
      });

      run.provider = jobResult.provider;
      run.providerJobId = jobResult.providerJobId;
      run.status = "succeeded";
      run.chunkCount = chunkCount;
      run.reviewCount = reviewCount;
      run.message = materialsToProcess.length > 0 ? "Materialverarbeitung erfolgreich abgeschlossen." : "Keine offenen Materialien gefunden.";
      run.completedAt = jobResult.result.completedAt.toISOString();
      run.durationMs = jobResult.result.completedAt.getTime() - startedAt.getTime();
      await writeStore(store);
      return lecture;
    } catch (error) {
      const completedAt = new Date();
      const errorMessage = error instanceof Error ? error.message : "Unbekannter Fehler";
      steps.push({
        label: "Materialverarbeitung fehlgeschlagen",
        status: "failed",
        detail: errorMessage,
        at: completedAt.toISOString()
      });
      run.status = "failed";
      run.chunkCount = chunkCount;
      run.reviewCount = reviewCount;
      run.message = errorMessage;
      run.completedAt = completedAt.toISOString();
      run.durationMs = completedAt.getTime() - startedAt.getTime();
      await writeStore(store);
      throw error;
    }
  }

  async submitStudentChatQuestion(input: { lectureToken: string; text: string; pseudonym: string; anonymousKey?: string }) {
    const store = await readStore();
    const lecture = store.lectures.find((item) => item.publicToken === input.lectureToken);
    if (!lecture) return null;

    const moderation = await moderateChatQuestionWithProvider(lecture, input.text);
    const chatQuestion: StudentChatQuestion = {
      id: `chat_${crypto.randomUUID()}`,
      lectureId: lecture.id,
      pseudonym: input.pseudonym.trim() || "Pseudonym",
      anonymousKey: input.anonymousKey,
      text: input.text.replace(/\s+/g, " ").trim(),
      status: moderation.status,
      relevanceReason: moderation.reason,
      sourceTopic: moderation.sourceTopic,
      moderationProvider: moderation.provider,
      moderationModel: moderation.model,
      moderationConfidence: moderation.confidence,
      moderationSignals: moderation.signals,
      createdAt: new Date().toISOString()
    };

    lecture.studentChatQuestions = [chatQuestion, ...(lecture.studentChatQuestions ?? [])];
    if (chatQuestion.status === "accepted") {
      lecture.questionReviews = [createReviewItemFromChatQuestion(lecture, chatQuestion), ...(lecture.questionReviews ?? [])];
      if (lecture.status === "draft" || lecture.status === "material_processing") lecture.status = "question_review";
    }

    await writeStore(store);
    return chatQuestion;
  }

  async countRecentStudentChatQuestions(input: { lectureToken: string; anonymousKey: string; since: Date }) {
    const store = await readStore();
    const lecture = store.lectures.find((item) => item.publicToken === input.lectureToken);
    if (!lecture) return null;

    const sinceMs = input.since.getTime();
    return (lecture.studentChatQuestions ?? []).filter((item) => (
      item.anonymousKey === input.anonymousKey &&
      Date.parse(item.createdAt) >= sinceMs
    )).length;
  }

  async moderateStudentChatQuestion(input: { lectureId: string; chatQuestionId: string; status: StudentChatQuestion["status"]; actor?: string }, ownerEmail?: string) {
    const store = await readStore();
    const lecture = store.lectures.find((item) => item.id === input.lectureId && canAccessLecture(item, ownerEmail));
    const chatQuestion = lecture?.studentChatQuestions?.find((item) => item.id === input.chatQuestionId);
    if (!lecture || !chatQuestion) return null;

    chatQuestion.status = input.status;
    chatQuestion.relevanceReason = input.status === "accepted"
      ? `Vom Referenten als Fragequelle übernommen${input.actor ? ` (${input.actor})` : ""}.`
      : `Vom Referenten ignoriert${input.actor ? ` (${input.actor})` : ""}.`;
    chatQuestion.sourceTopic = input.status === "accepted" ? chatQuestion.sourceTopic ?? lecture.title : chatQuestion.sourceTopic;
    chatQuestion.moderationProvider = "referent";
    chatQuestion.moderationModel = "manual-review";
    chatQuestion.moderationConfidence = 100;
    chatQuestion.moderationSignals = [input.status === "accepted" ? "manuell übernommen" : "manuell ignoriert"];

    const review = createReviewItemFromChatQuestion(lecture, chatQuestion);
    lecture.questionReviews ??= [];
    const existingReviewIndex = lecture.questionReviews.findIndex((item) => item.sourceTitle === review.sourceTitle);

    if (input.status === "accepted" && existingReviewIndex === -1) {
      lecture.questionReviews = [review, ...lecture.questionReviews];
      if (lecture.status === "draft" || lecture.status === "material_processing") lecture.status = "question_review";
    }

    if (input.status === "ignored" && existingReviewIndex >= 0 && lecture.questionReviews[existingReviewIndex].status === "draft") {
      lecture.questionReviews = lecture.questionReviews.filter((_, index) => index !== existingReviewIndex);
      const hasApproved = lecture.questionReviews.some((item) => item.status === "approved");
      const hasDraft = lecture.questionReviews.some((item) => item.status === "draft");
      lecture.status = hasApproved ? "ready_for_live" : hasDraft ? "question_review" : "material_processing";
    }

    await writeStore(store);
    return lecture;
  }

  async submitTranscriptSegment(input: { lectureId: string; text: string; provider?: string; startedAt?: string; endedAt?: string }, ownerEmail?: string) {
    const store = await readStore();
    const lecture = store.lectures.find((item) => item.id === input.lectureId && canAccessLecture(item, ownerEmail));
    if (!lecture) return null;

    const cleanText = input.text.replace(/\s+/g, " ").trim();
    const relevance = evaluateStudentChatQuestion(lecture, cleanText);
    const segment: TranscriptSegment = {
      id: `transcript_${crypto.randomUUID()}`,
      lectureId: lecture.id,
      text: cleanText,
      provider: input.provider?.trim() || "voxtral-realtime",
      status: relevance.status,
      relevanceReason: relevance.reason,
      sourceTopic: relevance.sourceTopic,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      createdAt: new Date().toISOString()
    };

    lecture.transcriptSegments = [segment, ...(lecture.transcriptSegments ?? [])];
    if (segment.status === "accepted") {
      lecture.questionReviews = [createReviewItemFromTranscriptSegment(lecture, segment), ...(lecture.questionReviews ?? [])];
      if (lecture.status === "draft" || lecture.status === "material_processing") lecture.status = "question_review";
    }

    await writeStore(store);
    return segment;
  }

  async submitLecturerAssistantMessage(input: { lectureId: string; message: string; slideId?: string }, ownerEmail?: string) {
    const store = await readStore();
    const lecture = store.lectures.find((item) => item.id === input.lectureId && canAccessLecture(item, ownerEmail));
    if (!lecture) return null;

    const cleanMessage = input.message.replace(/\s+/g, " ").trim();
    const slideId = input.slideId && lecture.slides.some((slide) => slide.id === input.slideId) ? input.slideId : undefined;
    if (!cleanMessage) return lecture;

    const now = new Date();
    const assistantReply = await generateLecturerAssistantReply({ lecture, message: cleanMessage, slideId });
    const messages: LecturerAssistantMessage[] = [
      {
        id: `assistant_message_${crypto.randomUUID()}`,
        lectureId: lecture.id,
        role: "lecturer",
        content: cleanMessage,
        slideId,
        sourceRefs: [],
        createdAt: now.toISOString()
      },
      {
        id: `assistant_message_${crypto.randomUUID()}`,
        lectureId: lecture.id,
        role: "assistant",
        content: assistantReply.content,
        slideId,
        sourceRefs: assistantReply.sourceRefs,
        metadata: assistantReply.metadata,
        createdAt: new Date(now.getTime() + 1).toISOString()
      }
    ];

    lecture.assistantMessages = [...(lecture.assistantMessages ?? []), ...messages];
    await writeStore(store);
    return lecture;
  }

  async createLecturerAssistantReview(input: { lectureId: string; slideId?: string; message?: string }, ownerEmail?: string) {
    const store = await readStore();
    const lecture = store.lectures.find((item) => item.id === input.lectureId && canAccessLecture(item, ownerEmail));
    if (!lecture) return null;

    const slideId = input.slideId && lecture.slides.some((slide) => slide.id === input.slideId) ? input.slideId : undefined;
    const reviewMaterial = createLecturerAssistantReviewMaterial(lecture, { ...input, slideId });
    const variants = await generateQuestionVariantsForMaterial({
      lecture,
      material: reviewMaterial.material
    });
    const review = createReviewItemFromLecturerAssistant(lecture, { ...input, slideId, variants });
    lecture.questionReviews ??= [];
    const existingReview = lecture.questionReviews.find((item) => item.sourceTitle === review.sourceTitle);
    if (!existingReview) {
      lecture.questionReviews = [review, ...lecture.questionReviews];
      if (lecture.status === "draft" || lecture.status === "material_processing") lecture.status = "question_review";
    }

    lecture.assistantMessages = [
      ...(lecture.assistantMessages ?? []),
      {
        id: `assistant_message_${crypto.randomUUID()}`,
        lectureId: lecture.id,
        role: "assistant",
        content: existingReview
          ? `Der Fragenentwurf "${review.sourceTitle}" existiert bereits. Ich öffne ihn im Fragenreview.`
          : `Ich habe einen Fragenentwurf für "${review.sourceTitle.replace(/^Assistent: /, "")}" angelegt. Du kannst die vier Niveaus jetzt im Fragenreview bearbeiten oder freigeben.`,
        slideId,
        sourceRefs: [review.sourceTitle],
        createdAt: new Date().toISOString()
      }
    ];

    await writeStore(store);
    return lecture;
  }

  async applyLecturerAssistantSlidePoint(input: { lectureId: string; slideId?: string; message?: string }, ownerEmail?: string) {
    const store = await readStore();
    const lecture = store.lectures.find((item) => item.id === input.lectureId && canAccessLecture(item, ownerEmail));
    if (!lecture) return null;

    const slideId = input.slideId && lecture.slides.some((slide) => slide.id === input.slideId) ? input.slideId : undefined;
    const { slide, line } = createLecturerAssistantSlidePoint({ lecture, ...input, slideId });
    if (!slide) return lecture;

    lecture.slides = lecture.slides.map((item) => {
      if (item.id !== slide.id) return item;
      if (item.copy.includes(line)) return item;
      const copy = item.copy.length >= 4 ? [...item.copy.slice(0, 3), line] : [...item.copy, line];
      return { ...item, copy };
    });
    lecture.assistantMessages = [
      ...(lecture.assistantMessages ?? []),
      {
        id: `assistant_message_${crypto.randomUUID()}`,
        lectureId: lecture.id,
        role: "assistant",
        content: `Ich habe diesen Folienpunkt übernommen: ${line}`,
        slideId: slide.id,
        sourceRefs: [`${slide.eyebrow}: ${slide.title}`],
        createdAt: new Date().toISOString()
      }
    ];

    await writeStore(store);
    return lecture;
  }

  async applyLecturerAssistantEvaluationFocus(input: { lectureId: string; slideId?: string; message?: string }, ownerEmail?: string) {
    const store = await readStore();
    const lecture = store.lectures.find((item) => item.id === input.lectureId && canAccessLecture(item, ownerEmail));
    if (!lecture) return null;

    const slideId = input.slideId && lecture.slides.some((slide) => slide.id === input.slideId) ? input.slideId : undefined;
    const { slide, focus, config } = createLecturerAssistantEvaluationFocus({ lecture, ...input, slideId });
    lecture.evaluationConfig = normalizeEvaluationConfigForUpdate(lecture.evaluationConfig, config);
    lecture.assistantMessages = [
      ...(lecture.assistantMessages ?? []),
      {
        id: `assistant_message_${crypto.randomUUID()}`,
        lectureId: lecture.id,
        role: "assistant",
        content: `Ich habe die Evaluation auf "${focus}" ausgerichtet.`,
        slideId: slide?.id,
        sourceRefs: slide ? [`${slide.eyebrow}: ${slide.title}`] : [lecture.title],
        createdAt: new Date().toISOString()
      }
    ];

    await writeStore(store);
    return lecture;
  }

  async applyLecturerAssistantLearnDensity(input: { lectureId: string; slideId?: string; message?: string }, ownerEmail?: string) {
    const store = await readStore();
    const lecture = store.lectures.find((item) => item.id === input.lectureId && canAccessLecture(item, ownerEmail));
    if (!lecture) return null;

    const slideId = input.slideId && lecture.slides.some((slide) => slide.id === input.slideId) ? input.slideId : undefined;
    const { slide, density, reason } = createLecturerAssistantLearnDensity({ lecture, ...input, slideId });
    lecture.learnQuestionDensity = density;
    lecture.assistantMessages = [
      ...(lecture.assistantMessages ?? []),
      {
        id: `assistant_message_${crypto.randomUUID()}`,
        lectureId: lecture.id,
        role: "assistant",
        content: `Ich habe die Learn-Fragedichte auf ${density} gesetzt. ${reason}`,
        slideId: slide?.id,
        sourceRefs: slide ? [`${slide.eyebrow}: ${slide.title}`] : [lecture.title],
        createdAt: new Date().toISOString()
      }
    ];

    await writeStore(store);
    return lecture;
  }

  async createLecturerAssistantSourceNote(input: { lectureId: string; slideId?: string; originalName: string; storageUrl: string; sizeBytes?: number }, ownerEmail?: string) {
    const store = await readStore();
    const lecture = store.lectures.find((item) => item.id === input.lectureId && canAccessLecture(item, ownerEmail));
    if (!lecture) return null;

    const slideId = input.slideId && lecture.slides.some((slide) => slide.id === input.slideId) ? input.slideId : undefined;
    lecture.materials ??= [];
    const existingMaterial = lecture.materials.find((material) => material.originalName === input.originalName);

    if (!existingMaterial) {
      const material: LectureMaterial = {
        id: `material_${crypto.randomUUID()}`,
        lectureId: lecture.id,
        kind: "notes",
        source: "notes",
        originalName: input.originalName,
        storageUrl: input.storageUrl,
        sizeBytes: input.sizeBytes,
        status: "uploaded",
        createdAt: new Date().toISOString()
      };
      lecture.materials = [material, ...lecture.materials];
      if (lecture.status === "draft") lecture.status = "material_processing";
    }

    lecture.assistantMessages = [
      ...(lecture.assistantMessages ?? []),
      {
        id: `assistant_message_${crypto.randomUUID()}`,
        lectureId: lecture.id,
        role: "assistant",
        content: existingMaterial
          ? `Die Quellen-Notiz ist bereits vorhanden: ${input.originalName}`
          : `Ich habe eine Quellen-Notiz angelegt: ${input.originalName}`,
        slideId,
        sourceRefs: [input.originalName],
        createdAt: new Date().toISOString()
      }
    ];

    await writeStore(store);
    return lecture;
  }

  async recordStandaloneExport(input: { lectureId: string; version: string; storageUrl: string; sha256: string }, ownerEmail?: string) {
    const store = await readStore();
    const lecture = store.lectures.find((item) => item.id === input.lectureId && canAccessLecture(item, ownerEmail));
    if (!lecture) return null;

    const exportRecord: StandaloneExport = {
      id: `export_${crypto.randomUUID()}`,
      lectureId: input.lectureId,
      version: input.version,
      storageUrl: input.storageUrl,
      sha256: input.sha256,
      createdAt: new Date().toISOString()
    };

    lecture.standaloneExports = [exportRecord, ...(lecture.standaloneExports ?? [])];
    await writeStore(store);
    return exportRecord;
  }

  async createStandaloneExportJob(input: { lectureId: string; format: StandaloneExportJob["format"]; requestedBy?: string }, ownerEmail?: string) {
    const store = await readStore();
    const lecture = store.lectures.find((item) => item.id === input.lectureId && canAccessLecture(item, ownerEmail));
    if (!lecture) return null;

    const job: StandaloneExportJob = {
      id: `export_job_${crypto.randomUUID()}`,
      lectureId: input.lectureId,
      status: "queued",
      format: input.format,
      requestedBy: input.requestedBy,
      createdAt: new Date().toISOString()
    };

    lecture.standaloneExportJobs = [job, ...(lecture.standaloneExportJobs ?? [])];
    await writeStore(store);
    return job;
  }

  async updateStandaloneExportJob(jobId: string, input: {
    status?: StandaloneExportJobStatus;
    standaloneExportId?: string;
    provider?: string;
    providerJobId?: string;
    storageUrl?: string;
    sha256?: string;
    message?: string;
    startedAt?: string;
    completedAt?: string;
    durationMs?: number;
  }) {
    const store = await readStore();
    const lecture = store.lectures.find((item) => item.standaloneExportJobs?.some((job) => job.id === jobId));
    const job = lecture?.standaloneExportJobs?.find((item) => item.id === jobId);
    if (!lecture || !job) return null;

    Object.assign(job, input);
    await writeStore(store);
    return job;
  }

  async decideQuestionReview(lectureId: string, reviewId: string, decision: ReviewDecision, actor = "referent", ownerEmail?: string) {
    const store = await readStore();
    const lecture = store.lectures.find((item) => item.id === lectureId && canAccessLecture(item, ownerEmail));
    const review = lecture?.questionReviews?.find((item) => item.id === reviewId);
    if (!lecture || !review) return null;

    review.status = decision;
    review.reviewedAt = new Date().toISOString();
    review.variants = applyQualityDecision({
      variants: review.variants,
      decision,
      actor
    });
    if (decision === "approved") {
      lecture.questions = clone(review.variants);
      lecture.status = "ready_for_live";
    } else {
      const reviews = lecture.questionReviews ?? [];
      if (reviews.some((item) => item.status === "approved")) {
        lecture.status = "ready_for_live";
      } else if (reviews.every((item) => item.status !== "draft")) {
        lecture.status = "material_processing";
      } else {
        lecture.status = "question_review";
      }
    }

    await writeStore(store);
    return lecture;
  }

  async updateQuestionReview(lectureId: string, reviewId: string, variants: QuestionVariant[], actor = "referent", ownerEmail?: string) {
    const store = await readStore();
    const lecture = store.lectures.find((item) => item.id === lectureId && canAccessLecture(item, ownerEmail));
    const review = lecture?.questionReviews?.find((item) => item.id === reviewId);
    if (!lecture || !review) return null;

    review.variants = recordReviewEdits({
      previousVariants: review.variants,
      nextVariants: clone(variants),
      actor
    });
    if (review.status === "approved") {
      lecture.questions = clone(review.variants);
    }

    await writeStore(store);
    return lecture;
  }
}
