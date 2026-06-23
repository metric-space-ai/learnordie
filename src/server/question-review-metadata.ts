import crypto from "node:crypto";

import type {
  QuestionPromptHistoryItem,
  QuestionPromptRegistry,
  QuestionQualityDecision,
  QuestionVariant
} from "@/lib/types";

function historyId() {
  return `prompt_${crypto.randomUUID()}`;
}

function compact(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}

function templateTitleForLevel(level: QuestionVariant["level"]) {
  return ({
    "4.0": "Begriffe sicher zuordnen",
    "3.0": "Bekannte Anwendung einordnen",
    "2.0": "Ursache und Wirkung erklären",
    "1.0": "Transfer auf neuen technischen Fall"
  } as const)[level];
}

function temperatureForLevel(level: QuestionVariant["level"]) {
  return ({
    "4.0": 0.2,
    "3.0": 0.3,
    "2.0": 0.4,
    "1.0": 0.5
  } as const)[level];
}

function defaultTemplateBodyForLevel(level: QuestionVariant["level"]) {
  return [
    `Erzeuge eine deutschsprachige Multiple-Choice-Frage auf Niveau ${level}.`,
    `Nutze nur die bereitgestellten Quellen und die sichtbare Vorlesungsfolie.`,
    `Die Frage muss ein klares Lernziel prüfen, genau eine richtige Antwort enthalten und drei plausible Ablenker liefern.`,
    `Die Erklärung benennt kurz, warum die richtige Antwort fachlich trägt.`
  ].join("\n");
}

function answerSignature(variant: QuestionVariant) {
  return variant.answers.map((answer) => `${answer.key}:${answer.correct ? "1" : "0"}:${answer.text}`).join("|");
}

function changedFields(previous: QuestionVariant | undefined, next: QuestionVariant) {
  if (!previous) return ["Neue Variante"];
  const fields: string[] = [];
  if (previous.text !== next.text) fields.push("Fragetext");
  if (previous.explanation !== next.explanation) fields.push("Erklärung");
  if (answerSignature(previous) !== answerSignature(next)) fields.push("Antworten");
  if ((previous.promptVersion ?? "") !== (next.promptVersion ?? "")) fields.push("Promptversion");
  if ((previous.sourceRef ?? "") !== (next.sourceRef ?? "")) fields.push("Quelle");
  if ((previous.learningObjective ?? "") !== (next.learningObjective ?? "")) fields.push("Lernziel");
  if ((previous.reviewStatus ?? "") !== (next.reviewStatus ?? "")) fields.push("Status");
  if ((previous.reviewerComment ?? "") !== (next.reviewerComment ?? "")) fields.push("Kommentar");
  return fields;
}

function countReviewEdits(variant: QuestionVariant) {
  return (variant.promptHistory ?? []).filter((item) => item.kind === "edit").length;
}

export function buildPromptRegistry(input: {
  variant: QuestionVariant;
  sourceTitle?: string;
  promptVersion?: string;
  learningObjective?: string;
  model?: string;
  decisionStatus?: QuestionVariant["reviewStatus"];
  updatedAt?: string;
}): QuestionPromptRegistry {
  const level = input.variant.level;
  const promptVersion = input.promptVersion ?? input.variant.promptVersion ?? "local-material-v1";
  const sourceCoverage = input.variant.sourceRef || input.sourceTitle ? 1 : 0;
  const decisionStatus = input.decisionStatus ?? input.variant.qualityDecision?.status ?? input.variant.reviewStatus;
  const revisionCount = countReviewEdits(input.variant);
  return {
    templateId: `learnbuddy-mcq-${level.replace(".", "")}-v1`,
    templateTitle: `MCQ ${level}: ${templateTitleForLevel(level)}`,
    templateBody: input.variant.promptRegistry?.templateBody ?? defaultTemplateBodyForLevel(level),
    promptVersion,
    model: input.model ?? input.variant.promptRegistry?.model ?? "learnbuddy-local-material",
    modelParameters: {
      temperature: input.variant.promptRegistry?.modelParameters.temperature ?? temperatureForLevel(level),
      topP: input.variant.promptRegistry?.modelParameters.topP ?? 0.9,
      maxOutputTokens: input.variant.promptRegistry?.modelParameters.maxOutputTokens ?? 520,
      retrievalMode: input.variant.promptRegistry?.modelParameters.retrievalMode ?? "hybrid",
      sourceLimit: input.variant.promptRegistry?.modelParameters.sourceLimit ?? 4
    },
    qualityMetrics: {
      difficultyLevel: level,
      cognitiveTarget: input.learningObjective ?? input.variant.learningObjective ?? templateTitleForLevel(level),
      sourceCoverage,
      reviewConfidence: decisionStatus === "approved"
        ? 0.92
        : decisionStatus === "rejected"
          ? 0.34
          : Math.min(0.86, 0.68 + revisionCount * 0.04),
      revisionCount,
      lastDecision: decisionStatus
    },
    testRuns: input.variant.promptRegistry?.testRuns ?? [],
    modelComparisons: input.variant.promptRegistry?.modelComparisons ?? [],
    updatedAt: input.updatedAt ?? new Date().toISOString()
  };
}

