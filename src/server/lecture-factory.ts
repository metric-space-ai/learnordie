import crypto from "node:crypto";

import { demoLecture } from "@/lib/demo-data";
import type {
  Lecture,
  LectureMaterial,
  QuestionReviewItem,
  QuestionVariant,
  Slide,
  StudentChatQuestion,
  TranscriptSegment
} from "@/lib/types";
import { createGenerationHistory, withPromptRegistry } from "./question-review-metadata";

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// Canonical slug lives in `@/lib/series` so client and server agree on series ids.
export { seriesIdFromTitle as slugify } from "@/lib/series";

export function normalizeExamDate(value: string | Date | null | undefined) {
  if (!value) return "2026-07-24";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

export function aiAccessUntilFromExamDate(examDate: string) {
  return `${normalizeExamDate(examDate)}T21:59:59.999Z`;
}

export function levelPoints(level: QuestionVariant["level"]) {
  return ({ "4.0": 1, "3.0": 2, "2.0": 3, "1.0": 4 } as const)[level];
}

export type QuestionGenerationMetadata = {
  promptVersion?: string;
  model?: string;
};

function learningObjectiveForLevel(level: QuestionVariant["level"]) {
  return ({
    "4.0": "Begriff und Zuordnung sicher erkennen.",
    "3.0": "Bekannte Anwendungssituation einordnen.",
    "2.0": "Ursache, Wirkung und Auslegungsentscheidung erklären.",
    "1.0": "Konzept auf einen neuen technischen Fall übertragen."
  } as const)[level];
}

export function withVariantMetadata(
  variant: QuestionVariant,
  material: LectureMaterial,
  metadata: QuestionGenerationMetadata = {}
): QuestionVariant {
  const promptVersion = metadata.promptVersion ?? "local-material-v1";
  const sourceRef = material.sourceRefs?.[0] ?? material.originalName;
  const learningObjective = learningObjectiveForLevel(variant.level);
  return withPromptRegistry({
    sourceTitle: material.originalName,
    promptVersion,
    learningObjective,
    model: metadata.model,
    variant: {
      ...variant,
      promptVersion,
      sourceRef,
      learningObjective,
      reviewStatus: "draft",
      reviewerComment: "",
      promptHistory: [createGenerationHistory({
        variant,
        sourceTitle: material.originalName,
        sourceRef,
        promptVersion,
        learningObjective,
        model: metadata.model
      })]
    }
  });
}

function inferMaterialConcept(lecture: Lecture, material: LectureMaterial) {
  const context = `${material.extractedTextPreview ?? ""} ${material.originalName} ${lecture.title}`.toLowerCase();
  if (context.includes("stribeck")) return "Stribeck-Kurve";
  if (context.includes("mischreibung")) return "Mischreibung";
  if (context.includes("viskos")) return "Viskosität";
  if (context.includes("schmierfilm")) return "Schmierfilmaufbau";
  if (context.includes("anlauf") || context.includes("anfahren")) return "Anlaufphase";
  if (context.includes("gleitlager")) return "Gleitlagerung";
  return lecture.title;
}

function inferMaterialScenario(concept: string) {
  if (concept === "Mischreibung") return "Eine schwer belastete Welle läuft häufig langsam an und zeigt erhöhten Verschleiß.";
  if (concept === "Stribeck-Kurve") return "Bei einer Maschine ändert sich die Drehzahl, während Last und Schmierstoff zunächst gleich bleiben.";
  if (concept === "Viskosität") return "Ein Lager erreicht seine Betriebstemperatur und der Schmierstoff wird dünnflüssiger.";
  if (concept === "Schmierfilmaufbau") return "Ein Lager soll nach dem Start möglichst schnell vom Festkörperkontakt in tragende Schmierung wechseln.";
  return "Eine Maschine zeigt im Betrieb ein Lagerproblem, das nicht nur durch Auswendiglernen lösbar ist.";
}

export function createDefaultSlides(title: string): Slide[] {
  return clone(demoLecture.slides).map((slide, index) => ({
    ...slide,
    id: crypto.randomUUID(),
    eyebrow: `Folie ${index + 1}`,
    title: index === 0 ? title : slide.title
  }));
}

export function generateReviewVariants(
  lecture: Lecture,
  material: LectureMaterial,
  metadata: QuestionGenerationMetadata = {}
): QuestionVariant[] {
  const topic = lecture.title;
  const source = material.originalName.replace(/^https?:\/\//, "");
  const concept = inferMaterialConcept(lecture, material);
  const scenario = inferMaterialScenario(concept);
  const preview = material.extractedTextPreview
    ? ` Auszug: ${material.extractedTextPreview}`
    : "";
  const context =
    material.originalName.startsWith("Chatfrage")
      ? "Studierendenfrage"
      : material.originalName.startsWith("Transkript")
        ? "Live-Transkript"
      : material.source === "url"
      ? "externe Quelle"
      : material.source === "notes"
        ? "Planungsnotiz"
        : "hochgeladenes Material";

  const variants: QuestionVariant[] = [
    {
      level: "4.0",
      points: levelPoints("4.0"),
      text: `Welcher Begriff aus ${source} beschreibt den zentralen Inhalt zu ${topic}?`,
      explanation: `Diese Variante prüft, ob der zentrale Begriff aus dem ${context} richtig zugeordnet wird.${preview}`,
      answers: [
        { key: "A", text: concept, correct: true },
        { key: "B", text: "Werkstofffarbe", correct: false },
        { key: "C", text: "Verpackungsgröße", correct: false },
        { key: "D", text: "Prüfungsraum", correct: false }
      ]
    },
    {
      level: "3.0",
      points: levelPoints("3.0"),
      text: `In welcher bekannten Betriebssituation wird ${concept} aus ${source} besonders relevant?`,
      explanation: "Diese Variante prüft Anwendung im bekannten Kontext der Vorlesung.",
      answers: [
        { key: "A", text: "Anlaufphase, Lastwechsel oder geringe Relativgeschwindigkeit betrachten.", correct: true },
        { key: "B", text: "Die Belastung vollständig ignorieren.", correct: false },
        { key: "C", text: "Schmierstoff grundsätzlich entfernen.", correct: false },
        { key: "D", text: "Nur die Foliennummer auswendig lernen.", correct: false }
      ]
    },
    {
      level: "2.0",
      points: levelPoints("2.0"),
      text: `Warum ist ${concept} für die Auslegung eines Gleitlagers relevant?`,
      explanation: "Diese Variante prüft, ob Ursache, Wirkung und Auslegungsentscheidung verbunden werden.",
      answers: [
        { key: "A", text: "Weil Last, Drehzahl und Schmierung gemeinsam den Betriebszustand bestimmen.", correct: true },
        { key: "B", text: "Weil der Betriebszustand unabhängig vom Schmierfilm ist.", correct: false },
        { key: "C", text: "Weil jede Lagerung ohne Reibung arbeitet.", correct: false },
        { key: "D", text: "Weil Materialquellen keine technischen Aussagen enthalten.", correct: false }
      ]
    },
    {
      level: "1.0",
      points: levelPoints("1.0"),
      text: `${scenario} Welche Maßnahme leitest du aus ${source} ab?`,
      explanation: "Diese Transferfrage verlangt, das Material auf einen neuen technischen Fall zu übertragen.",
      answers: [
        { key: "A", text: "Startphase entlasten oder zusätzliche Schmierung vorsehen.", correct: true },
        { key: "B", text: "Nur die Beschriftung der Zeichnung ändern.", correct: false },
        { key: "C", text: "Den Schmierstoff entfernen.", correct: false },
        { key: "D", text: "Die Prüfung des Lagerspiels dauerhaft aussetzen.", correct: false }
      ]
    }
  ];

  return variants.map((variant) => withVariantMetadata(variant, material, metadata));
}

export function createReviewItem(lecture: Lecture, material: LectureMaterial): QuestionReviewItem {
  return {
    id: `review_${crypto.randomUUID()}`,
    lectureId: lecture.id,
    sourceMaterialId: material.id,
    sourceTitle: material.originalName,
    status: "draft",
    variants: generateReviewVariants(lecture, material),
    createdAt: new Date().toISOString()
  };
}

export function createReviewItemFromChatQuestion(lecture: Lecture, chatQuestion: StudentChatQuestion): QuestionReviewItem {
  const sourceTitle = `Chatfrage: ${chatQuestion.text.slice(0, 64)}${chatQuestion.text.length > 64 ? "..." : ""}`;
  const virtualMaterial: LectureMaterial = {
    id: chatQuestion.id,
    lectureId: lecture.id,
    kind: "other",
    source: "notes",
    originalName: sourceTitle,
    storageUrl: `chat-question://${chatQuestion.id}`,
    status: "ready",
    chunkCount: 1,
    extractedTextPreview: chatQuestion.text,
    sourceRefs: [`Chatfrage ${chatQuestion.id}`],
    createdAt: chatQuestion.createdAt
  };

  return {
    id: `review_${crypto.randomUUID()}`,
    lectureId: lecture.id,
    sourceTitle,
    status: "draft",
    variants: generateReviewVariants(lecture, virtualMaterial),
    createdAt: new Date().toISOString()
  };
}

export function createReviewItemFromTranscriptSegment(lecture: Lecture, transcriptSegment: TranscriptSegment): QuestionReviewItem {
  const sourceTitle = `Transkript: ${transcriptSegment.text.slice(0, 64)}${transcriptSegment.text.length > 64 ? "..." : ""}`;
  const virtualMaterial: LectureMaterial = {
    id: transcriptSegment.id,
    lectureId: lecture.id,
    kind: "other",
    source: "notes",
    originalName: sourceTitle,
    storageUrl: `transcript://${transcriptSegment.id}`,
    status: "ready",
    chunkCount: 1,
    extractedTextPreview: transcriptSegment.text,
    sourceRefs: [`Transkript ${transcriptSegment.id}`],
    createdAt: transcriptSegment.createdAt
  };

  return {
    id: `review_${crypto.randomUUID()}`,
    lectureId: lecture.id,
    sourceTitle,
    status: "draft",
    variants: generateReviewVariants(lecture, virtualMaterial),
    createdAt: new Date().toISOString()
  };
}

export function createLecturerAssistantReviewMaterial(lecture: Lecture, input: { slideId?: string; message?: string }) {
  const slide = lecture.slides.find((item) => item.id === input.slideId) ?? lecture.slides[0];
  const sourceTitle = `Assistent: ${slide?.title ?? lecture.title}`;
  const preview = [
    slide?.title,
    slide?.topic,
    ...(slide?.copy ?? []),
    input.message
  ].filter(Boolean).join(" ");
  const virtualMaterial: LectureMaterial = {
    id: input.slideId ?? lecture.id,
    lectureId: lecture.id,
    kind: "other",
    source: "notes",
    originalName: sourceTitle,
    storageUrl: `assistant://${lecture.id}/${input.slideId ?? "deck"}`,
    status: "ready",
    chunkCount: 1,
    extractedTextPreview: preview,
    sourceRefs: [slide ? `${slide.eyebrow}: ${slide.title}` : lecture.title],
    createdAt: new Date().toISOString()
  };

  return { slide, sourceTitle, material: virtualMaterial };
}

export function createReviewItemFromLecturerAssistant(
  lecture: Lecture,
  input: { slideId?: string; message?: string; variants?: QuestionVariant[] }
): QuestionReviewItem {
  const { sourceTitle, material } = createLecturerAssistantReviewMaterial(lecture, input);

  return {
    id: `review_${crypto.randomUUID()}`,
    lectureId: lecture.id,
    sourceTitle,
    status: "draft",
    variants: input.variants ?? generateReviewVariants(lecture, material),
    createdAt: new Date().toISOString()
  };
}
