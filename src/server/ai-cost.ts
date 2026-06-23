export type AiCostWarningLevel = "ok" | "watch" | "critical";

const DEFAULT_PROVIDER = "learnbuddy-demo";
const DEFAULT_MODEL = "scoped-demo";
const DEFAULT_INPUT_EUR_PER_1K = 0.00015;
const DEFAULT_OUTPUT_EUR_PER_1K = 0.0006;
const DEFAULT_WARNING_EUR = 1;
const DEFAULT_CRITICAL_EUR = 5;

function positiveNumber(value: unknown, fallback: number) {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 0) return fallback;
  return numberValue;
}

function roundedEuro(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function configuredAiCostSettings() {
  const warningEur = positiveNumber(process.env.LEARNBUDDY_AI_COST_WARNING_EUR, DEFAULT_WARNING_EUR);
  const criticalEur = positiveNumber(process.env.LEARNBUDDY_AI_COST_CRITICAL_EUR, DEFAULT_CRITICAL_EUR);

  return {
    provider: process.env.LEARNBUDDY_AI_COST_PROVIDER?.trim() || DEFAULT_PROVIDER,
    model: process.env.LEARNBUDDY_AI_COST_MODEL?.trim() || DEFAULT_MODEL,
    inputEurPer1k: positiveNumber(process.env.LEARNBUDDY_AI_COST_INPUT_EUR_PER_1K, DEFAULT_INPUT_EUR_PER_1K),
    outputEurPer1k: positiveNumber(process.env.LEARNBUDDY_AI_COST_OUTPUT_EUR_PER_1K, DEFAULT_OUTPUT_EUR_PER_1K),
    warningEur,
    criticalEur: Math.max(warningEur, criticalEur)
  };
}

export function estimateAiCost(input: { inputTokens: number; outputTokens: number; provider?: string; model?: string }) {
  const settings = configuredAiCostSettings();
  const inputTokens = Math.max(0, Math.round(input.inputTokens));
  const outputTokens = Math.max(0, Math.round(input.outputTokens));
  const estimatedEur = roundedEuro(
    (inputTokens / 1000) * settings.inputEurPer1k +
    (outputTokens / 1000) * settings.outputEurPer1k
  );
  const warningLevel: AiCostWarningLevel = estimatedEur >= settings.criticalEur
    ? "critical"
    : estimatedEur >= settings.warningEur
      ? "watch"
      : "ok";

  let warning = "Kosten im konfigurierten Rahmen.";
  if (warningLevel === "watch") {
    warning = `Kostenwarnung: ${estimatedEur.toFixed(4)} EUR seit Start dieser Vorlesung. Budget prüfen.`;
  } else if (warningLevel === "critical") {
    warning = `Kritische Kostenwarnung: ${estimatedEur.toFixed(4)} EUR seit Start dieser Vorlesung. Limit und Freigabe prüfen.`;
  } else if (inputTokens + outputTokens === 0) {
    warning = "Noch keine beantworteten KI-Anfragen.";
  }

  return {
    provider: input.provider?.trim() || settings.provider,
    model: input.model?.trim() || settings.model,
    currency: "EUR" as const,
    inputTokens,
    outputTokens,
    estimatedEur,
    inputEurPer1k: settings.inputEurPer1k,
    outputEurPer1k: settings.outputEurPer1k,
    warningEur: settings.warningEur,
    criticalEur: settings.criticalEur,
    warningLevel,
    warning
  };
}