function appendHistory(variant: QuestionVariant, item: QuestionPromptHistoryItem): QuestionVariant {
  const next = {
    ...variant,
    promptHistory: [...(variant.promptHistory ?? []), item]
  };
  return {
    ...next,
    promptRegistry: buildPromptRegistry({ variant: next, updatedAt: item.createdAt })
  };
}

export function createGenerationHistory(input: {
  variant: QuestionVariant;
  sourceTitle: string;
  sourceRef?: string;
  promptVersion: string;
  learningObjective: string;
  model?: string;
}): QuestionPromptHistoryItem {
  return {
    id: historyId(),
    kind: "generation",
    title: `Frage Niveau ${input.variant.level} generiert`,
    promptVersion: input.promptVersion,
    model: input.model ?? "learnbuddy-local-material",
    inputSummary: compact(`${input.sourceTitle}; Quelle ${input.sourceRef ?? "ohne Referenz"}; Ziel: ${input.learningObjective}`),
    outputSummary: compact(input.variant.text),
    createdAt: new Date().toISOString()
  };
}

export function withPromptRegistry(input: {
  variant: QuestionVariant;
  sourceTitle?: string;
  promptVersion?: string;
  learningObjective?: string;
  model?: string;
}): QuestionVariant {
  return {
    ...input.variant,
    promptRegistry: buildPromptRegistry(input)
  };
}

export function recordReviewEdits(input: {
  previousVariants: QuestionVariant[];
  nextVariants: QuestionVariant[];
  actor: string;
}) {
  return input.nextVariants.map((variant) => {
    const previous = input.previousVariants.find((candidate) => candidate.level === variant.level);
    const fields = changedFields(previous, variant);
    if (fields.length === 0) return variant;

    return appendHistory(variant, {
      id: historyId(),
      kind: "edit",
      title: `Review geändert: Niveau ${variant.level}`,
      promptVersion: variant.promptVersion,
      model: "lecturer-review",
      actor: input.actor,
      inputSummary: `Geänderte Felder: ${fields.join(", ")}`,
      outputSummary: compact(variant.text),
      createdAt: new Date().toISOString()
    });
  });
}

export function applyQualityDecision(input: {
  variants: QuestionVariant[];
  decision: "approved" | "rejected";
  actor: string;
}) {
  const status = input.decision === "approved" ? "approved" : "rejected";
  const decidedAt = new Date().toISOString();

  return input.variants.map((variant) => {
    const qualityDecision: QuestionQualityDecision = {
      status,
      reason: variant.reviewerComment?.trim()
        || (status === "approved"
          ? "Fachlich freigegeben und als Live-Frage geeignet."
          : "Nicht für die aktive Vorlesung freigegeben."),
      decidedBy: input.actor,
      decidedAt
    };

    return appendHistory({
      ...variant,
      reviewStatus: status,
      qualityDecision
    }, {
      id: historyId(),
      kind: "decision",
      title: status === "approved" ? `Freigegeben: Niveau ${variant.level}` : `Verworfen: Niveau ${variant.level}`,
      promptVersion: variant.promptVersion,
      model: "lecturer-review",
      actor: input.actor,
      inputSummary: qualityDecision.reason,
      outputSummary: compact(variant.text),
      createdAt: decidedAt
    });
  });
}
