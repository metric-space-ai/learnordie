import type { Lecture, LectureMaterial, QuestionLevel, QuestionVariant, AnswerOption } from "@/lib/types";
import type { MaterialChunk } from "./material-pipeline";
import { generateReviewVariants, levelPoints, withVariantMetadata } from "./lecture-factory";
import { getAIProvider } from "./providers/ai";

const LEVELS: QuestionLevel[] = ["4.0", "3.0", "2.0", "1.0"];
const ANSWER_KEYS: AnswerOption["key"][] = ["A", "B", "C", "D"];

type GeneratedQuestionPayload = {
  variants?: unknown;
};

function selectedQuestionGenerator() {
  return process.env.LEARNBUDDY_QUESTION_GENERATOR?.trim().toLowerCase() || "local";
}

function usesAIQuestionGenerator() {
  const selected = selectedQuestionGenerator();
  return [
    "ai",
    "llm",
    "external",
    "provider",
    "learnordie",
    "learnordie-responses",
    "llm.learnordie.app",
    "ctox",
    "ctox-responses",
    "llm.ctox.dev",
    "responses",
    "openai-compatible",
    "http"
  ].includes(selected);
}

function compact(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

function stringField(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Question generator returned invalid ${fieldName}.`);
  }
  return value.trim();
}

function extractJsonObject(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  throw new Error("Question generator returned invalid question JSON.");
}

function parseJsonPayload(value: string): GeneratedQuestionPayload {
  try {
    return JSON.parse(extractJsonObject(value)) as GeneratedQuestionPayload;
  } catch {
    throw new Error("Question generator returned invalid question JSON.");
  }
}

function normalizeAnswers(rawAnswers: unknown): AnswerOption[] {
  if (!Array.isArray(rawAnswers) || rawAnswers.length !== 4) {
    throw new Error("Question generator returned invalid answers.");
  }

  const answers = rawAnswers.map((raw, index) => {
    if (!raw || typeof raw !== "object") {
      throw new Error("Question generator returned invalid answers.");
    }
    const record = raw as Record<string, unknown>;
    return {
      key: ANSWER_KEYS[index],
      text: stringField(record.text, "answer text"),
      correct: record.correct === true
    };
  });

  if (answers.filter((answer) => answer.correct).length !== 1) {
    throw new Error("Question generator returned invalid answer key.");
  }

  return answers;
}

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

// Sprachmodelle setzen die richtige Antwort meist an die erste Stelle. Innerhalb einer
// Familie steht sie deshalb je Niveau an einer anderen, zufaelligen Position A-D.
function distributeAnswerKeys(variants: QuestionVariant[]): QuestionVariant[] {
  const correctPositions = shuffled([0, 1, 2, 3]);
  return variants.map((variant, variantIndex) => {
    const correct = variant.answers.find((answer) => answer.correct);
    const distractors = shuffled(variant.answers.filter((answer) => !answer.correct));
    if (!correct || distractors.length !== 3) return variant;
    const ordered = [...distractors];
    ordered.splice(correctPositions[variantIndex % 4], 0, correct);
    return {
      ...variant,
      answers: ordered.map((answer, index) => ({ ...answer, key: ANSWER_KEYS[index] }))
    };
  });
}

function questionFingerprint(value: string) {
  return value.toLocaleLowerCase("de-DE").replace(/\s+/g, " ").trim();
}

function parseGeneratedVariants(answer: string): QuestionVariant[] {
  const payload = parseJsonPayload(answer);
  const generatedVariants = payload.variants;
  if (!Array.isArray(generatedVariants)) {
    throw new Error("Question generator returned invalid variants.");
  }

  const variants = LEVELS.map((level) => {
    const rawVariant = generatedVariants.find((candidate: unknown) => (
      Boolean(candidate)
      && typeof candidate === "object"
      && (candidate as Record<string, unknown>).level === level
    ));
    if (!rawVariant || typeof rawVariant !== "object") {
      throw new Error(`Question generator returned no ${level} variant.`);
    }
    const record = rawVariant as Record<string, unknown>;

    return {
      level,
      points: levelPoints(level),
      text: stringField(record.text, "question text"),
      explanation: stringField(record.explanation, "explanation"),
      answers: normalizeAnswers(record.answers)
    };
  });

  if (new Set(variants.map((variant) => questionFingerprint(variant.text))).size !== variants.length) {
    throw new Error("Question generator returned duplicate question texts.");
  }

  return variants;
}

function questionSystemPrompt() {
  return [
    "Du bist ein deutschsprachiger Aufgabenautor für eine technische Universitätsvorlesung.",
    "Erzeuge Multiple-Choice-Fragen auf vier klar unterschiedlichen Schwierigkeitsstufen.",
    "Nutze ausschließlich die bereitgestellte Folie und die Quellen.",
    "Verwende korrektes Deutsch mit Umlauten.",
    "Gib ausschließlich valides JSON zurück. Keine Markdown-Umrandung, keine Erklärung außerhalb des JSON."
  ].join(" ");
}

function questionUserPrompt(input: {
  lecture: Lecture;
  material: LectureMaterial;
  chunks?: Pick<MaterialChunk, "sourceRef" | "content">[];
}) {
  const slideContext = input.lecture.slides.slice(0, 4).map((slide) => [
    `${slide.eyebrow}: ${slide.title}`,
    slide.topic,
    ...slide.copy
  ].filter(Boolean).join(" | ")).join("\n");
  const sourceContext = (input.chunks && input.chunks.length > 0
    ? input.chunks.slice(0, 5).map((chunk) => `${chunk.sourceRef}: ${compact(chunk.content, 620)}`)
    : [`${input.material.originalName}: ${input.material.extractedTextPreview ?? "Keine Textvorschau vorhanden."}`]
  ).join("\n");

  return [
    `Vorlesung: ${input.lecture.seriesTitle} / ${input.lecture.title}`,
    `Quelle: ${input.material.originalName}`,
    "Folienkontext:",
    slideContext,
    "Quellenkontext:",
    sourceContext,
    "Schwierigkeitsstufen:",
    "4.0 prüft Begriff und Zuordnung.",
    "3.0 prüft bekannte Anwendung im Vorlesungskontext.",
    "2.0 prüft Ursache, Wirkung und fachliche Erklärung.",
    "1.0 prüft Transfer auf einen neuen technischen Fall.",
    "Anforderung:",
    "Erzeuge genau vier Varianten, je eine pro Niveau 4.0, 3.0, 2.0, 1.0.",
    "Jede Variante braucht genau vier Antworten A bis D, genau eine korrekte Antwort und drei fachlich plausible Ablenker.",
    "Die vier Fragen dürfen nicht identisch sein.",
    "JSON-Schema:",
    "{\"variants\":[{\"level\":\"4.0\",\"text\":\"...\",\"answers\":[{\"text\":\"...\",\"correct\":true},{\"text\":\"...\",\"correct\":false},{\"text\":\"...\",\"correct\":false},{\"text\":\"...\",\"correct\":false}],\"explanation\":\"...\"}]}"
  ].join("\n");
}

export async function generateQuestionVariantsForMaterial(input: {
  lecture: Lecture;
  material: LectureMaterial;
  chunks?: Pick<MaterialChunk, "sourceRef" | "content">[];
}): Promise<QuestionVariant[]> {
  if (!usesAIQuestionGenerator()) {
    return generateReviewVariants(input.lecture, input.material);
  }

  let provider;
  try {
    provider = getAIProvider();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Question generator is not configured: ${message}`);
  }

  if (provider.info.provider === "learnbuddy-demo") {
    throw new Error("Question generator is not configured: LEARNBUDDY_AI_PROVIDER is required for LEARNBUDDY_QUESTION_GENERATOR=ai.");
  }

  let result;
  try {
    result = await provider.complete({
      system: questionSystemPrompt(),
      user: questionUserPrompt(input),
      maxOutputTokens: 2600,
      temperature: 0.25,
      responseFormat: "json_object"
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("timed out")) {
      throw new Error("Question generator request timed out.");
    }
    throw new Error(`Question generator request failed: ${message}`);
  }

  const model = `${provider.info.provider}:${provider.info.model}`;
  const variants = distributeAnswerKeys(parseGeneratedVariants(result.answer));
  return variants.map((variant) => withVariantMetadata(variant, input.material, {
    promptVersion: "llm-material-v1",
    model
  }));
}

