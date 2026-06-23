import type { EvaluationConfig } from "./types";

export const defaultEvaluationConfig: EvaluationConfig = {
  enabled: true,
  version: 1,
  updatedAt: "2026-06-17T00:00:00.000Z",
  title: "Evaluation",
  intro: "Kurze Rückmeldung zur Vorlesung.",
  understandingLabel: "Verständnis",
  paceLabel: "Tempo",
  aiHelpfulLabel: "KI-Hilfe",
  commentLabel: "Kommentar",
  submitLabel: "Evaluation senden"
};

function cleanText(value: unknown, fallback: string, maxLength = 120) {
  if (typeof value !== "string") return fallback;
  const clean = value.replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, maxLength) : fallback;
}

function cleanVersion(value: unknown) {
  const version = Number(value);
  return Number.isInteger(version) && version > 0 ? version : defaultEvaluationConfig.version;
}

function cleanUpdatedAt(value: unknown) {
  if (typeof value !== "string") return defaultEvaluationConfig.updatedAt;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : defaultEvaluationConfig.updatedAt;
}

export function normalizeEvaluationConfig(value: unknown): EvaluationConfig {
  const source = value && typeof value === "object" ? value as Partial<EvaluationConfig> : {};
  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : defaultEvaluationConfig.enabled,
    version: cleanVersion(source.version),
    updatedAt: cleanUpdatedAt(source.updatedAt),
    title: cleanText(source.title, defaultEvaluationConfig.title, 80),
    intro: cleanText(source.intro, defaultEvaluationConfig.intro, 180),
    understandingLabel: cleanText(source.understandingLabel, defaultEvaluationConfig.understandingLabel),
    paceLabel: cleanText(source.paceLabel, defaultEvaluationConfig.paceLabel),
    aiHelpfulLabel: cleanText(source.aiHelpfulLabel, defaultEvaluationConfig.aiHelpfulLabel),
    commentLabel: cleanText(source.commentLabel, defaultEvaluationConfig.commentLabel),
    submitLabel: cleanText(source.submitLabel, defaultEvaluationConfig.submitLabel, 80)
  };
}

function significantFields(config: EvaluationConfig) {
  return {
    enabled: config.enabled,
    title: config.title,
    intro: config.intro,
    understandingLabel: config.understandingLabel,
    paceLabel: config.paceLabel,
    aiHelpfulLabel: config.aiHelpfulLabel,
    commentLabel: config.commentLabel,
    submitLabel: config.submitLabel
  };
}

export function normalizeEvaluationConfigForUpdate(previous: unknown, next: unknown, changedAt = new Date()): EvaluationConfig {
  const previousConfig = normalizeEvaluationConfig(previous);
  const nextConfig = normalizeEvaluationConfig(next);
  const changed = JSON.stringify(significantFields(previousConfig)) !== JSON.stringify(significantFields(nextConfig));

  if (!changed) {
    return {
      ...nextConfig,
      version: previousConfig.version,
      updatedAt: previousConfig.updatedAt
    };
  }

  return {
    ...nextConfig,
    version: previousConfig.version + 1,
    updatedAt: changedAt.toISOString()
  };
}
