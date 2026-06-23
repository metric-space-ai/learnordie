export const MIN_LEARN_QUESTION_DENSITY = 1;
export const MAX_LEARN_QUESTION_DENSITY = 7;
export const DEFAULT_LEARN_QUESTION_DENSITY = 4;

export function normalizeLearnQuestionDensity(value: unknown, fallback = DEFAULT_LEARN_QUESTION_DENSITY) {
  const numeric = typeof value === "number" ? value : Number(value);
  const base = Number.isFinite(numeric) ? numeric : fallback;
  return Math.min(MAX_LEARN_QUESTION_DENSITY, Math.max(MIN_LEARN_QUESTION_DENSITY, Math.round(base)));
}
