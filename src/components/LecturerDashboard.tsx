"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { defaultEvaluationConfig } from "@/lib/evaluation";
import {
  normalizeLearnQuestionDensity
} from "@/lib/learn-settings";
import {
  animateStudioInsightSharedElement,
  animateStudioSlideSharedElement,
  animateStudioToolSharedElement
} from "@/lib/motion";
import { seriesIdFromTitle } from "@/lib/series";
import { buildLegacyLectureSlideDocument } from "@/lib/slide-documents";
import { JoinCodeEditor } from "./lecturer/JoinCodeEditor";
import { StudioIntentComposer } from "./lecturer/StudioIntentComposer";
import { StudioSlideDocumentEditor } from "./lecturer/StudioSlideDocumentEditor";
import { Diagram } from "./Diagram";
import { Presence } from "./Presence";
import type { PresenceState } from "./Presence";
import type {
  Lecture,
  LectureAnalyticsSummary,
  LectureMaterial,
  LectureStatus,
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
import {
  DeckRenderer,
  legacyDiagramAssetId,
  type SlideAssetRef,
  type SlideDocument
} from "@learnordie/slide-engine";
import type { SlideAsset } from "@learnordie/slide-engine/components";
import type { FormEvent, KeyboardEvent, MouseEvent as ReactMouseEvent } from "react";

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

type WorkspaceTool = "presentation" | "evaluation" | "questions" | "materials" | "analytics";
type SourceComposer = "file" | "url" | "notes" | null;
type MotionStyle = CSSProperties & Record<"--lb-i", number>;
type SharedStudioTool = Extract<WorkspaceTool, "materials" | "analytics">;
type StudioToolMotion = { tool: SharedStudioTool; first: DOMRect; label: string };

const workspaceTools: Array<{ value: WorkspaceTool; label: string; shortLabel: string }> = [
  { value: "presentation", label: "Folie bearbeiten", shortLabel: "Folie" },
  { value: "questions", label: "Fragen direkt an dieser Folie bearbeiten", shortLabel: "Fragen" },
  { value: "materials", label: "Material zu dieser Folie hinzufügen", shortLabel: "Quellen" },
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

const MAX_SOURCE_UPLOAD_BYTES = 25 * 1024 * 1024;

function formatFileSize(value?: number) {
  if (!value || value <= 0) return "";
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1).replace(/\.0$/, "")} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${Math.round(value)} B`;
}

function formatMaterialStatus(material: LectureMaterial, runActive: boolean) {
  if (material.status === "processing") return runActive ? "Verarbeitung läuft" : "Fehler";
  if (material.status === "ready") return "Bereit";
  return "Hochgeladen";
}

function formatRunStepStatus(status: MaterialProcessingRun["steps"][number]["status"]) {
  return ({
    running: "Läuft",
    done: "Fertig",
    failed: "Fehler",
    skipped: "Hinweis"
  } as const)[status];
}

type SourceUploadItem = {
  id: string;
  file: File;
  status: "queued" | "uploading" | "done" | "error";
  error?: string;
};

function formatSourceUploadStatus(status: SourceUploadItem["status"]) {
  return ({
    queued: "Wartet",
    uploading: "Lädt hoch",
    done: "Fertig",
    error: "Fehler"
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

function renderLegacyDiagramAsset(asset: SlideAsset): ReactNode {
  if (asset.id === legacyDiagramAssetId("bearing")) return <Diagram type="bearing" />;
  if (asset.id === legacyDiagramAssetId("formula")) return <Diagram type="formula" />;
  if (asset.id === legacyDiagramAssetId("ramp")) return <Diagram type="ramp" />;
  return null;
}

function resolveSlideAssetUrl(asset: SlideAsset) {
  return asset.previewKey || asset.storageKey || asset.url;
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
  const [sourceComposer, setSourceComposer] = useState<SourceComposer>(null);
  const [sourceUploadQueue, setSourceUploadQueue] = useState<SourceUploadItem[]>([]);
  const [sourceDragActive, setSourceDragActive] = useState(false);
  const [sourceInputVersion, setSourceInputVersion] = useState(0);
  const [materialUploading, setMaterialUploading] = useState(false);
  const [materialActionId, setMaterialActionId] = useState("");
  const [materialMessage, setMaterialMessage] = useState("");
  const [confirmDeleteMaterialId, setConfirmDeleteMaterialId] = useState("");
  const [inspectMaterialId, setInspectMaterialId] = useState("");
  const [runLogOpen, setRunLogOpen] = useState(false);
  const [assetGalleryOpen, setAssetGalleryOpen] = useState(false);
  const [assetGalleryFilter, setAssetGalleryFilter] = useState<"all" | "review" | PresentationAsset["kind"]>("all");
  const [assetDetailId, setAssetDetailId] = useState("");
  const [assetActionId, setAssetActionId] = useState("");
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);
  const [engineEditorOpen, setEngineEditorOpen] = useState(false);
  const [studioPreviewDocument, setStudioPreviewDocument] = useState<SlideDocument | null>(null);
  const [contextIntent, setContextIntent] = useState<{ x: number; y: number } | null>(null);
  const [reviewFocusId, setReviewFocusId] = useState("");
  const [reviewLevel, setReviewLevel] = useState<QuestionLevel>("2.0");
  const [studioSlideIndex, setStudioSlideIndex] = useState(0);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [chatModerationId, setChatModerationId] = useState("");
  const [chatModerationMessage, setChatModerationMessage] = useState("");
  const stageFrameRef = useRef<HTMLDivElement>(null);
  const filmstripButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingStudioToolMotionRef = useRef<StudioToolMotion | null>(null);
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
    setWorkspaceTool(initialTool ?? "presentation");
    setSourceUploadQueue([]);
    setSourceDragActive(false);
    setSourceInputVersion((current) => current + 1);
    setMaterialActionId("");
    setMaterialMessage("");
    setConfirmDeleteMaterialId("");
    setInspectMaterialId("");
    setRunLogOpen(false);
    setAssetGalleryOpen(false);
    setAssetGalleryFilter("all");
    setAssetDetailId("");
    setAssetActionId("");
    setCommandMenuOpen(false);
    setEngineEditorOpen(false);
    setStudioPreviewDocument(null);
    setContextIntent(null);
    setShowCreateForm(false);
  }, [initialTool, selectedLectureId]);

  useEffect(() => {
    if (!selectedLectureId) return;
    void loadAnalytics(selectedLectureId);
  }, [selectedLectureId]);

  useEffect(() => {
    setReviewFocusId("");
  }, [selected?.id]);

  useEffect(() => {
    if (!confirmDeleteMaterialId) return;
    const timeout = window.setTimeout(() => setConfirmDeleteMaterialId(""), 3500);
    return () => window.clearTimeout(timeout);
  }, [confirmDeleteMaterialId]);

  const latestProcessingRunStatus = selected?.materialProcessingRuns?.[0]?.status;

  useEffect(() => {
    if (latestProcessingRunStatus !== "queued" && latestProcessingRunStatus !== "running") return;
    const interval = window.setInterval(async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const response = await fetch("/api/lectures");
        if (!response.ok) return;
        const payload = (await response.json()) as { lectures?: Lecture[] };
        if (payload.lectures) setLectures(payload.lectures);
      } catch {
        // Polling-Fehler bewusst ignorieren; der nächste Tick versucht es erneut.
      }
    }, 2500);
    return () => window.clearInterval(interval);
  }, [latestProcessingRunStatus]);

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

  function openStudioIntent(event: ReactMouseEvent<HTMLElement>) {
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, select, button, a, summary")) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    setContextIntent({
      x: Math.min(Math.max(event.clientX - rect.left, 18), Math.max(18, rect.width - 420)),
      y: Math.min(Math.max(event.clientY - rect.top, 18), Math.max(18, rect.height - 190))
    });
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
    if (current.slideDocument?.createdBy.mode === "import") return current;

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

  function applyAgentLecturesChange(nextLectures: Lecture[]) {
    setLectures(nextLectures);
    if (!selected) return;
    const updated = nextLectures.find((lecture) => lecture.id === selected.id);
    if (!updated) return;
    setEdit((current) => ({
      ...current,
      slides: updated.slides,
      slideDocument: updated.slideDocument
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

  function updateSourceUploadItem(id: string, patch: Partial<SourceUploadItem>) {
    setSourceUploadQueue((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function removeSourceUploadItem(id: string) {
    setSourceUploadQueue((current) => current.filter((item) => item.id !== id));
  }

  function enqueueSourceFiles(files: File[]) {
    const incoming = files.filter(Boolean);
    if (incoming.length === 0) return;
    setEditError("");
    setSourceUploadQueue((current) => [
      ...current,
      ...incoming.map((file): SourceUploadItem => {
        const tooLarge = file.size > MAX_SOURCE_UPLOAD_BYTES;
        return {
          id: crypto.randomUUID(),
          file,
          status: tooLarge ? "error" : "queued",
          error: tooLarge
            ? `"${file.name}" ist ${formatFileSize(file.size)} groß. Erlaubt sind maximal ${formatFileSize(MAX_SOURCE_UPLOAD_BYTES)}.`
            : undefined
        };
      })
    ]);
  }

  async function submitMaterial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;

    const form = event.currentTarget;
    const composerMode = sourceComposer ?? "file";
    setEditError("");
    setProcessingMessage("Quelle wird hinzugefügt.");
    setMaterialUploading(true);

    try {
      if (composerMode === "file") {
        const pendingItems = sourceUploadQueue.filter((item) => item.status === "queued");
        if (pendingItems.length === 0) {
          setProcessingMessage("");
          setEditError(
            sourceUploadQueue.length > 0
              ? "Keine hochladbare Datei in der Liste. Bitte fehlerhafte Dateien entfernen oder neue auswählen."
              : "Bitte zuerst eine Datei auswählen oder hier ablegen."
          );
          return;
        }

        let latestLectures: Lecture[] | null = null;
        let uploadedCount = 0;
        let failedCount = 0;
        for (const item of pendingItems) {
          updateSourceUploadItem(item.id, { status: "uploading", error: undefined });
          const formData = new FormData();
          formData.set("file", item.file, item.file.name);
          try {
            const response = await fetch(`/api/lectures/${selected.id}/materials`, {
              method: "POST",
              headers: csrfHeaders,
              body: formData
            });
            const payload = (await response.json()) as { lectures?: Lecture[]; error?: string };
            if (!response.ok || !payload.lectures) {
              failedCount += 1;
              updateSourceUploadItem(item.id, { status: "error", error: payload.error ?? "Upload fehlgeschlagen." });
              continue;
            }
            latestLectures = payload.lectures;
            uploadedCount += 1;
            updateSourceUploadItem(item.id, { status: "done" });
          } catch {
            failedCount += 1;
            updateSourceUploadItem(item.id, { status: "error", error: "Verbindung zum Server fehlgeschlagen." });
          }
        }

        if (latestLectures) setLectures(latestLectures);
        if (uploadedCount > 0) {
          setSourceUploadQueue((current) => current.filter((item) => item.status !== "done"));
          setSourceInputVersion((current) => current + 1);
          form.reset();
        }
        if (uploadedCount > 0 && failedCount === 0) {
          setProcessingMessage(uploadedCount === 1 ? "Quelle hinzugefügt." : `${uploadedCount} Quellen hinzugefügt.`);
        } else if (uploadedCount > 0) {
          setProcessingMessage(`${uploadedCount} Quellen hinzugefügt, ${failedCount} fehlgeschlagen.`);
          setEditError("Mindestens eine Datei konnte nicht hochgeladen werden.");
        } else {
          setProcessingMessage("");
          setEditError("Datei konnte nicht hochgeladen werden.");
        }
        return;
      }

      const formData = new FormData(form);
      const response = await fetch(`/api/lectures/${selected.id}/materials`, {
        method: "POST",
        headers: csrfHeaders,
        body: formData
      });
      const payload = (await response.json()) as { lectures?: Lecture[]; error?: string };

      if (!response.ok || !payload.lectures) {
        setProcessingMessage("");
        setEditError(payload.error ?? "Material konnte nicht hinzugefügt werden.");
        return;
      }

      setLectures(payload.lectures);
      form.reset();
      setProcessingMessage("Quelle hinzugefügt.");
    } finally {
      setMaterialUploading(false);
    }
  }

  async function deleteMaterial(materialId: string) {
    if (!selected) return;
    setMaterialActionId(materialId);
    setMaterialMessage("");
    const response = await fetch(`/api/lectures/${selected.id}/materials/${materialId}`, {
      method: "DELETE",
      headers: csrfHeaders
    });
    const payload = (await response.json()) as { lectures?: Lecture[]; error?: string };
    setMaterialActionId("");
    setConfirmDeleteMaterialId("");

    if (!response.ok || !payload.lectures) {
      setMaterialMessage(payload.error ?? "Quelle konnte nicht gelöscht werden.");
      return;
    }

    setLectures(payload.lectures);
    if (inspectMaterialId === materialId) setInspectMaterialId("");
    setMaterialMessage("Quelle gelöscht.");
  }

  async function reprocessMaterial(materialId: string, slideRange?: { from: number; to: number } | null) {
    if (!selected) return;
    setMaterialActionId(materialId);
    setMaterialMessage(slideRange === undefined
      ? "Quelle wird erneut verarbeitet."
      : slideRange
        ? `Kapitel ${slideRange.from}–${slideRange.to} wird importiert.`
        : "Gesamtes Deck wird importiert.");
    const response = await fetch(`/api/lectures/${selected.id}/materials/${materialId}/process`, {
      method: "POST",
      headers: slideRange === undefined ? csrfHeaders : csrfJsonHeaders,
      ...(slideRange === undefined ? {} : { body: JSON.stringify({ slideRange }) })
    });
    const payload = (await response.json()) as { lectures?: Lecture[]; error?: string };
    setMaterialActionId("");

    if (payload.lectures) setLectures(payload.lectures);
    if (!response.ok || !payload.lectures) {
      setMaterialMessage(payload.error ?? "Verarbeitung fehlgeschlagen.");
      return;
    }
    setMaterialMessage(slideRange ? `Kapitel ${slideRange.from}–${slideRange.to} importiert.` : "Quelle erneut verarbeitet.");
  }

  async function reviewAsset(assetId: string, review: "confirmed" | "discarded") {
    if (!selected) return;
    setAssetActionId(assetId);
    setMaterialMessage("");
    const response = await fetch(`/api/lectures/${selected.id}/assets/${assetId}`, {
      method: "PATCH",
      headers: csrfJsonHeaders,
      body: JSON.stringify({ review })
    });
    const payload = (await response.json()) as { lectures?: Lecture[]; error?: string };
    setAssetActionId("");

    if (!response.ok || !payload.lectures) {
      setMaterialMessage(payload.error ?? "Asset konnte nicht aktualisiert werden.");
      return;
    }

    setLectures(payload.lectures);
    if (review === "discarded" && assetDetailId === assetId) setAssetDetailId("");
    setMaterialMessage(review === "confirmed" ? "Asset bestätigt." : "Asset verworfen.");
  }

  async function applyImprovementDraft(draft: ImprovementDraft, source?: HTMLElement | null) {
    if (!selected) return;
    setImprovementMessage("");
    const questionTarget = document.querySelector<HTMLElement>(".studio-hotspot[aria-label='Fragen auf dieser Folie']");
    animateStudioInsightSharedElement({
      kind: draft.kind,
      label: draft.kind === "slide" ? "Folie" : draft.questionLevel ?? "Frage",
      source,
      target: draft.kind === "question" ? questionTarget ?? stageFrameRef.current : stageFrameRef.current
    });

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
  const renderImportedDeckAsStage = edit.slideDocument?.createdBy.mode === "import";
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
    setStudioPreviewDocument(null);
    setContextIntent(null);
    setStudioSlideIndex(boundedIndex);
  }

  useEffect(() => {
    const pending = pendingStudioToolMotionRef.current;
    if (!pending || pending.tool !== workspaceTool) return;

    let frame = 0;
    let attempts = 0;
    const playWhenMounted = () => {
      const target = document.querySelector<HTMLElement>(
        pending.tool === "materials" ? ".studio-slide-source-overlay" : ".studio-slide-analytics-overlay"
      );
      if (!target && attempts < 8) {
        attempts += 1;
        frame = window.requestAnimationFrame(playWhenMounted);
        return;
      }
      animateStudioToolSharedElement({
        first: pending.first,
        label: pending.label,
        target,
        tool: pending.tool
      });
      pendingStudioToolMotionRef.current = null;
    };

    frame = window.requestAnimationFrame(playWhenMounted);
    return () => window.cancelAnimationFrame(frame);
  }, [workspaceTool]);

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
    const queuedFileCount = sourceUploadQueue.filter((item) => item.status === "queued").length;
    const submitLabel = composerMode === "file"
      ? queuedFileCount > 1 ? `${queuedFileCount} Dateien hinzufügen` : "Datei hinzufügen"
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
        action={selected ? `/lecturer/actions/materials/${selected.id}` : undefined}
        method="post"
        onSubmit={submitMaterial}
      >
        <input type="hidden" name="csrfToken" value={csrfToken} />
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
            <>
              <label
                className={`source-composer-drop${sourceDragActive ? " dragover" : ""}`}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setSourceDragActive(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                  if (!sourceDragActive) setSourceDragActive(true);
                }}
                onDragLeave={(event) => {
                  if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                  setSourceDragActive(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setSourceDragActive(false);
                  enqueueSourceFiles(Array.from(event.dataTransfer.files));
                }}
              >
                <strong>{sourceDragActive ? "Dateien loslassen" : sourceUploadQueue.length > 0 ? "Weitere Dateien ablegen" : "Dateien hier ablegen"}</strong>
                <span>PowerPoint, PDF oder Audio · mehrere möglich · max. {formatFileSize(MAX_SOURCE_UPLOAD_BYTES)} pro Datei · oder klicken zum Auswählen</span>
                <input
                  name="file"
                  key={`file-${sourceInputVersion}`}
                  type="file"
                  multiple
                  accept=".ppt,.pptx,.pdf,.mp3,.wav,.m4a,.aac,.ogg,.oga,.webm,audio/*"
                  aria-label="Dateien"
                  onChange={(event) => {
                    enqueueSourceFiles(Array.from(event.target.files ?? []));
                    setSourceInputVersion((current) => current + 1);
                  }}
                  suppressHydrationWarning
                />
              </label>
              {sourceUploadQueue.length > 0 && (
                <ul className="source-upload-queue" aria-label="Upload-Warteschlange">
                  {sourceUploadQueue.map((item) => (
                    <li className="source-upload-item" data-state={item.status} key={item.id}>
                      <div className="source-upload-item-main">
                        <strong title={item.file.name}>{item.file.name}</strong>
                        <span>{formatFileSize(item.file.size)} · {formatSourceUploadStatus(item.status)}</span>
                      </div>
                      {item.status !== "uploading" && (
                        <button
                          type="button"
                          aria-label={`${item.file.name} aus der Liste entfernen`}
                          onClick={() => removeSourceUploadItem(item.id)}
                        >
                          ×
                        </button>
                      )}
                      {item.error ? <small role="alert">{item.error}</small> : null}
                    </li>
                  ))}
                </ul>
              )}
            </>
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
        {reviewMessage && <p className="form-note" aria-live="polite">{reviewMessage}</p>}
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
      <aside className="studio-context-drawer analytics studio-slide-tool-overlay studio-slide-analytics-overlay lb-enter-sheet" data-panel-origin="studio-analytics" data-state={motionState} aria-label="Auswertung direkt an der Folie">
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
                <button
                  className="primary-button"
                  disabled={topDraft.applied}
                  type="button"
                  onClick={(event) => applyImprovementDraft(topDraft, event.currentTarget.closest(".studio-insight-card") as HTMLElement | null)}
                >
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

  function openWorkspaceTool(tool: WorkspaceTool, source?: HTMLElement | null) {
    if (
      source &&
      workspaceTool !== tool &&
      (tool === "materials" || tool === "analytics")
    ) {
      const activeTool = workspaceTools.find((item) => item.value === tool);
      pendingStudioToolMotionRef.current = {
        tool,
        first: source.getBoundingClientRect(),
        label: activeTool?.shortLabel ?? activeTool?.label ?? tool
      };
    }
    setCommandMenuOpen(false);
    setShowCreateForm(false);
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

  function renderStudioAssetRail() {
    const lastRun = selected.materialProcessingRuns?.[0];
    const runActive = lastRun?.status === "queued" || lastRun?.status === "running";
    const materials = selected.materials ?? [];
    const presentationAssets = selected.presentationAssets ?? [];
    const visiblePresentationAssets = [...presentationAssets].sort((left, right) => (
      Number(Boolean(presentationAssetPreviewUrl(right))) - Number(Boolean(presentationAssetPreviewUrl(left)))
    ));
    const reviewAssetCount = presentationAssets.filter((asset) => asset.quality.needsReview).length;
    const materialLabel = materials.length === 1 ? "1 Quelle" : `${materials.length} Quellen`;
    const assetLabel = presentationAssets.length === 1 ? "1 Asset" : `${presentationAssets.length} Assets`;

    return (
      <aside className={`studio-asset-rail ${workspaceTool === "materials" ? "active" : ""}`} aria-label="Quellen und Assets">
        <header className="studio-asset-rail-head">
          <div>
            <span>Quellen</span>
            <strong>{materialLabel} · {assetLabel}</strong>
          </div>
          <button
            className="plain-button small"
            disabled={processingLectureId === selected.id || materialUploading || materials.length === 0}
            onClick={processMaterials}
            type="button"
          >
            {processingLectureId === selected.id ? "Läuft" : "Verarbeiten"}
          </button>
        </header>

        {renderSourceComposer("inline")}
        {editError && workspaceTool === "materials" ? <p role="alert" className="form-error">{editError}</p> : null}
        {processingMessage ? <p className="form-note">{processingMessage}</p> : null}
        {materialMessage ? <p className="form-note" aria-live="polite">{materialMessage}</p> : null}

        {lastRun ? (
          <button
            className="studio-asset-run-status"
            type="button"
            onClick={() => setRunLogOpen(true)}
            aria-label={`Protokoll der letzten Materialverarbeitung öffnen: ${formatRunStatus(lastRun.status)}`}
          >
            <strong>{formatRunStatus(lastRun.status)}</strong>
            <span>{lastRun.materialCount === 1 ? "1 Material" : `${lastRun.materialCount} Materialien`} · {lastRun.chunkCount === 1 ? "1 Chunk" : `${lastRun.chunkCount} Chunks`} · Protokoll</span>
            {formatVisibleRunMessage(lastRun) ? <small>{formatVisibleRunMessage(lastRun)}</small> : null}
          </button>
        ) : null}

        <section className="studio-asset-library" aria-label="Extrahierte Assets">
          <div className="studio-asset-library-head">
            <strong>Assets</strong>
            <button
              className="studio-asset-gallery-toggle"
              type="button"
              onClick={() => {
                setAssetDetailId("");
                setAssetGalleryFilter("all");
                setAssetGalleryOpen(true);
              }}
            >
              Alle anzeigen ({presentationAssets.length})
            </button>
          </div>
          {reviewAssetCount > 0 ? (
            <button
              className="studio-asset-review-hint"
              type="button"
              onClick={() => {
                setAssetDetailId("");
                setAssetGalleryFilter("review");
                setAssetGalleryOpen(true);
              }}
            >
              {reviewAssetCount} {reviewAssetCount === 1 ? "Asset braucht" : "Assets brauchen"} Prüfung
            </button>
          ) : null}
          {presentationAssets.length === 0 ? (
            <p className="muted">PowerPoint, PDF, Audio, URLs oder Notizen hinzufügen. Die KI extrahiert daraus Text, Abbildungen, Tabellen, Formeln und Folienbausteine.</p>
          ) : (
            <div className="studio-asset-list compact">
              {visiblePresentationAssets.slice(0, 8).map((asset) => {
                const previewUrl = presentationAssetPreviewUrl(asset);
                return (
                  <article
                    className={`studio-asset-card clickable${previewUrl ? " has-preview" : ""}`}
                    key={asset.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setAssetDetailId(asset.id);
                      setAssetGalleryOpen(true);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      setAssetDetailId(asset.id);
                      setAssetGalleryOpen(true);
                    }}
                  >
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

        <section className="studio-source-list compact" aria-label="Importierte Quellen">
          {materials.length === 0 ? (
            <p className="muted">Noch keine Quelle importiert.</p>
          ) : (
            materials.map((material) => {
              const busy = materialActionId === material.id;
              return (
                <div className="studio-source-chip managed" data-status={material.status} key={material.id}>
                  <button
                    className="studio-source-chip-main"
                    type="button"
                    title={`${material.originalName} im Detail anzeigen`}
                    aria-label={`Details zu ${material.originalName}`}
                    onClick={() => setInspectMaterialId(material.id)}
                  >
                    <strong>{material.originalName}</strong>
                    <small>{material.kind} · {formatMaterialStatus(material, runActive)}</small>
                  </button>
                  <div className="studio-source-chip-actions">
                    <button
                      type="button"
                      disabled={busy || runActive || material.kind === "audio"}
                      title="Erneut verarbeiten"
                      aria-label={`${material.originalName} erneut verarbeiten`}
                      onClick={() => reprocessMaterial(material.id)}
                    >
                      ↻
                    </button>
                    {confirmDeleteMaterialId === material.id ? (
                      <button
                        className="danger"
                        type="button"
                        disabled={busy}
                        title="Löschen bestätigen"
                        aria-label={`${material.originalName} wirklich löschen`}
                        onClick={() => deleteMaterial(material.id)}
                      >
                        Sicher?
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        title="Quelle löschen"
                        aria-label={`${material.originalName} löschen`}
                        onClick={() => setConfirmDeleteMaterialId(material.id)}
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </section>

        <section className="studio-filmstrip-list studio-asset-slide-list" aria-label="Folie auswählen">
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
        </section>
      </aside>
    );
  }

  function renderRunLogSheet(motionState: PresenceState) {
    const run = selected.materialProcessingRuns?.[0];

    return (
      <aside className="studio-context-drawer materials studio-slide-tool-overlay studio-sheet-side lb-enter-sheet" data-state={motionState} aria-label="Protokoll der Materialverarbeitung">
        <button className="studio-panel-close" type="button" onClick={() => setRunLogOpen(false)} aria-label="Protokoll schließen">×</button>
        <header className="slide-overlay-head">
          <div>
            <strong>Verarbeitung</strong>
            <span>{run ? `${formatRunStatus(run.status)} · ${run.materialCount === 1 ? "1 Material" : `${run.materialCount} Materialien`} · ${run.chunkCount === 1 ? "1 Chunk" : `${run.chunkCount} Chunks`}` : "Noch kein Lauf"}</span>
          </div>
        </header>

        {run ? (
          <>
            {formatVisibleRunMessage(run) ? <p className="form-note">{formatVisibleRunMessage(run)}</p> : null}
            <ol className="studio-run-steps" aria-label="Schritte der Verarbeitung">
              {run.steps.map((step, index) => (
                <li
                  className="studio-run-step lb-enter-row"
                  data-status={step.status}
                  key={`${step.at}-${index}`}
                  style={{ "--lb-i": Math.min(index, 10) } as MotionStyle}
                >
                  <span aria-hidden="true">
                    {step.status === "done" ? "✓" : step.status === "failed" ? "!" : step.status === "skipped" ? "–" : "…"}
                  </span>
                  <div>
                    <strong>{step.label}</strong>
                    <small>{formatRunStepStatus(step.status)}{step.detail ? ` · ${step.detail}` : ""}</small>
                  </div>
                </li>
              ))}
            </ol>
            <p className="muted">
              Gestartet {formatExportTime(run.startedAt)}
              {run.completedAt ? ` · beendet ${formatExportTime(run.completedAt)}` : ""}
            </p>
          </>
        ) : (
          <p className="muted">Noch keine Verarbeitung gestartet.</p>
        )}
      </aside>
    );
  }

  function renderMaterialSheet(motionState: PresenceState) {
    const lastRun = selected.materialProcessingRuns?.[0];
    const runActive = lastRun?.status === "queued" || lastRun?.status === "running";
    const material = (selected.materials ?? []).find((item) => item.id === inspectMaterialId);
    const materialAssets = material
      ? (selected.presentationAssets ?? []).filter((asset) => asset.source.materialId === material.id)
      : [];

    return (
      <aside className="studio-context-drawer materials studio-slide-tool-overlay studio-sheet-side lb-enter-sheet" data-state={motionState} aria-label="Quelle im Detail">
        <button className="studio-panel-close" type="button" onClick={() => setInspectMaterialId("")} aria-label="Quellendetails schließen">×</button>
        <header className="slide-overlay-head">
          <div>
            <strong>{material?.originalName ?? "Quelle"}</strong>
            <span>{material ? `${material.kind} · ${formatMaterialStatus(material, runActive)}` : "Nicht mehr vorhanden"}</span>
          </div>
        </header>

        {material ? (
          <div className="studio-material-detail">
            <dl>
              <div><dt>Status</dt><dd>{formatMaterialStatus(material, runActive)}</dd></div>
              <div><dt>Typ</dt><dd>{material.kind}</dd></div>
              {material.sizeBytes ? <div><dt>Größe</dt><dd>{formatFileSize(material.sizeBytes)}</dd></div> : null}
              <div><dt>Chunks</dt><dd>{material.chunkCount ?? 0}</dd></div>
              <div><dt>Assets</dt><dd>{materialAssets.length}</dd></div>
              <div><dt>Hinzugefügt</dt><dd>{formatExportTime(material.createdAt)}</dd></div>
            </dl>

            {material.extractedTextPreview ? (
              <section>
                <strong>Textvorschau</strong>
                <p>{material.extractedTextPreview}</p>
              </section>
            ) : (
              <p className="muted">Noch kein Text extrahiert. Nach der Verarbeitung erscheint hier eine Vorschau.</p>
            )}

            {materialAssets.length > 0 && (
              <section>
                <strong>Erzeugte Assets</strong>
                <div className="studio-material-assets">
                  {materialAssets.map((asset) => (
                    <button
                      key={asset.id}
                      type="button"
                      onClick={() => {
                        setAssetDetailId(asset.id);
                        setAssetGalleryOpen(true);
                      }}
                    >
                      <span>{formatPresentationAssetKind(asset.kind)}</span>
                      <strong>{asset.title}</strong>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {material.kind === "pptx" && (
              <section className="studio-material-range">
                <strong>Kapitel-Import</strong>
                <p className="muted">
                  {selected.slideDocument?.slides.length
                    ? `Aktuell importiert: ${selected.slideDocument.slides.length} Folien. `
                    : "Noch kein Deck importiert. "}
                  Von und Bis beziehen sich auf die Originalfolien der PPTX.
                </p>
                <form
                  key={`${material.id}-${material.slideRange?.from ?? "all"}-${material.slideRange?.to ?? "all"}`}
                  onSubmit={(event) => {
                    event.preventDefault();
                    const data = new FormData(event.currentTarget);
                    void reprocessMaterial(material.id, {
                      from: Number(data.get("from")),
                      to: Number(data.get("to"))
                    });
                  }}
                >
                  <label>
                    <span>Von</span>
                    <input name="from" type="number" min="1" step="1" required defaultValue={material.slideRange?.from ?? 1} />
                  </label>
                  <label>
                    <span>Bis</span>
                    <input name="to" type="number" min="1" step="1" required defaultValue={material.slideRange?.to ?? selected.slideDocument?.slides.length ?? 1} />
                  </label>
                  <button className="primary-button" type="submit" disabled={materialActionId === material.id || runActive}>
                    {materialActionId === material.id ? "Import läuft" : "Bereich importieren"}
                  </button>
                </form>
                {material.slideRange ? (
                  <button
                    className="plain-button small"
                    type="button"
                    disabled={materialActionId === material.id || runActive}
                    onClick={() => reprocessMaterial(material.id, null)}
                  >
                    Gesamtes Deck importieren
                  </button>
                ) : null}
              </section>
            )}

            <div className="studio-overlay-actions" aria-label="Quellenaktionen">
              <button
                className="primary-button"
                type="button"
                disabled={materialActionId === material.id || runActive || material.kind === "audio"}
                onClick={() => reprocessMaterial(material.id)}
              >
                {materialActionId === material.id ? "Läuft" : "Erneut verarbeiten"}
              </button>
              {confirmDeleteMaterialId === material.id ? (
                <button
                  className="plain-button danger"
                  type="button"
                  disabled={materialActionId === material.id}
                  onClick={() => deleteMaterial(material.id)}
                >
                  Wirklich löschen?
                </button>
              ) : (
                <button
                  className="plain-button"
                  type="button"
                  onClick={() => setConfirmDeleteMaterialId(material.id)}
                >
                  Löschen
                </button>
              )}
            </div>
          </div>
        ) : (
          <p className="muted">Diese Quelle wurde entfernt.</p>
        )}
      </aside>
    );
  }

  function renderAssetGallerySheet(motionState: PresenceState) {
    const assets = selected.presentationAssets ?? [];
    const detailAsset = assets.find((asset) => asset.id === assetDetailId);
    const assetKinds = [...new Set(assets.map((asset) => asset.kind))];
    const reviewCount = assets.filter((asset) => asset.quality.needsReview).length;
    const filteredAssets = assets.filter((asset) => {
      if (assetGalleryFilter === "all") return true;
      if (assetGalleryFilter === "review") return asset.quality.needsReview;
      return asset.kind === assetGalleryFilter;
    });

    if (assetDetailId) {
      const previewUrl = detailAsset ? presentationAssetPreviewUrl(detailAsset) : "";
      const sourceLocation = detailAsset?.source.page !== undefined
        ? `Seite ${detailAsset.source.page}`
        : detailAsset?.source.slide !== undefined
          ? `Folie ${detailAsset.source.slide}`
          : detailAsset?.source.sourceRef ?? "";

      return (
        <aside className="studio-context-drawer materials studio-slide-tool-overlay studio-sheet-side lb-enter-sheet" data-state={motionState} aria-label="Asset im Detail">
          <button className="studio-panel-close" type="button" onClick={() => setAssetDetailId("")} aria-label="Zurück zur Galerie">×</button>
          <header className="slide-overlay-head">
            <div>
              <strong>{detailAsset?.title ?? "Asset"}</strong>
              <span>{detailAsset ? `${formatPresentationAssetKind(detailAsset.kind)} · ${formatPresentationAssetQuality(detailAsset)}` : "Nicht mehr vorhanden"}</span>
            </div>
          </header>

          {detailAsset ? (
            <div className="studio-asset-detail">
              {previewUrl ? (
                <span className="studio-asset-detail-preview" style={{ backgroundImage: `url("${previewUrl}")` }} role="img" aria-label={`Vorschau: ${detailAsset.title}`} />
              ) : null}
              <dl>
                <div><dt>Art</dt><dd>{formatPresentationAssetKind(detailAsset.kind)}</dd></div>
                <div><dt>Quelle</dt><dd>{detailAsset.source.originalName}</dd></div>
                {sourceLocation ? <div><dt>Fundstelle</dt><dd>{sourceLocation}</dd></div> : null}
                {typeof detailAsset.quality.extractionConfidence === "number" ? (
                  <div><dt>Sicherheit</dt><dd>{Math.round(detailAsset.quality.extractionConfidence * 100)}%</dd></div>
                ) : null}
                <div><dt>Erstellt</dt><dd>{formatExportTime(detailAsset.createdAt)}</dd></div>
              </dl>

              {detailAsset.description ? <p className="muted">{detailAsset.description}</p> : null}
              {detailAsset.quality.reason ? <p className="form-note">Prüfhinweis: {detailAsset.quality.reason}</p> : null}

              {detailAsset.extractedText ? (
                <section>
                  <strong>Extrahierter Text</strong>
                  <p className="studio-asset-detail-text">{detailAsset.extractedText}</p>
                </section>
              ) : null}

              {detailAsset.quality.needsReview ? (
                <div className="studio-overlay-actions" aria-label="Asset prüfen">
                  <button
                    className="primary-button"
                    type="button"
                    disabled={assetActionId === detailAsset.id}
                    onClick={() => reviewAsset(detailAsset.id, "confirmed")}
                  >
                    Bestätigen
                  </button>
                  <button
                    className="plain-button"
                    type="button"
                    disabled={assetActionId === detailAsset.id}
                    onClick={() => reviewAsset(detailAsset.id, "discarded")}
                  >
                    Verwerfen
                  </button>
                </div>
              ) : (
                <p className="muted">Asset ist bestätigt.</p>
              )}
            </div>
          ) : (
            <p className="muted">Dieses Asset wurde entfernt.</p>
          )}
        </aside>
      );
    }

    return (
      <aside className="studio-context-drawer materials studio-slide-tool-overlay studio-sheet-side lb-enter-sheet" data-state={motionState} aria-label="Asset-Galerie">
        <button className="studio-panel-close" type="button" onClick={() => setAssetGalleryOpen(false)} aria-label="Galerie schließen">×</button>
        <header className="slide-overlay-head">
          <div>
            <strong>Assets</strong>
            <span>{assets.length} extrahiert · {reviewCount} zur Prüfung</span>
          </div>
        </header>

        <div className="studio-level-rail studio-gallery-filters" aria-label="Assets filtern">
          <button aria-pressed={assetGalleryFilter === "all"} type="button" onClick={() => setAssetGalleryFilter("all")}>
            Alle
          </button>
          <button aria-pressed={assetGalleryFilter === "review"} type="button" onClick={() => setAssetGalleryFilter("review")}>
            Prüfung nötig
          </button>
          {assetKinds.map((kind) => (
            <button
              aria-pressed={assetGalleryFilter === kind}
              key={kind}
              type="button"
              onClick={() => setAssetGalleryFilter(kind)}
            >
              {formatPresentationAssetKind(kind)}
            </button>
          ))}
        </div>

        {filteredAssets.length === 0 ? (
          <p className="muted">Keine Assets für diesen Filter.</p>
        ) : (
          <div className="studio-gallery-grid">
            {filteredAssets.map((asset, index) => {
              const previewUrl = presentationAssetPreviewUrl(asset);
              return (
                <article
                  className={`studio-asset-card${previewUrl ? " has-preview" : ""} lb-enter-row`}
                  key={asset.id}
                  style={{ "--lb-i": Math.min(index, 8) } as MotionStyle}
                >
                  {previewUrl && (
                    <span className="studio-asset-thumb" style={{ backgroundImage: `url("${previewUrl}")` }} aria-hidden="true" />
                  )}
                  <header>
                    <span>{formatPresentationAssetKind(asset.kind)}</span>
                    <small data-review={asset.quality.needsReview ? "true" : "false"}>{formatPresentationAssetQuality(asset)}</small>
                  </header>
                  <button className="studio-asset-open" type="button" onClick={() => setAssetDetailId(asset.id)}>
                    <strong>{asset.title}</strong>
                    <span>{assetPreview(asset)}</span>
                  </button>
                  <footer>
                    <span>{asset.source.originalName}</span>
                    {asset.source.sourceRef && <span>{asset.source.sourceRef}</span>}
                  </footer>
                  {asset.quality.needsReview && (
                    <div className="studio-asset-review-actions" aria-label={`${asset.title} prüfen`}>
                      <button
                        className="primary-button small"
                        type="button"
                        disabled={assetActionId === asset.id}
                        onClick={() => reviewAsset(asset.id, "confirmed")}
                      >
                        Bestätigen
                      </button>
                      <button
                        className="plain-button small"
                        type="button"
                        disabled={assetActionId === asset.id}
                        onClick={() => reviewAsset(asset.id, "discarded")}
                      >
                        Verwerfen
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </aside>
    );
  }

  function renderStudioManualToolbar() {
    return (
      <div className="studio-manual-toolbar lb-enter-control" aria-label="Manuelle Folienwerkzeuge">
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
        <button
          aria-label={engineEditorOpen ? "Direktbearbeitung schließen" : "Folie direkt bearbeiten"}
          aria-pressed={engineEditorOpen}
          className="plain-button studio-engine-toggle"
          title={engineEditorOpen ? "Direktbearbeitung schließen" : "Folie direkt bearbeiten"}
          type="button"
          onClick={() => setEngineEditorOpen((open) => !open)}
        >
          ✎
        </button>
        <button className="primary-button studio-save-inline" type="button" onClick={persistLectureEdits}>Speichern</button>
        {workspaceTool === "presentation" && editError && <p role="alert" className="form-error deck-error">{editError}</p>}
      </div>
    );
  }

  function renderStudioLearningRail() {
    const questionCount = reviews.length || selected.questions.length;
    const analyticsCount = analytics?.participants ?? selected.studentChatQuestions?.length ?? 0;
    const items: Array<{ tool: WorkspaceTool; icon: string; label: string; count?: string }> = [
      { tool: "questions", icon: "question", label: "Lernfragen", count: String(questionCount) },
      { tool: "analytics", icon: "analytics", label: "Lernsignale", count: analyticsCount > 0 ? String(analyticsCount) : undefined },
      { tool: "evaluation", icon: "eval", label: "Evaluation", count: edit.evaluationConfig?.enabled === false ? "aus" : undefined }
    ];

    return (
      <aside className="studio-learning-rail" aria-label="Lernwerkzeuge">
        {items.map((item, index) => (
          <button
            aria-label={item.label}
            aria-pressed={workspaceTool === item.tool}
            className={`studio-hotspot lb-enter-hotspot ${workspaceTool === item.tool ? "active" : ""}`}
            key={item.tool}
            style={{ "--lb-i": index } as MotionStyle}
            title={item.label}
            type="button"
            onClick={(event) => openWorkspaceTool(item.tool, event.currentTarget)}
          >
            <span className={`lb-icon lb-icon-${item.icon}`} aria-hidden="true" />
            {item.count ? <small>{item.count}</small> : null}
          </button>
        ))}
      </aside>
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
          {renderStudioAssetRail()}
          {!showCreateForm && renderStudioLearningRail()}

          <section
            className={`studio-slide-stage ${workspaceTool === "questions" ? "question-active" : ""}`}
            aria-label="Präsentation bearbeiten"
            onContextMenu={openStudioIntent}
          >
            {!showCreateForm && renderStudioManualToolbar()}
            <div className="studio-slide-shell">
              {showCreateForm ? (
                <div className="slide-preview-frame editable-slide-frame studio-editor-frame studio-create-stage" role="dialog" aria-label="Neue Vorlesung als Folie anlegen">
                  {renderCreateLectureForm("stage")}
                </div>
              ) : studioSlide ? (
                <>
                  {renderImportedDeckAsStage && edit.slideDocument ? (
                    <div className="slide-preview-frame editable-slide-frame studio-editor-frame studio-engine-primary-frame" ref={stageFrameRef}>
                      <DeckRenderer
                        className="studio-engine-primary-deck"
                        currentSlideId={studioSlide.id}
                        document={studioPreviewDocument ?? edit.slideDocument}
                        renderAsset={renderLegacyDiagramAsset}
                        renderMode="current"
                        resolveAssetUrl={resolveSlideAssetUrl}
                      />
                    </div>
                  ) : (
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
                  )}
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
                      csrfToken={csrfToken}
                      currentIndex={activeStudioSlideIndex}
                      lectureId={selected.id}
                      presentationAssets={selected.presentationAssets}
                      seriesTitle={edit.seriesTitle}
                      slideDocument={edit.slideDocument}
                      slides={studioSlides}
                      onLecturesChange={applyAgentLecturesChange}
                      onSlideDocumentChange={updateSlideDocumentFromEngine}
                    />
                  )}
                </>
              ) : (
                <div className="workspace-empty-inline">Noch keine Folien vorhanden.</div>
              )}
            </div>
            <Presence show={runLogOpen}>
              {(motionState) => renderRunLogSheet(motionState)}
            </Presence>
            <Presence show={Boolean(inspectMaterialId)}>
              {(motionState) => renderMaterialSheet(motionState)}
            </Presence>
            <Presence show={assetGalleryOpen}>
              {(motionState) => renderAssetGallerySheet(motionState)}
            </Presence>
            {!showCreateForm && studioSlide && selected && !engineEditorOpen ? (
              <StudioIntentComposer
                className="studio-intent-dock"
                contextLabel={`Folie ${activeStudioSlideIndex + 1}`}
                csrfToken={csrfToken}
                lectureId={selected.id}
                onDocumentAccepted={(document, lecture) => updateSlideDocumentFromEngine(document, lecture.slides)}
                onLecturesChange={applyAgentLecturesChange}
                onPreviewDocumentChange={setStudioPreviewDocument}
                slideId={studioSlide.id}
              />
            ) : null}

            {contextIntent && studioSlide && selected ? (
              <div
                aria-label={`Folie ${activeStudioSlideIndex + 1} ändern`}
                className="studio-intent-popover lb-enter-panel"
                role="dialog"
                style={{ left: contextIntent.x, top: contextIntent.y }}
              >
                <StudioIntentComposer
                  autoFocus
                  contextLabel={`Folie ${activeStudioSlideIndex + 1}`}
                  csrfToken={csrfToken}
                  lectureId={selected.id}
                  onDismiss={() => setContextIntent(null)}
                  onDocumentAccepted={(document, lecture) => updateSlideDocumentFromEngine(document, lecture.slides)}
                  onLecturesChange={applyAgentLecturesChange}
                  onPreviewDocumentChange={setStudioPreviewDocument}
                  slideId={studioSlide.id}
                />
              </div>
            ) : null}

          </section>
        </section>
      </main>
    );
}