export type LiveQuestionSlideContext = {
  title: string;
  lines: string[];
};

function liveQuestionSystemPrompt() {
  return [
    "Du bist ein deutschsprachiger Aufgabenautor und begleitest eine laufende technische Universitätsvorlesung.",
    "Du erzeugst genau EINE Frage als Fragenfamilie: dieselbe Frage zum selben Thema in vier Schwierigkeitsstufen.",
    "Grundlage ist, was die Lehrperson gerade gesagt hat (Transkript), eingeordnet durch den Folieninhalt.",
    "Erfinde keine Fakten, die weder im Transkript noch auf der Folie stehen. Rechne Zahlen selbst nach.",
    "Verwende korrektes Deutsch mit Umlauten und Unicode-Formelzeichen, kein LaTeX.",
    "Gib ausschließlich valides JSON zurück. Keine Markdown-Umrandung, keine Erklärung außerhalb des JSON."
  ].join(" ");
}

function liveQuestionUserPrompt(input: {
  lecture: Lecture;
  slide: LiveQuestionSlideContext;
  transcript: string;
  existingQuestionTexts: string[];
}) {
  return [
    `Vorlesung: ${input.lecture.seriesTitle} / ${input.lecture.title}`,
    `Aktuelle Folie: ${input.slide.title}`,
    "Folieninhalt:",
    ...input.slide.lines.map((line) => `- ${compact(line, 400)}`),
    "Transkript der letzten Minuten (wörtlich, automatisch erkannt, kann Hör- und Erkennungsfehler enthalten):",
    compact(input.transcript, 3200),
    input.existingQuestionTexts.length > 0 ? "Bereits gestellte Fragen zu dieser Folie (nicht wiederholen, anderes Thema oder anderer Aspekt):" : "",
    ...input.existingQuestionTexts.slice(0, 12).map((text) => `- ${compact(text, 200)}`),
    "Schwierigkeitsstufen (alle vier zum SELBEN Thema):",
    "4.0 Wiedergeben: zentraler Begriff oder Aussage.",
    "3.0 Verstehen: Zusammenhang erklären.",
    "2.0 Anwenden: konkreter Fall, Zahl oder Formel.",
    "1.0 Übertragen oder Bewerten: neue technische Situation oder Fehlvorstellung beurteilen.",
    "Anforderung:",
    "Genau vier Varianten, je eine pro Niveau 4.0, 3.0, 2.0, 1.0, alle zum selben Thema aus dem Transkript.",
    "Jede Variante: Fragetext höchstens 240 Zeichen, genau vier Antworten, genau eine korrekt, Erklärung höchstens 480 Zeichen.",
    "Ablenker sind typische Fehlvorstellungen zum selben Thema: fachlich plausibel für Studierende, die das Thema nicht sicher beherrschen, in gleicher Form und ähnlicher Länge wie die richtige Antwort. Keine offensichtlich absurden Aussagen.",
    "Jede Antwort ist ein vollständiger, grammatisch korrekter Ausdruck oder Satz. Die richtige Antwort ist nicht auffällig länger oder genauer formuliert als die Ablenker.",
    "Die Erklärung sagt, warum die richtige Antwort stimmt, und benennt die Fehlvorstellung des stärksten Ablenkers.",
    "Keine Antworten wie „alle/keine der genannten“, keine verneinten Fragestellungen.",
    "Zusätzlich ein Feld \"topic\" mit 2 bis 5 Wörtern.",
    "JSON-Schema:",
    "{\"topic\":\"...\",\"variants\":[{\"level\":\"4.0\",\"text\":\"...\",\"answers\":[{\"text\":\"...\",\"correct\":true},{\"text\":\"...\",\"correct\":false},{\"text\":\"...\",\"correct\":false},{\"text\":\"...\",\"correct\":false}],\"explanation\":\"...\"}]}"
  ].filter(Boolean).join("\n");
}

