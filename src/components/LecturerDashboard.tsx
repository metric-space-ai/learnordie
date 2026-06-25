"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { defaultEvaluationConfig } from "@/lib/evaluation";
import {
  MAX_LEARN_QUESTION_DENSITY,
  MIN_LEARN_QUESTION_DENSITY,
  normalizeLearnQuestionDensity
} from "@/lib/learn-settings";
import { animateStudioSlideSharedElement } from "@/lib/motion";
import { seriesIdFromTitle } from "@/lib/series";
import { buildLegacyLectureSlideDocument } from "@/lib/slide-documents";
import { JoinCodeEditor } from "./lecturer/JoinCodeEditor";
import { StudioSlideDocumentEditor } from "./lecturer/StudioSlideDocumentEditor";
import { Diagram } from "./Diagram";
import { Presence } from "./Presence";
import type { PresenceState } from "./Presence";
import type {
  Lecture,
  LectureAnalyticsSummary,
  LectureStatus,
  LecturerAssistantToolPlanItem,
  MaterialProcessingRun,
  PresentationAsset,
  QuestionLevel,
  QuestionReviewItem,
  QuestionVariant,
  QuestionVariantReviewStatus,
  Slide,
  StandaloneExportJob,
  StudentChatQuestion
} from "@/lib/types";
import type { SlideAssetRef, SlideDocument } from "@learnordie/slide-engine";
import type { FormEvent, KeyboardEvent } from "react";

const statusOptions: Array<{ value: LectureStatus; label: string }> = [
  { value: "draft", label: "Entwurf" },
  { value: "material_processing", label: "Material wird verarbeitet" },
  { value: "question_review", label: "Fragenreview" },
  { value: "ready_for_live", label: "Bereit für Live" },
  { value: "live", label: "Live" },
  { value: "learn_active", label: "Learn aktiv" },
  { value: "archived", label: "Archiviert" }
];

const variantReviewStatusOptions: Array<{ value: QuestionVariantReviewStatus; label: string }> = [
  { value: "draft", label: "Entwurf" },
  { value: "reviewed", label: "Geprüft" },
  { value: "approved", label: "Freigegeben" },
  { value: "rejected", label: "Verworfen" }
];

type WorkspaceTool = "presentation" | "evaluation" | "questions" | "materials" | "analytics" | "assistant";
type PlanEditor = "status" | "live" | "exam" | "learn" | "budget" | "leaderboard" | null;
type SourceComposer = "file" | "url" | "notes" | null;
type MotionStyle = CSSProperties & Record<"--lb-i", number>;

const workspaceTools: Array<{ value: WorkspaceTool; label: string; shortLabel: string }> = [
  { value: "presentation", label: "Folie bearbeiten", shortLabel: "Folie" },
  { value: "questions", label: "Fragen direkt an dieser Folie bearbeiten", shortLabel: "Fragen" },
  { value: "materials", label: "Material zu dieser Folie hinzufügen", shortLabel: "Quellen" },
  { value: "assistant", label: "Planungsassistent direkt an dieser Folie", shortLabel: "Assistent" },
  { value: "analytics", label: "Lernstand und offene Punkte dieser Folie ansehen", shortLabel: "Auswertung" },
  { value: "evaluation", label: "Evaluation im Learn-Modus bearbeiten", shortLabel: "Evaluation" }
];

function formatDateTime(value: string) {
  return new Date(value).toISOString().slice(0, 16);
}

function formatPercent(value: number) {
  return `${Number.isFinite(value) ? value : 0}%`;
}

function formatEventTime(value?: string) {
  if (!value) return "Noch keine Events";
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatPlanDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "offen";
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatPlanDate(value: string) {
  if (!value) return "offen";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "offen";
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit"
  }).format(date);
}

function formatExportTime(value: string) {
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatSha(value?: string) {
  if (!value) return "Keine Prüfsumme";
  return `${value.slice(0, 12)}…${value.slice(-8)}`;
}

function formatExportJobStatus(status: StandaloneExportJob["status"]) {
  const labels: Record<StandaloneExportJob["status"], string> = {
    queued: "Wartet",
    running: "Läuft",
    succeeded: "Fertig",
    failed: "Fehlgeschlagen",
    dead_letter: "Eingriff nötig"
  };
  return labels[status];
}

function formatRunStatus(status: MaterialProcessingRun["status"]) {
  return ({
    queued: "Wartet",
    running: "Läuft",
    succeeded: "Abgeschlossen",
    failed: "Fehlgeschlagen",
    dead_letter: "Eingriff nötig"
  } as const)[status];
}

function formatPresentationAssetKind(kind: PresentationAsset["kind"]) {
  return ({
    text: "Text",
    figure: "Abbildung",
    photo: "Foto",
    diagram: "Diagramm",
    chart: "Chart",
    formula: "Formel",
    table: "Tabelle",
    audio: "Audio",
    video: "Video",
    sourceDocument: "Quelle"
  } as const)[kind] ?? kind;
}

function formatPresentationAssetQuality(asset: PresentationAsset) {
  if (asset.quality.needsReview) return "Prüfen";
  if (typeof asset.quality.extractionConfidence === "number") {
    return `${Math.round(asset.quality.extractionConfidence * 100)}%`;
  }
  return "Bereit";
}

function assetPreview(asset: PresentationAsset) {
  const preview = asset.extractedText?.replace(/\s+/g, " ").trim();
  if (!preview) return asset.description ?? "Für den Folienaufbau verfügbar.";
  return preview.length > 130 ? `${preview.slice(0, 127)}...` : preview;
}

function presentationAssetPreviewUrl(asset: PresentationAsset) {
  if (!asset.previewKey) return "";
  return ["figure", "photo", "diagram", "chart"].includes(asset.kind) ? asset.previewKey : "";
}

function mergeSlideDocumentAssets(base: SlideDocument, previous?: SlideDocument): SlideDocument {
  if (!previous || previous.assets.length === 0) return base;
  const assets = new Map<string, SlideAssetRef>();
  [...base.assets, ...previous.assets].forEach((asset) => assets.set(asset.id, asset));
  return { ...base, assets: [...assets.values()] };
}

function isTechnicalProviderMessage(message: string) {
  return (
    message.includes("LEARNBUDDY_JOB_") ||
    message.includes("LEARNBUDDY_STORAGE_") ||
    message.includes("Job provider") ||
    message.includes("Storage provider") ||
    message.includes("fetch failed") ||
    message.includes("Failed to parse URL")
  );
}

function isStoredArchiveUrl(value?: string) {
  if (!value) return false;
  return (
    value.startsWith("/api/local-artifacts/") ||
    value.startsWith("/api/storage-artifacts/") ||
    /^https:\/\/.*\.blob\.vercel-storage\.com\//.test(value)
  );
}

function formatVisibleRunMessage(run: MaterialProcessingRun) {
  if (!run.message) return "";
  if (isTechnicalProviderMessage(run.message)) {
    return "Materialverarbeitung konnte nicht gestartet werden.";
  }
  return run.message;
}

function formatVisibleExportJobMessage(job: StandaloneExportJob) {
  if (!job.message) return formatExportTime(job.createdAt);
  if (isTechnicalProviderMessage(job.message)) {
    return "Archivjob konnte nicht gestartet werden.";
  }
  return job.message;
}

function formatChatStatus(status: "accepted" | "ignored") {
  return status === "accepted" ? "Übernommen" : "Ignoriert";
}

function formatLectureStatus(status: LectureStatus) {
  return statusOptions.find((option) => option.value === status)?.label ?? status;
}

function formatQuestionReviewStatus(status: QuestionReviewItem["status"]) {
  return ({
    draft: "Entwurf",
    approved: "Freigegeben",
    rejected: "Verworfen"
  } as const)[status];
}

function formatVariantReviewStatus(status: QuestionVariantReviewStatus) {
  return variantReviewStatusOptions.find((option) => option.value === status)?.label ?? status;
}

type ImprovementSuggestion = LectureAnalyticsSummary["improvementSuggestions"]["items"][number];
type ImprovementDiffField = LectureAnalyticsSummary["improvementHistory"]["items"][number]["diff"][number];

type ImprovementDraft = {
  id: string;
  suggestionId: string;
  kind: "slide" | "question";
  targetLabel: string;
  title: string;
  before: string;
  after: string;
  diff: ImprovementDiffField[];
  applied: boolean;
  slideId?: string;
  questionLevel?: QuestionLevel;
};

function evidenceText(suggestion: ImprovementSuggestion) {
  return [suggestion.title, ...suggestion.evidence, suggestion.action].join(" ").toLowerCase();
}

function findRelevantSlide(lecture: Lecture, suggestion: ImprovementSuggestion) {
  const haystack = evidenceText(suggestion);
  const directMatch = lecture.slides.find((slide) =>
    [slide.title, slide.topic, ...slide.copy].join(" ").toLowerCase().split(/\s+/).some((word) => word.length > 5 && haystack.includes(word))
  );

  return directMatch ?? lecture.slides[0];
}

function slideDraftLine(suggestion: ImprovementSuggestion) {
  const text = evidenceText(suggestion);
  if (text.includes("tempo")) {
    return "Pausepunkt: Mischreibung kurz mit Flüssigkeitsreibung abgrenzen, bevor die nächste Transferfrage startet.";
  }
  if (text.includes("verständnis")) {
    return "Transferanker: Ursache, Kontaktzustand und konstruktive Gegenmaßnahme in einem Mini-Beispiel verbinden.";
  }
  if (text.includes("mischreibung")) {
    return "Merksatz: Kritisch ist der gleichzeitige Schmierfilmanteil mit direktem Festkörperkontakt; Wärme und Verschleiß steigen lokal.";
  }
  return "Lehrhinweis: Kernaussage, Ursache und technische Konsequenz als kurze Kette ergänzen.";
}

function applySlideLine(slide: Slide, line: string): Slide {
  if (slide.copy.some((copyLine) => copyLine === line)) return slide;
  return {
    ...slide,
    copy: slide.copy.length < 4 ? [...slide.copy, line] : [...slide.copy.slice(0, 3), line]
  };
}

function slideDraftDiff(slide: Slide, line: string): ImprovementDiffField[] {
  const updated = applySlideLine(slide, line);
  return [{
    field: "slide.copy",
    label: "Folientext",
    before: slide.copy.join(" | "),
    after: updated.copy.join(" | ")
  }];
}

function findRelevantQuestion(lecture: Lecture, suggestion: ImprovementSuggestion) {
  const haystack = evidenceText(suggestion);
  const alreadyImproved = lecture.questions.find((question) => question.text.includes("obwohl bereits ein Teil des Schmierfilms trägt"));
  if (alreadyImproved) return alreadyImproved;

  return lecture.questions.find((question) => haystack.includes(question.text.toLowerCase()))
    ?? lecture.questions.find((question) => question.text.toLowerCase().includes("mischreibung"))
    ?? lecture.questions.find((question) => question.level === "2.0")
    ?? lecture.questions[0];
}

function improveQuestionVariant(question: QuestionVariant): QuestionVariant {
  if (question.text.includes("obwohl bereits ein Teil des Schmierfilms trägt")) return question;
  return {
    ...question,
    text: "Was macht Mischreibung im Gleitlager kritisch, obwohl bereits ein Teil des Schmierfilms trägt?",
    explanation: "Mischreibung ist kritisch, weil tragende Schmierfilmanteile noch nicht ausreichen: lokale Festkörperkontakte erzeugen Wärme und Verschleiß.",
    promptVersion: question.promptVersion ?? "analytics-draft-v1",
    learningObjective: question.learningObjective ?? "Fehlvorstellung zwischen vollständiger Flüssigkeitsreibung und Mischreibung auflösen.",
    reviewerComment: "Aus Analytics-Vorschlag übernommen: häufige falsche Antwort gezielt abgrenzen.",
    answers: question.answers.map((answer) => {
      if (answer.correct) {
        return {
          ...answer,
          text: "Schmierfilmanteile tragen bereits, aber lokale Festkörperkontakte verursachen Wärme und Verschleiß."
        };
      }
      if (answer.text.toLowerCase().includes("hydrodynamische")) {
        return {
          ...answer,
          text: "Vollständig hydrodynamischer Druck würde gerade keinen direkten Festkörperkontakt bedeuten."
        };
      }
      return answer;
    })
  };
}

function correctAnswerText(question: QuestionVariant) {
  return question.answers.find((answer) => answer.correct)?.text ?? "Keine korrekte Antwort markiert";
}

function questionDraftDiff(question: QuestionVariant, improved: QuestionVariant): ImprovementDiffField[] {
  const fields: ImprovementDiffField[] = [];
  if (question.text !== improved.text) {
    fields.push({
      field: "question.text",
      label: "Fragetext",
      before: question.text,
      after: improved.text
    });
  }

  const beforeCorrect = correctAnswerText(question);
  const afterCorrect = correctAnswerText(improved);
  if (beforeCorrect !== afterCorrect) {
    fields.push({
      field: "question.answer.correct",
      label: "Korrekte Antwort",
      before: beforeCorrect,
      after: afterCorrect
    });
  }

  for (const answer of question.answers) {
    const improvedAnswer = improved.answers.find((candidate) => candidate.key === answer.key);
    if (!improvedAnswer || improvedAnswer.correct || improvedAnswer.text === answer.text) continue;
    fields.push({
      field: `question.answer.${answer.key.toLowerCase()}`,
      label: `Ablenker ${answer.key}`,
      before: answer.text,
      after: improvedAnswer.text
    });
  }

  if (question.explanation !== improved.explanation) {
    fields.push({
      field: "question.explanation",
      label: "Erklärung",
      before: question.explanation,
      after: improved.explanation
    });
  }

  return fields.length > 0 ? fields : [{
    field: "question.text",
    label: "Fragetext",
    before: question.text,
    after: improved.text
  }];
}

function buildImprovementDrafts(lecture: Lecture | undefined, analytics: LectureAnalyticsSummary | undefined): ImprovementDraft[] {
  if (!lecture || !analytics) return [];
  const drafts: ImprovementDraft[] = [];
  let hasSlideDraft = false;
  let hasQuestionDraft = false;

  for (const suggestion of analytics.improvementSuggestions.items) {
    if (!hasQuestionDraft && suggestion.area === "Frage") {
      const question = findRelevantQuestion(lecture, suggestion);
      if (question) {
        const improved = improveQuestionVariant(question);
        drafts.push({
          id: `${suggestion.id}-question-${question.level}`,
          suggestionId: suggestion.id,
          kind: "question",
          targetLabel: `Aktive Frage Niveau ${question.level}`,
          title: "Frage klarer stellen",
          before: question.text,
          after: improved.text,
          diff: questionDraftDiff(question, improved),
          applied: improved.text === question.text,
          questionLevel: question.level
        });
        hasQuestionDraft = true;
      }
    }

    if (!hasSlideDraft && ["Folie", "Tempo", "Evaluation"].includes(suggestion.area)) {
      const slide = findRelevantSlide(lecture, suggestion);
      if (slide) {
        const line = slideDraftLine(suggestion);
        drafts.push({
          id: `${suggestion.id}-slide-${slide.id}`,
          suggestionId: suggestion.id,
          kind: "slide",
          targetLabel: slide.title,
          title: "Folie ergänzen",
          before: slide.copy.join(" "),
          after: line,
          diff: slideDraftDiff(slide, line),
          applied: slide.copy.includes(line),
          slideId: slide.id
        });
        hasSlideDraft = true;
      }
    }

    if (hasSlideDraft && hasQuestionDraft) break;
  }

  return drafts;
}

export function LecturerDashboard({
  initialLectures,
  initialError = "",
  initialTool,
  csrfToken
}: {
  initialLectures: Lecture[];
  initialError?: string;
  initialTool?: WorkspaceTool;
  csrfToken: string;
}) {
  const [lectures, setLectures] = useState(initialLectures);
  const [selectedId, setSelectedId] = useState(initialLectures[0]?.id ?? "");
  const selected = useMemo(() => lectures.find((lecture) => lecture.id === selectedId) ?? lectures[0], [lectures, selectedId]);
  const [createError, setCreateError] = useState("");
  const [editError, setEditError] = useState(initialError);
  const [reviewMessage, setReviewMessage] = useState("");
  const [editingReviewId, setEditingReviewId] = useState("");
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, QuestionVariant[]>>({});
  const [analyticsByLecture, setAnalyticsByLecture] = useState<Record<string, LectureAnalyticsSummary>>({});
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState("");
  const [processingLectureId, setProcessingLectureId] = useState("");
  const [processingMessage, setProcessingMessage] = useState("");
  const [improvementMessage, setImprovementMessage] = useState("");
  const [workspaceTool, setWorkspaceTool] = useState<WorkspaceTool>(initialTool ?? "presentation");
  const [assistantDraft, setAssistantDraft] = useState("Welche Fragevarianten passen zu dieser Folie?");
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantActionLoading, setAssistantActionLoading] = useState(false);
  const [assistantSlideActionLoading, setAssistantSlideActionLoading] = useState(false);
  const [assistantSourceActionLoading, setAssistantSourceActionLoading] = useState(false);
  const [assistantEvaluationActionLoading, setAssistantEvaluationActionLoading] = useState(false);
  const [assistantLearnDensityActionLoading, setAssistantLearnDensityActionLoading] = useState(false);
  const [assistantPlanActionLoading, setAssistantPlanActionLoading] = useState(false);
  const [assistantError, setAssistantError] = useState("");
  const [planEditor, setPlanEditor] = useState<PlanEditor>(null);
  const [sourceComposer, setSourceComposer] = useState<SourceComposer>(null);
  const [sourceFileName, setSourceFileName] = useState("");
  const [sourceUploadFile, setSourceUploadFile] = useState<File | null>(null);
  const [sourceInputVersion, setSourceInputVersion] = useState(0);
  const [materialUploading, setMaterialUploading] = useState(false);
  const sourceFileRef = useRef<File | null>(null);
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);
  const [toolMenuOpen, setToolMenuOpen] = useState(false);
  const [engineEditorOpen, setEngineEditorOpen] = useState(false);
  const [reviewFocusId, setReviewFocusId] = useState("");
  const [reviewLevel, setReviewLevel] = useState<QuestionLevel>("2.0");
  const [studioSlideIndex, setStudioSlideIndex] = useState(0);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [chatModerationId, setChatModerationId] = useState("");
  const [chatModerationMessage, setChatModerationMessage] = useState("");
  const stageFrameRef = useRef<HTMLDivElement>(null);
  const filmstripButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const csrfJsonHeaders = useMemo(() => ({
    "content-type": "application/json",
    "x-learnbuddy-csrf": csrfToken
  }), [csrfToken]);
  const csrfHeaders = useMemo(() => ({
    "x-learnbuddy-csrf": csrfToken
  }), [csrfToken]);
  const selectedLectureId = selected?.id ?? "";
  const [edit, setEdit] = useState({
    title: selected?.title ?? "",
    seriesTitle: selected?.seriesTitle ?? "",
    liveAt: selected ? formatDateTime(selected.liveAt) : "",
    examDate: selected?.examDate ?? "",
    aiDailyLimit: String(selected?.aiDailyLimit ?? 20),
    aiDailyTokenLimit: String(selected?.aiDailyTokenLimit ?? 12000),
    seriesAiDailyLimit: String(selected?.seriesAiDailyLimit ?? 20),
    seriesAiDailyTokenLimit: String(selected?.seriesAiDailyTokenLimit ?? 12000),
    tenantAiDailyLimit: String(selected?.tenantAiDailyLimit ?? 20),
    tenantAiDailyTokenLimit: String(selected?.tenantAiDailyTokenLimit ?? 12000),
    leaderboardEnabled: selected?.leaderboardEnabled ?? true,
    learnQuestionDensity: String(normalizeLearnQuestionDensity(selected?.learnQuestionDensity)),
    evaluationConfig: selected?.evaluationConfig,
    saveEvaluationAsSeriesTemplate: false,
    status: selected?.status ?? "draft",
    slides: selected?.slides ?? [],
    slideDocument: selected?.slideDocument
  });
  const [createDraft, setCreateDraft] = useState({
    title: "Wälzlager und Lebensdauer",
    seriesTitle: "Maschinenelemente I",
    liveAt: "2026-06-17T10:00",
    examDate: "2026-07-24"
  });

  useEffect(() => {
    if (!selected) return;
    setEdit({
      title: selected.title,
      seriesTitle: selected.seriesTitle,
      liveAt: formatDateTime(selected.liveAt),
      examDate: selected.examDate,
      aiDailyLimit: String(selected.aiDailyLimit),
      aiDailyTokenLimit: String(selected.aiDailyTokenLimit),
      seriesAiDailyLimit: String(selected.seriesAiDailyLimit),
      seriesAiDailyTokenLimit: String(selected.seriesAiDailyTokenLimit),
      tenantAiDailyLimit: String(selected.tenantAiDailyLimit),
      tenantAiDailyTokenLimit: String(selected.tenantAiDailyTokenLimit),
      leaderboardEnabled: selected.leaderboardEnabled,
      learnQuestionDensity: String(normalizeLearnQuestionDensity(selected.learnQuestionDensity)),
      evaluationConfig: selected.evaluationConfig,
      saveEvaluationAsSeriesTemplate: false,
      status: selected.status,
      slides: selected.slides,
      slideDocument: selected.slideDocument
    });
  }, [selected]);

  useEffect(() => {
    if (!selectedLectureId) return;
    setStudioSlideIndex(0);
    setPlanEditor(null);
    setWorkspaceTool(initialTool ?? "presentation");
    setSourceFileName("");
    setSourceUploadFile(null);
    setSourceInputVersion((current) => current + 1);
    sourceFileRef.current = null;
    setCommandMenuOpen(false);
    setToolMenuOpen(false);
    setEngineEditorOpen(false);
    setShowCreateForm(false);
    setAssistantError("");
  }, [initialTool, selectedLectureId]);

  useEffect(() => {
    if (!selectedLectureId) return;
    void loadAnalytics(selectedLectureId);
  }, [selectedLectureId]);

  useEffect(() => {
    setReviewFocusId("");
  }, [selected?.id]);

  async function loadAnalytics(lectureId: string) {
    setAnalyticsLoading(true);
    setAnalyticsError("");
    const response = await fetch(`/api/lectures/${lectureId}/aggregates`);
    const payload = (await response.json()) as { summary?: LectureAnalyticsSummary; error?: string };
    setAnalyticsLoading(false);

    if (!response.ok || !payload.summary) {
      setAnalyticsError(payload.error ?? "Analytics konnten nicht geladen werden.");
      return;
    }

    setAnalyticsByLecture((current) => ({ ...current, [lectureId]: payload.summary! }));
  }

  async function sendAssistantMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const message = assistantDraft.replace(/\s+/g, " ").trim();
    if (!message) return;

    setAssistantLoading(true);
    setAssistantError("");
    const response = await fetch(`/api/lectures/${selected.id}/assistant`, {
      method: "POST",
      headers: csrfJsonHeaders,
      body: JSON.stringify({
        message,
        slideId: studioSlide?.id
      })
    });
    const payload = (await response.json()) as { lectures?: Lecture[]; error?: string; queued?: boolean };
    setAssistantLoading(false);

    if (!response.ok || !payload.lectures) {
      setAssistantError(payload.error ?? "Assistent konnte nicht antworten.");
      return;
    }

    setLectures(payload.lectures);
    setAssistantDraft("");
  }

  async function createAssistantReviewDraft() {
    if (!selected) return;

    setAssistantActionLoading(true);
    setAssistantError("");
    const lastAssistantMessage = [...visibleAssistantMessages].reverse().find((message) => message.role === "assistant");
    const response = await fetch(`/api/lectures/${selected.id}/assistant/review-draft`, {
      method: "POST",
      headers: csrfJsonHeaders,
      body: JSON.stringify({
        slideId: studioSlide?.id,
        message: lastAssistantMessage?.content ?? assistantDraft
      })
    });
    const payload = (await response.json()) as { lectures?: Lecture[]; error?: string; queued?: boolean };
    setAssistantActionLoading(false);

    if (!response.ok || !payload.lectures) {
      setAssistantError(payload.error ?? "Fragenentwurf konnte nicht angelegt werden.");
      return;
    }

    setLectures(payload.lectures);
    const updatedLecture = payload.lectures.find((lecture) => lecture.id === selected.id);
    const sourceTitle = studioSlide ? `Assistent: ${studioSlide.title}` : undefined;
    const review = updatedLecture?.questionReviews?.find((item) => item.sourceTitle === sourceTitle) ?? updatedLecture?.questionReviews?.[0];
    if (review) {
      setReviewFocusId(review.id);
      setReviewLevel(review.variants.find((variant) => variant.level === "2.0")?.level ?? review.variants[0]?.level ?? "2.0");
    }
    setReviewMessage("Fragenentwurf aus dem Assistenten angelegt.");
    setWorkspaceTool("questions");
  }

  async function applyAssistantSlidePoint() {
    if (!selected) return;

    setAssistantSlideActionLoading(true);
    setAssistantError("");
    const lastAssistantMessage = [...visibleAssistantMessages].reverse().find((message) => message.role === "assistant");
    const response = await fetch(`/api/lectures/${selected.id}/assistant/slide-point`, {
      method: "POST",
      headers: csrfJsonHeaders,
      body: JSON.stringify({
        slideId: studioSlide?.id,
        message: lastAssistantMessage?.content ?? assistantDraft
      })
    });
    const payload = (await response.json()) as { lectures?: Lecture[]; error?: string };
    setAssistantSlideActionLoading(false);

    if (!response.ok || !payload.lectures) {
      setAssistantError(payload.error ?? "Folienpunkt konnte nicht übernommen werden.");
      return;
    }

    setLectures(payload.lectures);
    const updatedLecture = payload.lectures.find((lecture) => lecture.id === selected.id);
    if (updatedLecture) {
      setEdit((current) => ({
        ...current,
        slides: updatedLecture.slides,
        slideDocument: updatedLecture.slideDocument
      }));
    }
  }

  async function createAssistantSourceNote() {
    if (!selected) return;

    setAssistantSourceActionLoading(true);
    setAssistantError("");
    const lastAssistantMessage = [...visibleAssistantMessages].reverse().find((message) => message.role === "assistant");
    const response = await fetch(`/api/lectures/${selected.id}/assistant/source-note`, {
      method: "POST",
      headers: csrfJsonHeaders,
      body: JSON.stringify({
        slideId: studioSlide?.id,
        message: lastAssistantMessage?.content ?? assistantDraft
      })
    });
    const payload = (await response.json()) as { lectures?: Lecture[]; error?: string };
    setAssistantSourceActionLoading(false);

    if (!response.ok || !payload.lectures) {
      setAssistantError(payload.error ?? "Quellen-Notiz konnte nicht angelegt werden.");
      return;
    }

    setLectures(payload.lectures);
    setProcessingMessage("Quellen-Notiz aus dem Assistenten angelegt.");
    setWorkspaceTool("materials");
  }

  async function applyAssistantEvaluationFocus() {
    if (!selected) return;

    setAssistantEvaluationActionLoading(true);
    setAssistantError("");
    const lastAssistantMessage = [...visibleAssistantMessages].reverse().find((message) => message.role === "assistant");
    const response = await fetch(`/api/lectures/${selected.id}/assistant/evaluation-focus`, {
      method: "POST",
      headers: csrfJsonHeaders,
      body: JSON.stringify({
        slideId: studioSlide?.id,
        message: lastAssistantMessage?.content ?? assistantDraft
      })
    });
    const payload = (await response.json()) as { lectures?: Lecture[]; error?: string };
    setAssistantEvaluationActionLoading(false);

    if (!response.ok || !payload.lectures) {
      setAssistantError(payload.error ?? "Evaluation konnte nicht geschärft werden.");
      return;
    }

    setLectures(payload.lectures);
    const updatedLecture = payload.lectures.find((lecture) => lecture.id === selected.id);
    if (updatedLecture) {
      setEdit((current) => ({
        ...current,
        evaluationConfig: updatedLecture.evaluationConfig
      }));
    }
    setReviewMessage("Evaluation aus dem Assistenten geschärft.");
    setWorkspaceTool("evaluation");
  }

  async function applyAssistantLearnDensity() {
    if (!selected) return;

    setAssistantLearnDensityActionLoading(true);
    setAssistantError("");
    const lastAssistantMessage = [...visibleAssistantMessages].reverse().find((message) => message.role === "assistant");
    const plannedDensity = lastAssistantMessage?.metadata?.toolPlan?.find((tool) => tool.action === "learn_density");
    const response = await fetch(`/api/lectures/${selected.id}/assistant/learn-density`, {
      method: "POST",
      headers: csrfJsonHeaders,
      body: JSON.stringify({
        slideId: studioSlide?.id,
        message: plannedDensity?.reason ?? lastAssistantMessage?.content ?? assistantDraft
      })
    });
    const payload = (await response.json()) as { lectures?: Lecture[]; error?: string };
    setAssistantLearnDensityActionLoading(false);

    if (!response.ok || !payload.lectures) {
      setAssistantError(payload.error ?? "Learn-Fragedichte konnte nicht gesetzt werden.");
      return;
    }

    setLectures(payload.lectures);
    const updatedLecture = payload.lectures.find((lecture) => lecture.id === selected.id);
    if (updatedLecture) {
      setEdit((current) => ({
        ...current,
        learnQuestionDensity: String(normalizeLearnQuestionDensity(updatedLecture.learnQuestionDensity))
      }));
    }
    setReviewMessage("Learn-Fragedichte aus dem Assistenten gesetzt.");
    setPlanEditor("learn");
  }

  async function applyAssistantToolPlan() {
    if (!selected) return;

    setAssistantPlanActionLoading(true);
    setAssistantError("");
    const response = await fetch(`/api/lectures/${selected.id}/assistant/apply-plan`, {
      method: "POST",
      headers: csrfJsonHeaders,
      body: JSON.stringify({
        slideId: studioSlide?.id
      })
    });
    const payload = (await response.json()) as {
      lectures?: Lecture[];
      executed?: Array<{ action: LecturerAssistantToolPlanItem["action"]; label: string }>;
      error?: string;
    };
    setAssistantPlanActionLoading(false);

    if (!response.ok || !payload.lectures) {
      setAssistantError(payload.error ?? "Toolkette konnte nicht ausgeführt werden.");
      return;
    }

    setLectures(payload.lectures);
    const updatedLecture = payload.lectures.find((lecture) => lecture.id === selected.id);
    if (updatedLecture) {
      setEdit((current) => ({
        ...current,
        slides: updatedLecture.slides,
        slideDocument: updatedLecture.slideDocument,
        learnQuestionDensity: String(normalizeLearnQuestionDensity(updatedLecture.learnQuestionDensity)),
        evaluationConfig: updatedLecture.evaluationConfig
      }));
      const sourceTitle = studioSlide ? `Assistent: ${studioSlide.title}` : undefined;
      const review = updatedLecture.questionReviews?.find((item) => item.sourceTitle === sourceTitle) ?? updatedLecture.questionReviews?.[0];
      if (review) {
        setReviewFocusId(review.id);
        setReviewLevel(review.variants.find((variant) => variant.level === "2.0")?.level ?? review.variants[0]?.level ?? "2.0");
      }
    }

    const labels = payload.executed?.map((item) => item.label).filter(Boolean) ?? [];
    setReviewMessage(labels.length > 0
      ? `Toolkette ausgeführt: ${labels.join(", ")}.`
      : "Toolkette ausgeführt.");
  }

  async function createLecture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateError("");
    const form = event.currentTarget;
    const formData = new FormData(form);
    const response = await fetch("/api/lectures", {
      method: "POST",
      headers: csrfJsonHeaders,
      body: JSON.stringify({
        title: formData.get("title") ?? createDraft.title,
        seriesTitle: formData.get("seriesTitle") ?? createDraft.seriesTitle,
        liveAt: formData.get("liveAt") ?? createDraft.liveAt,
        examDate: formData.get("examDate") ?? createDraft.examDate
      })
    });
    const payload = (await response.json()) as { lecture?: Lecture; lectures?: Lecture[]; error?: string };
    if (!response.ok || !payload.lecture || !payload.lectures) {
      setCreateError(payload.error ?? "Vorlesung konnte nicht angelegt werden.");
      return;
    }
    setLectures(payload.lectures);
    setSelectedId(payload.lecture.id);
    setShowCreateForm(false);
    form.reset();
    setCreateDraft({
      title: "Wälzlager und Lebensdauer",
      seriesTitle: "Maschinenelemente I",
      liveAt: "2026-06-17T10:00",
      examDate: "2026-07-24"
    });
  }

  function visibleStageEditDraft(current: typeof edit): typeof edit {
    const root = stageFrameRef.current;
    if (!root || !selected || !studioSlide || showCreateForm) return current;

    const readText = (selector: string, fallback: string) => {
      const value = root.querySelector<HTMLElement>(selector)?.textContent?.replace(/\s+/g, " ").trim() ?? "";
      return value || fallback;
    };

    const slides = current.slides.map((slide) => {
      if (slide.id !== studioSlide.id) return slide;
      return {
        ...slide,
        eyebrow: readText('[data-slide-field="eyebrow"]', slide.eyebrow),
        title: readText('[data-slide-field="title"]', slide.title),
        topic: readText('[data-slide-field="topic"]', slide.topic),
        copy: slide.copy.map((line, index) => readText(`[data-slide-copy-index="${index}"]`, line))
      };
    });

    const rebuiltSlideDocument = buildLegacyLectureSlideDocument({
      id: selected.id,
      title: current.title,
      seriesTitle: current.seriesTitle,
      language: selected.language,
      slides
    });

    return {
      ...current,
      seriesTitle: readText('[data-lecture-field="seriesTitle"]', current.seriesTitle),
      slides,
      slideDocument: engineEditorOpen && current.slideDocument
        ? current.slideDocument
        : mergeSlideDocumentAssets(rebuiltSlideDocument, current.slideDocument)
    };
  }

  async function persistLectureEdits() {
    if (!selected) return;
    setEditError("");
    const draft = visibleStageEditDraft(edit);
    setEdit(draft);
    const response = await fetch(`/api/lectures/${selected.id}`, {
      method: "PATCH",
      headers: csrfJsonHeaders,
      body: JSON.stringify(draft)
    });
    const payload = (await response.json()) as { lectures?: Lecture[]; error?: string };
    if (!response.ok || !payload.lectures) {
      setEditError(payload.error ?? "Vorlesung konnte nicht gespeichert werden.");
      return;
    }
    setLectures(payload.lectures);
    const updated = payload.lectures.find((lecture) => lecture.id === selected.id);
    if (updated) {
      setEdit({
        title: updated.title,
        seriesTitle: updated.seriesTitle,
        liveAt: formatDateTime(updated.liveAt),
        examDate: updated.examDate,
        aiDailyLimit: String(updated.aiDailyLimit),
        aiDailyTokenLimit: String(updated.aiDailyTokenLimit),
        seriesAiDailyLimit: String(updated.seriesAiDailyLimit),
        seriesAiDailyTokenLimit: String(updated.seriesAiDailyTokenLimit),
        tenantAiDailyLimit: String(updated.tenantAiDailyLimit),
        tenantAiDailyTokenLimit: String(updated.tenantAiDailyTokenLimit),
        leaderboardEnabled: updated.leaderboardEnabled,
        learnQuestionDensity: String(normalizeLearnQuestionDensity(updated.learnQuestionDensity)),
        evaluationConfig: updated.evaluationConfig,
        saveEvaluationAsSeriesTemplate: false,
        status: updated.status,
        slides: updated.slides,
        slideDocument: updated.slideDocument
      });
    }
  }

  async function savePlanEdits() {
    await persistLectureEdits();
    setPlanEditor(null);
  }

  function updateSlideDraft(slideId: string, updater: (slide: Slide) => Slide) {
    setEdit((current) => ({
      ...current,
      slides: current.slides.map((slide) => (slide.id === slideId ? updater(slide) : slide))
    }));
  }

  function updateSlideCopy(slideId: string, lineIndex: number, value: string) {
    updateSlideDraft(slideId, (slide) => ({
      ...slide,
      copy: slide.copy.map((line, index) => (index === lineIndex ? value : line))
    }));
  }

  function addSlideCopyLine(slideId: string) {
    updateSlideDraft(slideId, (slide) => ({
      ...slide,
      copy: [...slide.copy, "Neuer Stichpunkt"].slice(0, 4)
    }));
  }

  function removeSlideCopyLine(slideId: string, lineIndex: number) {
    updateSlideDraft(slideId, (slide) => ({
      ...slide,
      copy: slide.copy.length <= 1 ? slide.copy : slide.copy.filter((_, index) => index !== lineIndex)
    }));
  }

  function updateSlideDocumentFromEngine(document: SlideDocument, slides: Slide[]) {
    setEdit((current) => ({
      ...current,
      slides,
      slideDocument: document
    }));
  }

  function editableValue(element: HTMLElement, fallback: string) {
    const value = element.textContent?.replace(/\s+/g, " ").trim() ?? "";
    if (!value) {
      element.textContent = fallback;
      return fallback;
    }
    return value;
  }

  function inlineDraftValue(element: HTMLElement) {
    return element.textContent?.replace(/\s+/g, " ").trim() ?? "";
  }

  function updateCreateDraftText(field: "title" | "seriesTitle", element: HTMLElement) {
    const value = inlineDraftValue(element);
    if (!value) {
      element.textContent = createDraft[field];
      return;
    }
    setCreateDraft((current) => ({ ...current, [field]: value }));
  }

  function finishInlineEdit(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.currentTarget.blur();
  }

  async function decideReview(reviewId: string, decision: "approved" | "rejected") {
    if (!selected) return;
    setReviewMessage("");
    const response = await fetch(`/api/lectures/${selected.id}/question-reviews/${reviewId}`, {
      method: "PATCH",
      headers: csrfJsonHeaders,
      body: JSON.stringify({ decision })
    });
    const payload = (await response.json()) as { lectures?: Lecture[]; error?: string };
    if (!response.ok || !payload.lectures) {
      setReviewMessage(payload.error ?? "Review konnte nicht gespeichert werden.");
      return;
    }
    setLectures(payload.lectures);
    setReviewMessage(decision === "approved" ? "Frage freigegeben und als aktive Live-Frage übernommen." : "Frage abgelehnt.");
  }

  function updateReviewDraft(reviewId: string, level: QuestionLevel, updater: (variant: QuestionVariant) => QuestionVariant) {
    setReviewDrafts((current) => ({
      ...current,
      [reviewId]: (current[reviewId] ?? []).map((variant) => (variant.level === level ? updater(variant) : variant))
    }));
  }

  function updateEvaluationConfig(updater: (config: Lecture["evaluationConfig"]) => Lecture["evaluationConfig"]) {
    setEdit((current) => ({
      ...current,
      evaluationConfig: updater(current.evaluationConfig ?? selected?.evaluationConfig ?? defaultEvaluationConfig)
    }));
  }

  async function saveReviewEdit(reviewId: string) {
    if (!selected) return;
    const variants = reviewDrafts[reviewId];
    if (!variants) return;
    setReviewMessage("");
    const response = await fetch(`/api/lectures/${selected.id}/question-reviews/${reviewId}`, {
      method: "PATCH",
      headers: csrfJsonHeaders,
      body: JSON.stringify({ variants })
    });
    const payload = (await response.json()) as { lectures?: Lecture[]; error?: string };
    if (!response.ok || !payload.lectures) {
      setReviewMessage(payload.error ?? "Änderungen konnten nicht gespeichert werden.");
      return;
    }
    setLectures(payload.lectures);
    setReviewDrafts((current) => {
      const remaining = { ...current };
      delete remaining[reviewId];
      return remaining;
    });
    setEditingReviewId("");
    setReviewMessage("Review-Änderungen gespeichert.");
  }

  async function processMaterials() {
    if (!selected) return;
    if (materialUploading) {
      setProcessingMessage("Quelle wird noch hinzugefügt. Danach können Fragen aktualisiert werden.");
      return;
    }
    setProcessingLectureId(selected.id);
    setProcessingMessage("Materialverarbeitung läuft. Quellen werden gelesen, Assets gespeichert und Review-Vorschläge erzeugt.");
    const response = await fetch(`/api/lectures/${selected.id}/process-materials`, { method: "POST", headers: csrfHeaders });
    const payload = (await response.json()) as { lectures?: Lecture[]; error?: string; queued?: boolean };
    setProcessingLectureId("");

    if (payload.lectures) {
      setLectures(payload.lectures);
    }

    if (!response.ok || !payload.lectures) {
      setProcessingMessage(payload.error ?? "Materialverarbeitung konnte nicht gestartet werden.");
      return;
    }

    setProcessingMessage(payload.queued ? "Materialverarbeitung wurde vorgemerkt." : "Materialverarbeitung abgeschlossen.");
  }

  async function submitMaterial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;

    const form = event.currentTarget;
    const formData = new FormData(form);
    const composerMode = sourceComposer ?? "file";
    const fileInput = form.querySelector<HTMLInputElement>('input[type="file"][name="file"]');
    const selectedFile = sourceUploadFile ?? sourceFileRef.current ?? fileInput?.files?.[0] ?? null;
    const submittedFile = selectedFile;
    if (composerMode === "file" && selectedFile) {
      formData.set("file", selectedFile, selectedFile.name);
    }
    setEditError("");
    setProcessingMessage("Quelle wird hinzugefügt.");
    setMaterialUploading(true);

    try {
      const response = await fetch(`/api/lectures/${selected.id}/materials`, {
        method: "POST",
        headers: csrfHeaders,
        body: formData
      });
      const payload = (await response.json()) as { lectures?: Lecture[]; error?: string };

      if (!response.ok || !payload.lectures) {
        setEditError(payload.error ?? "Material konnte nicht hinzugefügt werden.");
        return;
      }

      setLectures(payload.lectures);
      if (composerMode !== "file" || sourceFileRef.current === submittedFile) {
        setSourceFileName("");
        setSourceUploadFile(null);
        setSourceInputVersion((current) => current + 1);
        sourceFileRef.current = null;
        form.reset();
      }
      setProcessingMessage("Quelle hinzugefügt.");
    } finally {
      setMaterialUploading(false);
    }
  }

  async function applyImprovementDraft(draft: ImprovementDraft) {
    if (!selected) return;
    setImprovementMessage("");

    let requestBody: {
      slides?: Slide[];
      questions?: QuestionVariant[];
      improvementDraftEvent: {
        kind: ImprovementDraft["kind"];
        targetLabel: string;
        targetId?: string;
        title: string;
        before: string;
        after: string;
        diff: ImprovementDiffField[];
        suggestionId: string;
      };
    };
    if (draft.kind === "slide") {
      const updatedSlides = selected.slides.map((slide) =>
        slide.id === draft.slideId ? applySlideLine(slide, draft.after) : slide
      );
      requestBody = {
        slides: updatedSlides,
        improvementDraftEvent: {
          kind: draft.kind,
          targetLabel: draft.targetLabel,
          targetId: draft.slideId,
          title: draft.title,
          before: draft.before,
          after: draft.after,
          diff: draft.diff,
          suggestionId: draft.suggestionId
        }
      };
    } else {
      const updatedQuestions = selected.questions.map((question) =>
        question.level === draft.questionLevel ? improveQuestionVariant(question) : question
      );
      requestBody = {
        questions: updatedQuestions,
        improvementDraftEvent: {
          kind: draft.kind,
          targetLabel: draft.targetLabel,
          targetId: draft.questionLevel,
          title: draft.title,
          before: draft.before,
          after: draft.after,
          diff: draft.diff,
          suggestionId: draft.suggestionId
        }
      };
    }

    const response = await fetch(`/api/lectures/${selected.id}`, {
      method: "PATCH",
      headers: csrfJsonHeaders,
      body: JSON.stringify(requestBody)
    });
    const payload = (await response.json()) as { lectures?: Lecture[]; error?: string };
    if (!response.ok || !payload.lectures) {
      setImprovementMessage(payload.error ?? "Änderungsentwurf konnte nicht übernommen werden.");
      return;
    }

    setLectures(payload.lectures);
    const updatedLecture = payload.lectures.find((lecture) => lecture.id === selected.id);
    if (updatedLecture) {
      setEdit((current) => ({
        ...current,
        slides: updatedLecture.slides,
        slideDocument: updatedLecture.slideDocument
      }));
    }
    setImprovementMessage(draft.kind === "slide" ? "Folienentwurf übernommen." : "Fragenentwurf übernommen.");
    void loadAnalytics(selected.id);
  }

  async function moderateChatQuestion(question: StudentChatQuestion, status: StudentChatQuestion["status"]) {
    if (!selected) return;
    setChatModerationId(question.id);
    setChatModerationMessage("");
    const response = await fetch(`/api/lectures/${selected.id}/chat-questions/${question.id}`, {
      method: "PATCH",
      headers: csrfJsonHeaders,
      body: JSON.stringify({ status })
    });
    const payload = (await response.json()) as { lecture?: Lecture; lectures?: Lecture[]; error?: string };
    setChatModerationId("");

    if (!response.ok || !payload.lectures) {
      setChatModerationMessage(payload.error ?? "Chatfrage konnte nicht aktualisiert werden.");
      return;
    }

    setLectures(payload.lectures);
    const updatedLecture = payload.lectures.find((lecture) => lecture.id === selected.id);
    if (updatedLecture && status === "accepted") {
      const review = updatedLecture.questionReviews?.find((item) => item.sourceTitle.startsWith(`Chatfrage: ${question.text.slice(0, 32)}`));
      if (review) setReviewFocusId(review.id);
    }
    setChatModerationMessage(status === "accepted"
      ? "Chatfrage wurde als Fragequelle übernommen."
      : "Chatfrage wurde ignoriert.");
    void loadAnalytics(selected.id);
  }

  const reviews = selected?.questionReviews ?? [];
  const focusedReview = reviews.find((review) => review.id === reviewFocusId) ?? reviews[0];
  const focusedVariants = focusedReview ? reviewDrafts[focusedReview.id] ?? focusedReview.variants : [];
  const activeReviewVariant = focusedVariants.find((variant) => variant.level === reviewLevel) ?? focusedVariants[0];
  const analytics = selected ? analyticsByLecture[selected.id] : undefined;
  const improvementDrafts = useMemo(() => buildImprovementDrafts(selected, analytics), [selected, analytics]);
  const studioSlides = edit.slides.length > 0 ? edit.slides : selected?.slides ?? [];
  const activeStudioSlideIndex = Math.min(studioSlideIndex, Math.max(studioSlides.length - 1, 0));
  const studioSlide = studioSlides[activeStudioSlideIndex];
  const assistantMessages = selected?.assistantMessages ?? [];
  const visibleAssistantMessages = studioSlide
    ? assistantMessages.filter((message) => !message.slideId || message.slideId === studioSlide.id).slice(-6)
    : assistantMessages.slice(-6);
  const latestStandaloneExport = selected?.standaloneExports?.[0];
  const latestStoredArchive = selected?.standaloneExports?.find((exportRecord) => isStoredArchiveUrl(exportRecord.storageUrl));
  const latestExportJob = selected?.standaloneExportJobs?.[0];

  function moveToStudioSlide(index: number, source?: HTMLElement | null) {
    const boundedIndex = Math.min(Math.max(index, 0), Math.max(studioSlides.length - 1, 0));
    const targetSlide = studioSlides[boundedIndex];
    if (!targetSlide) return;

    const sourceElement = source ?? filmstripButtonRefs.current.get(targetSlide.id);
    animateStudioSlideSharedElement({
      source: sourceElement,
      target: stageFrameRef.current,
      index: boundedIndex,
      title: targetSlide.title
    });
    setShowCreateForm(false);
    setStudioSlideIndex(boundedIndex);
  }

  useEffect(() => {
    if (!focusedReview) return;
    const hasSelectedLevel = focusedReview.variants.some((variant) => variant.level === reviewLevel);
    if (!hasSelectedLevel) setReviewLevel(focusedReview.variants[0]?.level ?? "2.0");
  }, [focusedReview, reviewLevel]);

  useEffect(() => {
    if (!focusedReview || focusedReview.status !== "draft") return;
    setEditingReviewId(focusedReview.id);
    setReviewDrafts((current) => {
      if (current[focusedReview.id]) return current;
      return {
        ...current,
        [focusedReview.id]: JSON.parse(JSON.stringify(focusedReview.variants)) as QuestionVariant[]
      };
    });
  }, [focusedReview]);

  function renderEvaluationPreview() {
    return (
      <div className="evaluation-preview-builder stage-evaluation-builder" aria-label="Evaluation Vorschau">
        <textarea
          className="preview-title-input"
          aria-label="Evaluationstitel"
          rows={4}
          value={edit.evaluationConfig?.title ?? defaultEvaluationConfig.title}
          onChange={(event) => updateEvaluationConfig((config) => ({ ...config, title: event.target.value }))}
          suppressHydrationWarning
        />
        <textarea
          className="preview-intro-input"
          aria-label="Evaluation Intro"
          rows={3}
          value={edit.evaluationConfig?.intro ?? defaultEvaluationConfig.intro}
          onChange={(event) => updateEvaluationConfig((config) => ({ ...config, intro: event.target.value }))}
          suppressHydrationWarning
        />
        <div className="preview-rating-row">
          <textarea
            aria-label="Verständnisfrage"
            rows={2}
            value={edit.evaluationConfig?.understandingLabel ?? defaultEvaluationConfig.understandingLabel}
            onChange={(event) => updateEvaluationConfig((config) => ({ ...config, understandingLabel: event.target.value }))}
            suppressHydrationWarning
          />
          <div className="preview-scale" aria-hidden="true"><span className="filled" /><span className="filled" /><span className="filled" /><span className="filled" /><span /></div>
        </div>
        <div className="preview-rating-row">
          <textarea
            aria-label="Tempofrage"
            rows={2}
            value={edit.evaluationConfig?.paceLabel ?? defaultEvaluationConfig.paceLabel}
            onChange={(event) => updateEvaluationConfig((config) => ({ ...config, paceLabel: event.target.value }))}
            suppressHydrationWarning
          />
          <div className="preview-scale" aria-hidden="true"><span className="filled" /><span className="filled" /><span className="filled" /><span className="filled" /><span /></div>
        </div>
        <div className="preview-rating-row">
          <textarea
            aria-label="KI-Frage"
            rows={2}
            value={edit.evaluationConfig?.aiHelpfulLabel ?? defaultEvaluationConfig.aiHelpfulLabel}
            onChange={(event) => updateEvaluationConfig((config) => ({ ...config, aiHelpfulLabel: event.target.value }))}
            suppressHydrationWarning
          />
          <div className="preview-scale" aria-hidden="true"><span className="filled" /><span className="filled" /><span className="filled" /><span className="filled" /><span /></div>
        </div>
        <textarea
          className="preview-comment-input"
          aria-label="Freitext"
          rows={2}
          value={edit.evaluationConfig?.commentLabel ?? defaultEvaluationConfig.commentLabel}
          onChange={(event) => updateEvaluationConfig((config) => ({ ...config, commentLabel: event.target.value }))}
          suppressHydrationWarning
        />
        <input
          className="preview-submit-input"
          aria-label="Evaluation Buttontext"
          value={edit.evaluationConfig?.submitLabel ?? defaultEvaluationConfig.submitLabel}
          onChange={(event) => updateEvaluationConfig((config) => ({ ...config, submitLabel: event.target.value }))}
          suppressHydrationWarning
        />
      </div>
    );
  }

  function renderQuestionStage() {
    if (reviews.length === 0) {
      const activeQuestion = selected.questions.find((question) => question.level === reviewLevel) ?? selected.questions[0];
      if (!activeQuestion) {
        return <p className="tool-empty-note">Noch keine Frage im Deck.</p>;
      }

      return (
        <div className="question-stage active-question-stage" aria-label="Aktive Live-Frage prüfen">
          <section className="review-live-question active-live-question">
            <div className="review-live-head">
              <div>
                <strong>Niveau {activeQuestion.level}</strong>
                <span>+{activeQuestion.points} Punkte</span>
              </div>
              <span>Aktive Frage</span>
            </div>
            <h3 className="review-live-title">{activeQuestion.text}</h3>
            <div className="review-live-answers">
              {activeQuestion.answers.map((answer) => (
                <div className={`review-live-answer lb-enter-row ${answer.correct ? "correct" : ""}`} key={answer.key}>
                  <strong>{answer.key}</strong>
                  <span>{answer.text}</span>
                </div>
              ))}
            </div>
            <p className="review-live-explanation">{activeQuestion.explanation}</p>
          </section>
        </div>
      );
    }
    if (!focusedReview || !activeReviewVariant) return null;
    const directEdit = focusedReview.status === "draft";
    return (
      <div className="question-stage" aria-label={editingReviewId === focusedReview.id ? "Frage im Quizlayout bearbeiten" : "Frage im Quizlayout prüfen"}>
        <section className={`review-live-question ${editingReviewId === focusedReview.id ? "editing" : ""}`}>
          <div className="review-live-head">
            <div>
              <strong>Niveau {activeReviewVariant.level}</strong>
              <span>+{activeReviewVariant.points} Punkte</span>
            </div>
            <span>{formatVariantReviewStatus(activeReviewVariant.reviewStatus ?? "draft")}</span>
          </div>

          {activeReviewVariant.learningObjective && !directEdit && (
            <p className="variant-objective">{activeReviewVariant.learningObjective}</p>
          )}

          <h3
            className="review-live-title"
            aria-label={`Fragetext Niveau ${activeReviewVariant.level}`}
            contentEditable={directEdit}
            onBlur={(event) => {
              if (!directEdit) return;
              const value = editableValue(event.currentTarget, activeReviewVariant.text);
              updateReviewDraft(focusedReview.id, activeReviewVariant.level, (item) => ({ ...item, text: value }));
            }}
            onKeyDown={finishInlineEdit}
            role={directEdit ? "textbox" : undefined}
            suppressContentEditableWarning
            tabIndex={directEdit ? 0 : undefined}
          >
            {activeReviewVariant.text}
          </h3>

          <div className="review-live-answers">
            {activeReviewVariant.answers.map((answer) => (
              <div className={`review-live-answer lb-enter-row ${answer.correct ? "correct" : ""}`} key={answer.key}>
                {directEdit ? (
                  <input
                    aria-label={`Korrekte Antwort ${activeReviewVariant.level} ${answer.key}`}
                    checked={answer.correct}
                    name={`${focusedReview.id}-${activeReviewVariant.level}-correct`}
                    onChange={() =>
                      updateReviewDraft(focusedReview.id, activeReviewVariant.level, (item) => ({
                        ...item,
                        answers: item.answers.map((candidate) => ({ ...candidate, correct: candidate.key === answer.key }))
                      }))
                    }
                    type="radio"
                  />
                ) : null}
                <strong>{answer.key}</strong>
                <span
                  aria-label={`Antwort ${activeReviewVariant.level} ${answer.key}`}
                  contentEditable={directEdit}
                  onBlur={(event) => {
                    if (!directEdit) return;
                    const value = editableValue(event.currentTarget, answer.text);
                    updateReviewDraft(focusedReview.id, activeReviewVariant.level, (item) => ({
                      ...item,
                      answers: item.answers.map((candidate) =>
                        candidate.key === answer.key ? { ...candidate, text: value } : candidate
                      )
                    }));
                  }}
                  onKeyDown={finishInlineEdit}
                  role={directEdit ? "textbox" : undefined}
                  suppressContentEditableWarning
                  tabIndex={directEdit ? 0 : undefined}
                >
                  {answer.text}
                </span>
              </div>
            ))}
          </div>

          {directEdit ? (
            <p
              className="review-live-explanation"
              aria-label={`Erklärung Niveau ${activeReviewVariant.level}`}
              contentEditable
              onBlur={(event) => {
                const value = editableValue(event.currentTarget, activeReviewVariant.explanation);
                updateReviewDraft(focusedReview.id, activeReviewVariant.level, (item) => ({ ...item, explanation: value }));
              }}
              onKeyDown={finishInlineEdit}
              role="textbox"
              suppressContentEditableWarning
              tabIndex={0}
            >
              {activeReviewVariant.explanation}
            </p>
          ) : (
            <>
              <p className="review-live-explanation">{activeReviewVariant.explanation}</p>
              {activeReviewVariant.reviewerComment && <p className="variant-comment">Kommentar: {activeReviewVariant.reviewerComment}</p>}
            </>
          )}

        </section>
      </div>
    );
  }

  function renderSourceComposer(surface: "drawer" | "inline") {
    const composerMode = sourceComposer ?? "file";
    const submitLabel = composerMode === "file"
      ? "Datei hinzufügen"
      : composerMode === "url"
        ? "Link hinzufügen"
        : composerMode === "notes"
          ? "Notiz übernehmen"
          : "";
    const modeOptions: Array<{ value: SourceComposer; label: string }> = [
      { value: "file", label: "Datei" },
      { value: "url", label: "Link" },
      { value: "notes", label: "Notiz" }
    ];

    return (
      <form
        className={`source-composer ${surface} active ${composerMode}`}
        encType="multipart/form-data"
        onSubmit={submitMaterial}
      >
        <div className="source-composer-anchor">
          <div className="source-composer-anchor-head">
            <div>
              <strong>Neue Quelle</strong>
            </div>
            <div className="source-mode-switch" aria-label="Quellentyp">
              {modeOptions.map((option) => (
                <button
                  aria-pressed={composerMode === option.value}
                  key={option.value}
                  type="button"
                  onClick={() => setSourceComposer(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          {composerMode === "file" && (
            <label className="source-composer-drop">
              <strong>{sourceFileName || "Datei auswählen"}</strong>
              <span>PowerPoint, PDF oder Audio</span>
              <input
                name="file"
                key={`file-${sourceInputVersion}`}
                type="file"
                accept=".ppt,.pptx,.pdf,.mp3,.wav,.m4a,.aac,.ogg,.oga,.webm,audio/*"
                aria-label="Datei"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  sourceFileRef.current = file;
                  setSourceUploadFile(file);
                  setSourceFileName(file?.name ?? "");
                }}
                suppressHydrationWarning
              />
            </label>
          )}
          {composerMode === "url" && (
            <label className="source-composer-field">
              <span>Weblink</span>
              <input name="url" type="url" placeholder="https://..." aria-label="URL" suppressHydrationWarning />
            </label>
          )}
          {composerMode === "notes" && (
            <label className="source-composer-field">
              <span>Notiz</span>
              <textarea name="notes" rows={6} placeholder="z. B. Lernziel, Transkriptstelle oder ergänzende Erklärung" aria-label="Notiz" suppressHydrationWarning />
            </label>
          )}
          <button className="primary-button" disabled={materialUploading} type="submit">
            {materialUploading ? "Speichert" : submitLabel}
          </button>
        </div>
      </form>
    );
  }

  function renderSlideSourceOverlay(motionState: PresenceState) {
    const lastRun = selected.materialProcessingRuns?.[0];
    const materials = selected.materials ?? [];
    const presentationAssets = selected.presentationAssets ?? [];
    const visiblePresentationAssets = [...presentationAssets].sort((left, right) => (
      Number(Boolean(presentationAssetPreviewUrl(right))) - Number(Boolean(presentationAssetPreviewUrl(left)))
    ));
    const materialLabel = materials.length === 1 ? "1 Quelle" : `${materials.length} Quellen`;
    const assetLabel = presentationAssets.length === 1 ? "1 Asset" : `${presentationAssets.length} Assets`;
    const lastRunCountLabel = lastRun
      ? lastRun.materialCount > 0
        ? `${lastRun.materialCount} Materialien · ${lastRun.chunkCount} Chunks · ${lastRun.reviewCount} Reviews`
        : "Keine neuen Quellen"
      : "";
    const extractionWarning = lastRun?.steps.find((step) => step.label.startsWith("Extraktion eingeschränkt"))?.detail;

    return (
      <aside className="studio-context-drawer materials studio-slide-source-overlay lb-enter-sheet" data-state={motionState} aria-label="Quellen direkt an der Folie">
        <button className="studio-panel-close" type="button" onClick={() => openWorkspaceTool("presentation")} aria-label="Quellen schließen">×</button>
        <header className="slide-overlay-head">
          <div>
            <strong>Quellen</strong>
            <span>{materialLabel} · {assetLabel}</span>
          </div>
          {materials.length > 0 && (
            <button
              className="primary-button"
              disabled={processingLectureId === selected.id || materialUploading}
              onClick={processMaterials}
              type="button"
            >
              {processingLectureId === selected.id ? "Läuft" : materialUploading ? "Quelle wird gespeichert" : "Fragen aktualisieren"}
            </button>
          )}
        </header>
        {renderSourceComposer("drawer")}
        {editError && <p role="alert" className="form-error">{editError}</p>}
        {processingMessage && <p className="form-note">{processingMessage}</p>}
        {lastRun && (
          <div className="slide-overlay-status" aria-label="Letzte Materialverarbeitung">
            <strong>{formatRunStatus(lastRun.status)}</strong>
            <span>{lastRunCountLabel}</span>
            {formatVisibleRunMessage(lastRun) && <small>{formatVisibleRunMessage(lastRun)}</small>}
            {extractionWarning && <small>{extractionWarning}</small>}
          </div>
        )}
        <section className="studio-asset-library" aria-label="Asset-Bibliothek">
          <div className="studio-asset-library-head">
            <strong>Asset-Bibliothek</strong>
            <span>{assetLabel}</span>
          </div>
          {presentationAssets.length === 0 ? (
            <p className="muted">Noch keine extrahierten Präsentationsassets. Quellen verarbeiten erzeugt Text-, Diagramm-, Formel- und Tabellenkandidaten.</p>
          ) : (
            <div className="studio-asset-list compact">
              {visiblePresentationAssets.slice(0, 6).map((asset) => {
                const previewUrl = presentationAssetPreviewUrl(asset);
                return (
                  <article className={`studio-asset-card${previewUrl ? " has-preview" : ""}`} key={asset.id}>
                    {previewUrl && (
                      <span className="studio-asset-thumb" style={{ backgroundImage: `url("${previewUrl}")` }} aria-hidden="true" />
                    )}
                    <header>
                      <span>{formatPresentationAssetKind(asset.kind)}</span>
                      <small data-review={asset.quality.needsReview ? "true" : "false"}>{formatPresentationAssetQuality(asset)}</small>
                    </header>
                    <strong>{asset.title}</strong>
                    <p>{assetPreview(asset)}</p>
                    <footer>
                      <span>{asset.source.originalName}</span>
                      {asset.source.sourceRef && <span>{asset.source.sourceRef}</span>}
                    </footer>
                  </article>
                );
              })}
            </div>
          )}
        </section>
        <div className="studio-source-list compact" aria-label="Hinterlegte Quellen">
          {materials.length === 0 ? (
            <p className="muted">Noch keine Quelle an dieser Folie.</p>
          ) : (
            materials.slice(0, 4).map((material) => (
              <span className="studio-source-chip" key={material.id} title={material.originalName}>
                <strong>{material.originalName}</strong>
                <small>{material.kind}</small>
              </span>
            ))
          )}
        </div>
      </aside>
    );
  }

  function renderSlideQuestionOverlay(motionState: PresenceState) {
    const focusedReviewIndex = focusedReview ? reviews.findIndex((review) => review.id === focusedReview.id) : -1;
    const visibleVariants = focusedVariants.length > 0 ? focusedVariants : selected.questions;
    const sourceLabel = reviews.length > 0 && focusedReview
      ? `Vorschlag ${focusedReviewIndex + 1} / ${reviews.length}`
      : `${selected.questions.length} aktive Varianten`;

    return (
      <aside className="studio-context-drawer questions studio-slide-tool-overlay studio-slide-question-overlay lb-enter-sheet" data-state={motionState} aria-label="Fragen direkt auf der Folie">
        <button className="studio-panel-close" type="button" onClick={() => openWorkspaceTool("presentation")} aria-label="Fragen schließen">×</button>
        <header className="slide-overlay-head">
          <div>
            <strong>Fragen</strong>
            <span>{sourceLabel}</span>
          </div>
        </header>

        <div className="studio-overlay-control-row">
          {reviews.length > 0 && focusedReview ? (
            <div className="studio-review-stepper" aria-label="Fragenvorschläge">
              <button
                type="button"
                onClick={() => selectReviewOffset(-1)}
                disabled={focusedReviewIndex <= 0}
                aria-label="Vorheriger Fragenvorschlag"
              >
                ‹
              </button>
              <div>
                <span>{focusedReview.sourceTitle}</span>
                <strong>{formatQuestionReviewStatus(focusedReview.status)}</strong>
              </div>
              <button
                type="button"
                onClick={() => selectReviewOffset(1)}
                disabled={focusedReviewIndex >= reviews.length - 1}
                aria-label="Nächster Fragenvorschlag"
              >
                ›
              </button>
            </div>
          ) : (
            <div className="studio-review-stepper" aria-label="Aktive Fragen">
              <div>
                <span>Aktive Live-Fragen</span>
                <strong>{selected.questions.length} Varianten</strong>
              </div>
            </div>
          )}
          <div className="studio-level-rail" aria-label="Niveau auswählen">
            {visibleVariants.map((variant) => (
              <button
                aria-pressed={variant.level === reviewLevel}
                key={variant.level}
                onClick={() => setReviewLevel(variant.level)}
                type="button"
              >
                {variant.level}
              </button>
            ))}
          </div>
          {focusedReview && (
            <div className="studio-overlay-actions" aria-label="Fragenentscheidung">
              {focusedReview.status === "draft" && editingReviewId === focusedReview.id ? (
                <>
                  <button className="primary-button" type="button" onClick={() => saveReviewEdit(focusedReview.id)}>Speichern</button>
                  <button className="plain-button" type="button" onClick={() => decideReview(focusedReview.id, "approved")}>Freigeben</button>
                </>
              ) : focusedReview.status === "draft" ? (
                <>
                  <button className="primary-button" type="button" onClick={() => decideReview(focusedReview.id, "approved")}>Freigeben</button>
                  <button className="plain-button" type="button" onClick={() => decideReview(focusedReview.id, "rejected")}>Ablehnen</button>
                </>
              ) : (
                <span>{formatQuestionReviewStatus(focusedReview.status)}</span>
              )}
            </div>
          )}
        </div>

        {reviewMessage && <p className="form-note">{reviewMessage}</p>}
        <div className="studio-overlay-live-preview">
          {renderQuestionStage()}
        </div>
      </aside>
    );
  }

  function renderSlideEvaluationOverlay(motionState: PresenceState) {
    return (
      <aside className="studio-context-drawer evaluation studio-slide-tool-overlay studio-slide-evaluation-overlay lb-enter-sheet" data-state={motionState} aria-label="Evaluation direkt auf der Folie">
        <button className="studio-panel-close" type="button" onClick={() => openWorkspaceTool("presentation")} aria-label="Evaluation schließen">×</button>
        <header className="slide-overlay-head">
          <div>
            <strong>Evaluation</strong>
            <span>Learn-Modus Vorschau</span>
          </div>
          <button className="primary-button" type="button" onClick={persistLectureEdits}>Speichern</button>
        </header>
        <label className="toggle-line studio-toggle-line">
          <input
            type="checkbox"
            checked={edit.evaluationConfig?.enabled ?? true}
            onChange={(event) => updateEvaluationConfig((config) => ({ ...config, enabled: event.target.checked }))}
            suppressHydrationWarning
          />
          im Learn-Modus anzeigen
        </label>
        {renderEvaluationPreview()}
        <label className="toggle-line studio-toggle-line">
          <input
            type="checkbox"
            checked={edit.saveEvaluationAsSeriesTemplate}
            onChange={(event) => setEdit((current) => ({ ...current, saveEvaluationAsSeriesTemplate: event.target.checked }))}
            suppressHydrationWarning
          />
          als Vorlage für die Reihe merken
        </label>
      </aside>
    );
  }

  function renderSlideAnalyticsOverlay(motionState: PresenceState) {
    const topCluster = analytics?.topicClusters.items[0];
    const topDraft = improvementDrafts[0];
    const visibleChatQuestions = (selected.studentChatQuestions ?? []).slice(0, 2);

    return (
      <aside className="studio-context-drawer analytics studio-slide-tool-overlay studio-slide-analytics-overlay lb-enter-sheet" data-state={motionState} aria-label="Auswertung direkt an der Folie">
        <button className="studio-panel-close" type="button" onClick={() => openWorkspaceTool("presentation")} aria-label="Auswertung schließen">×</button>
        <header className="slide-overlay-head">
          <div>
            <strong>Auswertung</strong>
            <span>{analytics ? `${analytics.participants} Teilnehmende · ${formatPercent(analytics.correctRate)} korrekt` : "Noch keine Daten"}</span>
          </div>
          <button className="plain-button" type="button" onClick={() => loadAnalytics(selected.id)}>Aktualisieren</button>
        </header>

        {analyticsError && <p role="alert" className="form-error">{analyticsError}</p>}
        {analyticsLoading && <p className="form-note">Analytics werden geladen.</p>}
        {chatModerationMessage && <p className="form-note" aria-live="polite">{chatModerationMessage}</p>}
        {improvementMessage && <p className="form-note" aria-live="polite">{improvementMessage}</p>}

        {analytics ? (
          <div className="studio-analytics-compact">
            <div className="studio-analytics-numbers" aria-label="Analytics-Kennzahlen">
              <span><strong>{analytics.answers}</strong> Antworten</span>
              <span><strong>{formatPercent(analytics.correctRate)}</strong> korrekt</span>
              <span><strong>{analytics.aiUsage.messages}</strong> KI-Fragen</span>
            </div>

            {topCluster && (
              <section className={`studio-insight-card ${topCluster.riskLevel}`} aria-label="Wichtigster Themencluster">
                <span>{topCluster.signalCount} Signale · {topCluster.riskLevel}</span>
                <strong>{topCluster.topic}</strong>
                <p>{topCluster.recommendation}</p>
              </section>
            )}

            {topDraft && (
              <section className="studio-insight-card draft" aria-label="Nächster Änderungsentwurf">
                <span>{topDraft.kind === "slide" ? "Folie" : "Frage"} · {topDraft.targetLabel}</span>
                <strong>{topDraft.title}</strong>
                <p>{topDraft.after}</p>
                <button className="primary-button" disabled={topDraft.applied} type="button" onClick={() => applyImprovementDraft(topDraft)}>
                  {topDraft.applied ? "Übernommen" : "Übernehmen"}
                </button>
              </section>
            )}

            {visibleChatQuestions.length > 0 && (
              <div className="studio-signal-pills" aria-label="Live-Signale">
                {visibleChatQuestions.map((question) => (
                  <button
                    key={question.id}
                    type="button"
                    disabled={chatModerationId === question.id}
                    onClick={() => moderateChatQuestion(question, question.status === "ignored" ? "accepted" : "ignored")}
                  >
                    <strong>{question.text}</strong>
                    <span>{formatChatStatus(question.status)}</span>
                  </button>
                ))}
              </div>
            )}

            <p className="muted">Letztes Event: {formatEventTime(analytics.lastEventAt)}</p>
          </div>
        ) : (
          <p className="muted">Noch keine Analytics für diese Vorlesung.</p>
        )}
      </aside>
    );
  }

  function renderSlideAssistantOverlay(motionState: PresenceState) {
    const sourceRefs = visibleAssistantMessages.flatMap((message) => message.sourceRefs ?? []).slice(-4);
    const latestAgentMetadata = [...visibleAssistantMessages].reverse().find((message) => message.role === "assistant" && message.metadata)?.metadata;
    const orderedToolPlan = [...(latestAgentMetadata?.toolPlan ?? [])].sort((left, right) => left.order - right.order);
    const primaryTool = orderedToolPlan.find((tool) => tool.status !== "blocked") ?? orderedToolPlan[0] ?? latestAgentMetadata?.toolSuggestions?.[0];
    const plannedByAction = new Map(orderedToolPlan.map((tool) => [tool.action, tool]));
    const executableToolPlan = orderedToolPlan.filter((tool) => tool.status !== "blocked").slice(0, 3);
    const assistantActionButtons: Array<{
      action: LecturerAssistantToolPlanItem["action"];
      label: string;
      loadingLabel: string;
      loading: boolean;
      onClick: () => void;
    }> = [
      {
        action: "source_note" as LecturerAssistantToolPlanItem["action"],
        label: "Quellen-Notiz",
        loadingLabel: "Legt an",
        loading: assistantSourceActionLoading,
        onClick: () => void createAssistantSourceNote()
      },
      {
        action: "slide_point" as LecturerAssistantToolPlanItem["action"],
        label: "Folienpunkt übernehmen",
        loadingLabel: "Übernimmt",
        loading: assistantSlideActionLoading,
        onClick: () => void applyAssistantSlidePoint()
      },
      {
        action: "review_draft" as LecturerAssistantToolPlanItem["action"],
        label: "Fragenentwurf",
        loadingLabel: "Legt an",
        loading: assistantActionLoading,
        onClick: () => void createAssistantReviewDraft()
      },
      {
        action: "evaluation_focus" as LecturerAssistantToolPlanItem["action"],
        label: "Evaluation schärfen",
        loadingLabel: "Schärft",
        loading: assistantEvaluationActionLoading,
        onClick: () => void applyAssistantEvaluationFocus()
      },
      {
        action: "learn_density" as LecturerAssistantToolPlanItem["action"],
        label: "Fragedichte setzen",
        loadingLabel: "Setzt",
        loading: assistantLearnDensityActionLoading,
        onClick: () => void applyAssistantLearnDensity()
      }
    ].sort((left, right) => {
      const leftPlan = plannedByAction.get(left.action);
      const rightPlan = plannedByAction.get(right.action);
      return (leftPlan?.order ?? 99) - (rightPlan?.order ?? 99);
    });

    return (
      <aside className="studio-context-drawer assistant studio-slide-tool-overlay studio-slide-assistant-overlay lb-enter-sheet" data-state={motionState} aria-label="Planungsassistent direkt an der Folie">
        <button className="studio-panel-close" type="button" onClick={() => openWorkspaceTool("presentation")} aria-label="Assistent schließen">×</button>
        <header className="slide-overlay-head">
          <div>
            <strong>Assistent</strong>
            <span>{studioSlide?.title ?? selected.title}</span>
            {primaryTool && <em>Nächster Schritt: {primaryTool.label}</em>}
          </div>
          <div className="assistant-actions">
            {executableToolPlan.length > 1 && (
              <button
                className="primary-button compact"
                type="button"
                onClick={() => void applyAssistantToolPlan()}
                disabled={assistantPlanActionLoading || assistantActionLoading || assistantSlideActionLoading || assistantSourceActionLoading || assistantEvaluationActionLoading || assistantLearnDensityActionLoading}
                title="Führt die vorgeschlagenen Agent-Aktionen in der angegebenen Reihenfolge aus."
              >
                {assistantPlanActionLoading ? "Führt aus" : "Toolkette ausführen"}
              </button>
            )}
            {assistantActionButtons.map((button) => {
              const plan = plannedByAction.get(button.action);
              const disabledByPlan = plan?.status === "blocked";
              return (
                <button
                  className={`plain-button ${plan ? "planned" : ""}`}
                  key={button.action}
                  type="button"
                  onClick={button.onClick}
                  disabled={button.loading || disabledByPlan || assistantPlanActionLoading}
                  title={disabledByPlan ? plan?.prerequisite ?? plan?.reason : plan?.reason}
                >
                  {button.loading ? button.loadingLabel : plan ? `${plan.order}. ${button.label}` : button.label}
                </button>
              );
            })}
          </div>
        </header>

        <div className="assistant-thread" aria-live="polite">
          {visibleAssistantMessages.length === 0 ? (
            <p className="assistant-empty">Noch keine Planung an dieser Folie.</p>
          ) : (
            visibleAssistantMessages.map((message) => (
              <article className={`assistant-message ${message.role}`} key={message.id}>
                <strong>{message.role === "assistant" ? "Assistent" : "Du"}</strong>
                {message.content.split("\n").filter(Boolean).map((line, index) => (
                  <p key={`${message.id}-${index}`}>{line}</p>
                ))}
                {message.role === "assistant" && message.metadata?.steps && message.metadata.steps.length > 0 && (
                  <div className="assistant-agent-steps" aria-label="Agent-Schritte">
                    {message.metadata.steps.slice(0, 5).map((step) => (
                      <span className={step.status} key={`${message.id}-${step.title}`}>
                        <strong>{step.title}</strong>
                        {step.detail}
                      </span>
                    ))}
                  </div>
                )}
                {message.role === "assistant" && message.metadata?.sourceWeights && message.metadata.sourceWeights.length > 0 && (
                  <div className="assistant-source-weights" aria-label="Quellengewichtung">
                    {message.metadata.sourceWeights.slice(0, 4).map((source) => (
                      <span key={`${message.id}-${source.label}`}>
                        <strong>{Math.round(source.weight * 100)}%</strong>
                        {source.label}
                      </span>
                    ))}
                  </div>
                )}
                {message.role === "assistant" && message.metadata?.toolPlan && message.metadata.toolPlan.length > 0 && (
                  <div className="assistant-tool-plan" aria-label="Nächste Agent-Aktionen">
                    {message.metadata.toolPlan.slice(0, 3).map((tool) => (
                      <span className={tool.status} key={`${message.id}-${tool.order}-${tool.action}`}>
                        <strong>{tool.order}. {tool.label}</strong>
                        {tool.prerequisite ? `${tool.reason} Voraussetzung: ${tool.prerequisite}` : tool.reason}
                      </span>
                    ))}
                  </div>
                )}
              </article>
            ))
          )}
        </div>

        {sourceRefs.length > 0 && (
          <div className="assistant-source-refs" aria-label="Bezugspunkte">
            {sourceRefs.map((ref, index) => <span key={`${ref}-${index}`}>{ref}</span>)}
          </div>
        )}

        {assistantError && <p role="alert" className="form-error">{assistantError}</p>}
        <form className="assistant-compose" onSubmit={sendAssistantMessage}>
          <textarea
            aria-label="Nachricht an den Planungsassistenten"
            value={assistantDraft}
            onChange={(event) => setAssistantDraft(event.target.value)}
            placeholder="z. B. Welche 1.0-Frage passt hier?"
            rows={3}
            suppressHydrationWarning
          />
          <button className="primary-button" type="submit" disabled={assistantLoading || !assistantDraft.trim()}>
            {assistantLoading ? "Antwortet" : "Senden"}
          </button>
        </form>
      </aside>
    );
  }

  function renderCreateLectureForm(context: "empty" | "stage") {
    return (
      <form className={`new-lecture-composer ${context}`} onSubmit={createLecture}>
        <article className="new-lecture-slide" aria-label="Neue Vorlesung Vorschau">
          <span>Neue Vorlesung</span>
          <h2
            aria-label="Titel"
            contentEditable
            onBlur={(event) => updateCreateDraftText("title", event.currentTarget)}
            onKeyDown={finishInlineEdit}
            role="textbox"
            suppressContentEditableWarning
            tabIndex={0}
          >
            {createDraft.title}
          </h2>
          <p
            aria-label="Vorlesungsreihe"
            contentEditable
            onBlur={(event) => updateCreateDraftText("seriesTitle", event.currentTarget)}
            onKeyDown={finishInlineEdit}
            role="textbox"
            suppressContentEditableWarning
            tabIndex={0}
          >
            {createDraft.seriesTitle}
          </p>
          <div className="new-lecture-dates">
            <label>
              Live
              <input
                name="liveAt"
                type="datetime-local"
                value={createDraft.liveAt}
                onChange={(event) => setCreateDraft((current) => ({ ...current, liveAt: event.target.value }))}
                required
                suppressHydrationWarning
              />
            </label>
            <label>
              Prüfung
              <input
                name="examDate"
                type="date"
                value={createDraft.examDate}
                onChange={(event) => setCreateDraft((current) => ({ ...current, examDate: event.target.value }))}
                required
                suppressHydrationWarning
              />
            </label>
          </div>
        </article>
        <input name="title" type="hidden" value={createDraft.title} readOnly />
        <input name="seriesTitle" type="hidden" value={createDraft.seriesTitle} readOnly />
        <div className="new-lecture-actions">
          {context === "stage" && selected && (
            <button className="plain-button" type="button" onClick={() => setShowCreateForm(false)}>
              Abbrechen
            </button>
          )}
          <button className="primary-button" type="submit">Vorlesung öffnen</button>
        </div>
        {createError && <p role="alert" className="form-error">{createError}</p>}
      </form>
    );
  }

  function openWorkspaceTool(tool: WorkspaceTool) {
    setCommandMenuOpen(false);
    setToolMenuOpen(false);
    setShowCreateForm(false);
    setPlanEditor(null);
    setWorkspaceTool((current) => {
      const nextTool = current === tool && tool !== "presentation" ? "presentation" : tool;
      if (nextTool === "materials") setSourceComposer(null);
      return nextTool;
    });
  }

  function selectReviewOffset(offset: number) {
    if (!focusedReview || reviews.length <= 1) return;
    const currentIndex = Math.max(0, reviews.findIndex((review) => review.id === focusedReview.id));
    const nextIndex = Math.min(reviews.length - 1, Math.max(0, currentIndex + offset));
    setReviewFocusId(reviews[nextIndex].id);
  }

  function renderSlideToolMenu() {
    const questionCount = reviews.length || selected.questions.length;
    const materialCount = selected.materials?.length ?? 0;
    const analyticsCount = analytics?.participants ?? selected.studentChatQuestions?.length ?? 0;
    const assistantCount = selected.assistantMessages?.length ?? 0;
    const activeTool = workspaceTools.find((tool) => tool.value === workspaceTool);
    const toolItems: Array<{ tool: WorkspaceTool; detail: string; count?: string }> = [
      { tool: "assistant", detail: "Assistent", count: assistantCount > 0 ? String(assistantCount) : "KI" },
      { tool: "questions", detail: "Fragen", count: String(questionCount) },
      { tool: "materials", detail: "Quellen", count: String(materialCount) },
      { tool: "analytics", detail: "Auswertung", count: String(analyticsCount) },
      { tool: "evaluation", detail: "Evaluation", count: edit.evaluationConfig?.enabled === false ? "aus" : "an" }
    ];

    return (
      <div className="studio-tool-menu" data-open={toolMenuOpen ? "true" : "false"}>
        <button
          className="studio-tool-trigger"
          type="button"
          aria-label="Folienwerkzeuge öffnen"
          aria-expanded={toolMenuOpen}
          onClick={() => setToolMenuOpen((current) => !current)}
        >
          <span>{workspaceTool === "presentation" ? "Werkzeuge" : activeTool?.shortLabel ?? "Werkzeuge"}</span>
        </button>
        <Presence show={toolMenuOpen} exitMs={200}>
          {(motionState) => (
            <div className="studio-tool-popover lb-enter-panel" data-state={motionState} aria-label="Folienwerkzeuge">
              {toolItems.map((item, index) => {
                const tool = workspaceTools.find((candidate) => candidate.value === item.tool)!;
                return (
                  <button
                    aria-label={tool.label}
                    aria-pressed={workspaceTool === item.tool}
                    className={`studio-tool-choice lb-enter-row ${workspaceTool === item.tool ? "active" : ""}`}
                    key={item.tool}
                    style={{ "--lb-i": index } as MotionStyle}
                    type="button"
                    onClick={() => openWorkspaceTool(item.tool)}
                  >
                    <strong>{item.detail}</strong>
                    {item.count ? <small>{item.count}</small> : null}
                  </button>
                );
              })}
            </div>
          )}
        </Presence>
      </div>
    );
  }

  function renderPlanSummaryButton() {
    return (
      <button
        className={`studio-plan-summary-button ${planEditor ? "active" : ""}`}
        type="button"
        onClick={() => setPlanEditor((current) => (current ? null : "status"))}
      >
        <span>Planung</span>
        <strong>{formatLectureStatus(edit.status)}</strong>
      </button>
    );
  }

  function renderPlanTabs() {
    const planItems: Array<{ editor: Exclude<PlanEditor, null>; label: string; value: string }> = [
      { editor: "status", label: "Status", value: formatLectureStatus(edit.status) },
      { editor: "live", label: "Live", value: formatPlanDateTime(edit.liveAt) },
      { editor: "exam", label: "Prüfung", value: formatPlanDate(edit.examDate) },
      { editor: "learn", label: "Learn", value: `${normalizeLearnQuestionDensity(edit.learnQuestionDensity)} Hotspots` },
      { editor: "leaderboard", label: "Rangliste", value: edit.leaderboardEnabled ? "an" : "aus" },
      { editor: "budget", label: "KI", value: `${edit.aiDailyLimit}/${edit.seriesAiDailyLimit}/${edit.tenantAiDailyLimit}` }
    ];

    return (
      <div className="studio-plan-tabs" aria-label="Planungsbereich">
        {planItems.map((item) => (
          <button
            aria-pressed={planEditor === item.editor}
            key={item.editor}
            type="button"
            title={`${item.label}: ${item.value}`}
            onClick={() => setPlanEditor(item.editor)}
          >
            {item.label}
          </button>
        ))}
      </div>
    );
  }

  function renderStudioHotspots() {
    const questionCount = reviews.length || selected.questions.length;
    const materialCount = selected.materials?.length ?? 0;
    const analyticsCount = analytics?.participants ?? selected.studentChatQuestions?.length ?? 0;
    const assistantCount = selected.assistantMessages?.length ?? 0;
    const hotspots: Array<{ tool: WorkspaceTool; icon: string; label: string; count?: string }> = [
      { tool: "assistant", icon: "assistant", label: "Assistent an dieser Folie", count: assistantCount > 0 ? String(assistantCount) : undefined },
      { tool: "questions", icon: "question", label: "Fragen auf dieser Folie", count: String(questionCount) },
      { tool: "materials", icon: "source", label: "Quellen für diese Folie", count: materialCount > 0 ? String(materialCount) : undefined },
      { tool: "analytics", icon: "analytics", label: "Lernsignale zu dieser Folie", count: analyticsCount > 0 ? String(analyticsCount) : undefined },
      { tool: "evaluation", icon: "eval", label: "Evaluation im Learn-Modus", count: edit.evaluationConfig?.enabled === false ? "aus" : undefined }
    ];

    return (
      <div className="studio-hotspots" aria-label="Direktwerkzeuge auf der Folie">
        {hotspots.map((item, index) => (
          <button
            aria-label={item.label}
            aria-pressed={workspaceTool === item.tool}
            className={`studio-hotspot lb-enter-hotspot ${workspaceTool === item.tool ? "active" : ""}`}
            key={item.tool}
            style={{ "--lb-i": index } as MotionStyle}
            title={item.label}
            type="button"
            onClick={() => openWorkspaceTool(item.tool)}
          >
            <span className={`lb-icon lb-icon-${item.icon}`} aria-hidden="true" />
            {item.count ? <small>{item.count}</small> : null}
          </button>
        ))}
      </div>
    );
  }

  function renderFilmstripRail() {
    return (
      <aside className="studio-filmstrip-rail" aria-label="Folien">
        <div className="studio-account-mini">
          <strong>{edit.title}</strong>
          <span>{formatLectureStatus(edit.status)}</span>
        </div>
        <div className="studio-filmstrip-list" aria-label="Folie auswählen">
          {studioSlides.map((slide, index) => (
            <button
              aria-current={index === activeStudioSlideIndex ? "true" : undefined}
              className={index === activeStudioSlideIndex ? "active" : ""}
              data-slide-id={slide.id}
              key={slide.id}
              ref={(node) => {
                if (node) {
                  filmstripButtonRefs.current.set(slide.id, node);
                } else {
                  filmstripButtonRefs.current.delete(slide.id);
                }
              }}
              title={slide.title}
              type="button"
              onClick={(event) => moveToStudioSlide(index, event.currentTarget)}
            >
              <span>{index + 1}</span>
              <strong>{slide.title}</strong>
            </button>
          ))}
        </div>
        <button
          className="studio-create-trigger"
          type="button"
          onClick={() => {
            setWorkspaceTool("presentation");
            setPlanEditor(null);
            setShowCreateForm(true);
          }}
        >
          Neue Vorlesung
        </button>
      </aside>
    );
  }

  function renderPlanEditor() {
    if (!planEditor) return null;
    const planTitle = {
      status: "Status",
      live: "Live-Termin",
      exam: "Prüfungstag",
      learn: "Learn-Modus",
      leaderboard: "Rangliste",
      budget: "KI-Budget"
    } satisfies Record<Exclude<PlanEditor, null>, string>;

    return (
      <section className={`studio-plan-popover lb-enter-panel ${planEditor}`} aria-label="Planung bearbeiten">
        <button
          className="studio-plan-close"
          type="button"
          onClick={() => setPlanEditor(null)}
          aria-label="Planung schließen"
        >
          ×
        </button>
        <header className="studio-plan-head">
          <strong>{planTitle[planEditor]}</strong>
        </header>
        {renderPlanTabs()}

        {planEditor === "status" && (
          <div className="plan-status-grid" aria-label="Status auswählen">
            {statusOptions.map((option) => (
              <button
                className={edit.status === option.value ? "selected" : ""}
                key={option.value}
                type="button"
                onClick={() => setEdit((current) => ({ ...current, status: option.value }))}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}

        {planEditor === "live" && (
          <div className="plan-field-card">
            <label>
              Live-Termin
              <input
                type="datetime-local"
                value={edit.liveAt}
                onChange={(event) => setEdit((current) => ({ ...current, liveAt: event.target.value }))}
                suppressHydrationWarning
              />
            </label>
          </div>
        )}

        {planEditor === "exam" && (
          <div className="plan-field-card">
            <label>
              Prüfungstag
              <input
                type="date"
                value={edit.examDate}
                onChange={(event) => setEdit((current) => ({ ...current, examDate: event.target.value }))}
                suppressHydrationWarning
              />
            </label>
          </div>
        )}

        {planEditor === "learn" && (
          <div className="plan-field-card learn-density-card">
            <label>
              Fragedichte
              <input
                aria-label="Learn-Fragedichte"
                type="range"
                min={MIN_LEARN_QUESTION_DENSITY}
                max={MAX_LEARN_QUESTION_DENSITY}
                value={normalizeLearnQuestionDensity(edit.learnQuestionDensity)}
                onChange={(event) => setEdit((current) => ({
                  ...current,
                  learnQuestionDensity: String(normalizeLearnQuestionDensity(event.target.value))
                }))}
                suppressHydrationWarning
              />
              <strong>{normalizeLearnQuestionDensity(edit.learnQuestionDensity)}</strong>
            </label>
            <p className="form-note">Steuert die Anzahl der Frageanker auf jeder Learn-Folie.</p>
          </div>
        )}

        {planEditor === "budget" && (
          <div className="plan-budget-grid" aria-label="KI-Budget">
            <label>
              Vorlesung
              <input
                aria-label="Vorlesung: KI-Fragen/Tag"
                type="number"
                min={1}
                max={200}
                value={edit.aiDailyLimit}
                onChange={(event) => setEdit((current) => ({ ...current, aiDailyLimit: event.target.value }))}
                suppressHydrationWarning
              />
              <small>Fragen/Tag</small>
            </label>
            <label>
              Reihe
              <input
                aria-label="Reihe: KI-Fragen/Tag"
                type="number"
                min={1}
                max={200}
                value={edit.seriesAiDailyLimit}
                onChange={(event) => setEdit((current) => ({ ...current, seriesAiDailyLimit: event.target.value }))}
                suppressHydrationWarning
              />
              <small>Fragen/Tag</small>
            </label>
            <label>
              Konto
              <input
                aria-label="Konto: KI-Fragen/Tag"
                type="number"
                min={1}
                max={200}
                value={edit.tenantAiDailyLimit}
                onChange={(event) => setEdit((current) => ({ ...current, tenantAiDailyLimit: event.target.value }))}
                suppressHydrationWarning
              />
              <small>Fragen/Tag</small>
            </label>
            <details className="plan-token-details">
              <summary>Tokenbudget</summary>
              <div>
                <label>
                  Vorlesung
                  <input
                    aria-label="Vorlesung: KI-Tokens/Tag"
                    type="number"
                    min={100}
                    max={200000}
                    step={100}
                    value={edit.aiDailyTokenLimit}
                    onChange={(event) => setEdit((current) => ({ ...current, aiDailyTokenLimit: event.target.value }))}
                    suppressHydrationWarning
                  />
                </label>
                <label>
                  Reihe
                  <input
                    aria-label="Reihe: KI-Tokens/Tag"
                    type="number"
                    min={100}
                    max={200000}
                    step={100}
                    value={edit.seriesAiDailyTokenLimit}
                    onChange={(event) => setEdit((current) => ({ ...current, seriesAiDailyTokenLimit: event.target.value }))}
                    suppressHydrationWarning
                  />
                </label>
                <label>
                  Konto
                  <input
                    aria-label="Konto: KI-Tokens/Tag"
                    type="number"
                    min={100}
                    max={200000}
                    step={100}
                    value={edit.tenantAiDailyTokenLimit}
                    onChange={(event) => setEdit((current) => ({ ...current, tenantAiDailyTokenLimit: event.target.value }))}
                    suppressHydrationWarning
                  />
                </label>
              </div>
            </details>
          </div>
        )}

        {planEditor === "leaderboard" && (
          <div className="plan-field-card">
            <label className="toggle-line studio-toggle-line">
              <input
                type="checkbox"
                checked={edit.leaderboardEnabled}
                onChange={(event) => setEdit((current) => ({ ...current, leaderboardEnabled: event.target.checked }))}
                suppressHydrationWarning
              />
              Leaderboard für Studierende anzeigen
            </label>
            <p className="form-note">Nur zur Motivation und Selbsteinschätzung, nicht prüfungsrelevant.</p>
          </div>
        )}

        <div className="studio-plan-actions">
          <button className="primary-button" type="button" onClick={() => void savePlanEdits()}>
            Speichern
          </button>
          <button className="plain-button" type="button" onClick={() => setPlanEditor(null)}>
            Schließen
          </button>
        </div>
      </section>
    );
  }

  if (!selected) {
    return (
      <main className="app-shell lecturer-studio-shell lb-motion-root" data-csrf-token={csrfToken}>
        <section className="lecturer-studio lecturer-studio-empty">
          <section className="studio-slide-stage" aria-label="Neue Vorlesung anlegen">
            <div className="studio-slide-shell">
              <div className="slide-preview-frame editable-slide-frame studio-editor-frame studio-create-stage" role="dialog" aria-label="Neue Vorlesung als Folie anlegen">
                {renderCreateLectureForm("empty")}
              </div>
            </div>
          </section>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell lecturer-studio-shell lb-motion-root" data-csrf-token={csrfToken}>
        <section className={`lecturer-studio ${workspaceTool !== "presentation" ? "tool-open" : ""}`}>
          <details
            className="studio-command-menu"
            open={commandMenuOpen}
            onToggle={(event) => setCommandMenuOpen(event.currentTarget.open)}
          >
            <summary aria-label="Studio-Menü">☰</summary>
            <div className="studio-command-popover">
              <section className="studio-menu-section" aria-label="Vorlesung wechseln">
                <div className="studio-menu-heading">
                  <span>Vorlesung</span>
                  <strong>{selected.title}</strong>
                </div>
                <div className="studio-deck-picker compact" role="listbox" aria-label="Vorlesung auswählen">
                  {lectures.slice(0, 4).map((lecture) => {
                    const previewSlide = lecture.slides[0];
                    return (
                      <button
                        aria-selected={lecture.id === selected.id}
                        className={`studio-deck-card ${lecture.id === selected.id ? "active" : ""}`}
                        key={lecture.id}
                        role="option"
                        type="button"
                        onClick={() => {
                          setSelectedId(lecture.id);
                          setCommandMenuOpen(false);
                        }}
                      >
                        <span>{formatLectureStatus(lecture.status)}</span>
                        <strong>{lecture.title}</strong>
                        <small>{previewSlide?.title ?? lecture.seriesTitle}</small>
                      </button>
                    );
                  })}
                </div>
                {lectures.length > 4 && <p className="studio-menu-note">{lectures.length - 4} weitere Vorlesungen werden später über Suche gefiltert.</p>}
                <button
                  className="studio-command-primary"
                  type="button"
                  onClick={() => {
                    setCommandMenuOpen(false);
                    setWorkspaceTool("presentation");
                    setShowCreateForm(true);
                  }}
                >
                  Neue Vorlesung
                </button>
              </section>
              <section className="studio-menu-section" aria-label="Ansichten öffnen">
                <div className="studio-menu-heading">
                  <span>Ansichten</span>
                  <strong>Öffnen und prüfen</strong>
                </div>
                <nav>
                  <Link href={`/lecturer/live/${selected.publicToken}`}>Dozent Live</Link>
                  <Link href={`/l/${selected.publicToken}`}>Student Link</Link>
                  <Link href={`/learn/${selected.publicToken}`}>Learn prüfen</Link>
                  <button
                    type="button"
                    onClick={() => {
                      setCommandMenuOpen(false);
                      openWorkspaceTool("evaluation");
                    }}
                  >
                    Evaluation
                  </button>
                  <a href={`/api/lecture/${selected.publicToken}/export`} download>Standalone HTML</a>
                  <a href={`/api/lecture/${selected.publicToken}/export?format=zip`} download>Archiv ZIP</a>
                </nav>
              </section>
              <section className="studio-menu-section" aria-label="Code teilen">
                <div className="studio-menu-heading">
                  <span>Code teilen</span>
                  <strong>{selected.seriesTitle}</strong>
                </div>
                <JoinCodeEditor
                  seriesId={seriesIdFromTitle(selected.seriesTitle)}
                  seriesTitle={selected.seriesTitle}
                  csrfToken={csrfToken}
                />
              </section>
              <section className="studio-menu-section studio-menu-export" aria-label="Archiv">
                <div className="studio-menu-heading">
                  <span>Archiv</span>
                  <strong>Standalone</strong>
                </div>
                <span className={`studio-export-status ${latestExportJob?.status ?? "queued"}`}>
                  {latestExportJob
                    ? `${formatExportJobStatus(latestExportJob.status)} · ${formatVisibleExportJobMessage(latestExportJob)}`
                    : latestStandaloneExport
                      ? `${formatExportTime(latestStandaloneExport.createdAt)} · ${formatSha(latestStandaloneExport.sha256)}`
                      : "Noch kein archivierter Stand."}
                </span>
                <form action={`/lecturer/actions/exports/${selected.id}`} method="post">
                  <input type="hidden" name="csrfToken" value={csrfToken} />
                  <button type="submit">Archiv speichern</button>
                </form>
                {latestStoredArchive?.storageUrl && (
                  <a className="studio-command-link" href={latestStoredArchive.storageUrl} download>Gespeicherten Stand laden</a>
                )}
              </section>
              <a className="studio-command-link" href="/api/auth/logout">Logout</a>
            </div>
          </details>
          {renderFilmstripRail()}

          <section className={`studio-slide-stage ${workspaceTool === "questions" ? "question-active" : ""}`} aria-label="Präsentation bearbeiten">
            <div className="studio-slide-shell">
              {showCreateForm ? (
                <div className="slide-preview-frame editable-slide-frame studio-editor-frame studio-create-stage" role="dialog" aria-label="Neue Vorlesung als Folie anlegen">
                  {renderCreateLectureForm("stage")}
                </div>
              ) : studioSlide ? (
                <>
                  <div className="slide-preview-frame editable-slide-frame studio-editor-frame" ref={stageFrameRef}>
                    <article className="dashboard-slide-preview editable-slide studio-editor-slide lb-enter-stage" data-slide-id={studioSlide.id} key={studioSlide.id}>
                    <div className="slide-meta editable-meta lb-enter-row" style={{ "--lb-i": 0 } as MotionStyle}>
                      <span
                        aria-label="Folienkennung"
                        contentEditable
                        data-slide-field="eyebrow"
                        onInput={(event) => {
                          const value = inlineDraftValue(event.currentTarget);
                          if (value) updateSlideDraft(studioSlide.id, (slide) => ({ ...slide, eyebrow: value }));
                        }}
                        onBlur={(event) => {
                          const value = editableValue(event.currentTarget, studioSlide.eyebrow);
                          updateSlideDraft(studioSlide.id, (slide) => ({ ...slide, eyebrow: value }));
                        }}
                        onKeyDown={finishInlineEdit}
                        role="textbox"
                        suppressContentEditableWarning
                        tabIndex={0}
                      >
                        {studioSlide.eyebrow}
                      </span>
                      <span
                        aria-label="Vorlesungsreihe"
                        contentEditable
                        data-lecture-field="seriesTitle"
                        onInput={(event) => {
                          const value = inlineDraftValue(event.currentTarget);
                          if (value) setEdit((current) => ({ ...current, seriesTitle: value }));
                        }}
                        onBlur={(event) => {
                          const value = editableValue(event.currentTarget, edit.seriesTitle);
                          setEdit((current) => ({ ...current, seriesTitle: value }));
                        }}
                        onKeyDown={finishInlineEdit}
                        role="textbox"
                        suppressContentEditableWarning
                        tabIndex={0}
                      >
                        {edit.seriesTitle}
                      </span>
                    </div>
                    <h1
                      className="slide-title-editor lb-enter-row"
                      style={{ "--lb-i": 1 } as MotionStyle}
                      aria-label="Folientitel"
                      contentEditable
                      data-slide-field="title"
                      onInput={(event) => {
                        const value = inlineDraftValue(event.currentTarget);
                        if (value) updateSlideDraft(studioSlide.id, (slide) => ({ ...slide, title: value }));
                      }}
                      onBlur={(event) => {
                        const value = editableValue(event.currentTarget, studioSlide.title);
                        updateSlideDraft(studioSlide.id, (slide) => ({ ...slide, title: value }));
                      }}
                      onKeyDown={finishInlineEdit}
                      role="textbox"
                      suppressContentEditableWarning
                      tabIndex={0}
                    >
                      {studioSlide.title}
                    </h1>
                    <div className="dashboard-slide-body">
                      <div className="slide-copy editable-copy">
                        {studioSlide.copy.map((line, index) => (
                          <div className="copy-line-editor" key={`${studioSlide.id}-${index}`}>
                            <p
                              className="lb-enter-row"
                              aria-label={`Folientext ${index + 1}`}
                              contentEditable
                              data-slide-copy-index={index}
                              onInput={(event) => {
                                const value = inlineDraftValue(event.currentTarget);
                                if (value) updateSlideCopy(studioSlide.id, index, value);
                              }}
                              onBlur={(event) => {
                                const value = editableValue(event.currentTarget, line);
                                updateSlideCopy(studioSlide.id, index, value);
                              }}
                              onKeyDown={finishInlineEdit}
                              role="textbox"
                              suppressContentEditableWarning
                              tabIndex={0}
                            >
                              {line}
                            </p>
                            <button
                              type="button"
                              aria-label={`Folientext ${index + 1} entfernen`}
                              onClick={() => removeSlideCopyLine(studioSlide.id, index)}
                              disabled={studioSlide.copy.length <= 1}
                            >
                              ×
                            </button>
                          </div>
                        ))}
                        {studioSlide.copy.length < 4 && (
                          <button className="inline-add-button" type="button" onClick={() => addSlideCopyLine(studioSlide.id)}>
                            Textzeile hinzufügen
                          </button>
                        )}
                      </div>
                      <div className="diagram dashboard-diagram editable-diagram lb-enter-panel">
                        <Diagram type={studioSlide.diagram} />
                        <select
                          aria-label="Diagrammtyp"
                          value={studioSlide.diagram}
                          onChange={(event) =>
                            updateSlideDraft(studioSlide.id, (slide) => ({
                              ...slide,
                              diagram: event.target.value as Slide["diagram"]
                            }))
                          }
                          suppressHydrationWarning
                        >
                          <option value="bearing">Lager</option>
                          <option value="formula">Formel</option>
                          <option value="ramp">Anlauf</option>
                        </select>
                      </div>
                    </div>
                    <footer className="slide-foot editable-foot">
                      <span
                        aria-label="Folienthema"
                        contentEditable
                        data-slide-field="topic"
                        onInput={(event) => {
                          const value = inlineDraftValue(event.currentTarget);
                          if (value) updateSlideDraft(studioSlide.id, (slide) => ({ ...slide, topic: value }));
                        }}
                        onBlur={(event) => {
                          const value = editableValue(event.currentTarget, studioSlide.topic);
                          updateSlideDraft(studioSlide.id, (slide) => ({ ...slide, topic: value }));
                        }}
                        onKeyDown={finishInlineEdit}
                        role="textbox"
                        suppressContentEditableWarning
                        tabIndex={0}
                      >
                        {studioSlide.topic}
                      </span>
                      <span>{activeStudioSlideIndex + 1} / {studioSlides.length}</span>
                    </footer>
                    </article>
                  </div>
                  <Presence show={workspaceTool === "materials"}>
                    {(motionState) => renderSlideSourceOverlay(motionState)}
                  </Presence>
                  <Presence show={workspaceTool === "assistant"}>
                    {(motionState) => renderSlideAssistantOverlay(motionState)}
                  </Presence>
                  <Presence show={workspaceTool === "questions"}>
                    {(motionState) => renderSlideQuestionOverlay(motionState)}
                  </Presence>
                  <Presence show={workspaceTool === "evaluation"}>
                    {(motionState) => renderSlideEvaluationOverlay(motionState)}
                  </Presence>
                  <Presence show={workspaceTool === "analytics"}>
                    {(motionState) => renderSlideAnalyticsOverlay(motionState)}
                  </Presence>
                  {engineEditorOpen && (
                    <StudioSlideDocumentEditor
                      currentIndex={activeStudioSlideIndex}
                      presentationAssets={selected.presentationAssets}
                      seriesTitle={edit.seriesTitle}
                      slideDocument={edit.slideDocument}
                      slides={studioSlides}
                      onSlideDocumentChange={updateSlideDocumentFromEngine}
                    />
                  )}
                  {renderStudioHotspots()}
                </>
              ) : (
                <div className="workspace-empty-inline">Noch keine Folien vorhanden.</div>
              )}
            </div>

            {!showCreateForm && (
              <div className="studio-bottom-bar lb-enter-control" aria-label="Foliensteuerung">
                <div className="studio-stepper">
                  <button
                    type="button"
                    onClick={() => moveToStudioSlide(activeStudioSlideIndex - 1)}
                    disabled={activeStudioSlideIndex === 0}
                    aria-label="Vorherige Folie"
                  >
                    ‹
                  </button>
                  <span>{activeStudioSlideIndex + 1} / {studioSlides.length || 1}</span>
                  <button
                    type="button"
                    onClick={() => moveToStudioSlide(activeStudioSlideIndex + 1)}
                    disabled={activeStudioSlideIndex >= studioSlides.length - 1}
                    aria-label="Nächste Folie"
                  >
                    ›
                  </button>
                </div>
                {renderPlanSummaryButton()}
                {renderPlanEditor()}
                {renderSlideToolMenu()}
                <button
                  aria-pressed={engineEditorOpen}
                  className="plain-button studio-engine-toggle"
                  type="button"
                  onClick={() => setEngineEditorOpen((open) => !open)}
                >
                  Engine
                </button>
                <button className="primary-button studio-save-inline" type="button" onClick={persistLectureEdits}>Speichern</button>
                {workspaceTool === "presentation" && editError && <p role="alert" className="form-error deck-error">{editError}</p>}
              </div>
            )}

          </section>
        </section>
      </main>
    );
}