function clampLiveVariant(variant: QuestionVariant): QuestionVariant {
  return {
    ...variant,
    text: variant.text.length > 260 ? `${variant.text.slice(0, 257)}...` : variant.text,
    explanation: variant.explanation.length > 520 ? `${variant.explanation.slice(0, 517)}...` : variant.explanation,
    answers: variant.answers.map((answer) => ({ ...answer, text: answer.text.slice(0, 400) }))
  };
}

// Eine neue Fragenfamilie (alle vier Niveaus) aus dem Live-Transkript einer Folie.
export async function generateLiveQuestionFamily(input: {
  lecture: Lecture;
  slide: LiveQuestionSlideContext;
  transcript: string;
  existingQuestionTexts: string[];
}): Promise<QuestionVariant[]> {
  const liveMetadata = {
    promptVersion: "live-transcript-v1",
    reviewStatus: "approved" as const,
    sourceRef: `Live-Transkript · ${input.slide.title}`
  };

  if (!usesAIQuestionGenerator()) {
    const material = {
      id: "live-transcript",
      lectureId: input.lecture.id,
      kind: "notes",
      source: "notes",
      originalName: `Live-Transkript ${input.slide.title}`,
      status: "ready",
      extractedTextPreview: compact(input.transcript, 240)
    } as unknown as LectureMaterial;
    return generateReviewVariants(input.lecture, material).map((variant) => ({ ...variant, ...liveMetadata }));
  }

  const provider = getAIProvider();
  if (provider.info.provider === "learnbuddy-demo") {
    throw new Error("Question generator is not configured: LEARNBUDDY_AI_PROVIDER is required for live questions.");
  }

  let result;
  try {
    result = await provider.complete({
      system: liveQuestionSystemPrompt(),
      user: liveQuestionUserPrompt(input),
      maxOutputTokens: 2600,
      temperature: 0.3,
      responseFormat: "json_object",
      timeoutMs: 45_000
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message.toLowerCase().includes("timed out") || message.toLowerCase().includes("abort")
      ? "Question generator request timed out."
      : `Question generator request failed: ${message}`);
  }

  const variants = distributeAnswerKeys(parseGeneratedVariants(result.answer).map(clampLiveVariant));
  const existing = new Set(input.existingQuestionTexts.map(questionFingerprint));
  if (variants.some((variant) => existing.has(questionFingerprint(variant.text)))) {
    throw new Error("Question generator returned a duplicate of an existing question.");
  }
  const model = `${provider.info.provider}:${provider.info.model}`;
  return variants.map((variant) => ({ ...variant, ...liveMetadata, promptVersion: `live-transcript-v1:${model}` }));
}
