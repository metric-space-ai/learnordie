export const DEFAULT_AI_DAILY_LIMIT = 20;
export const DEFAULT_AI_DAILY_TOKEN_LIMIT = 12000;

export function normalizeAiDailyLimit(value: unknown, fallback = DEFAULT_AI_DAILY_LIMIT) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(200, Math.floor(parsed));
}

export function normalizeAiDailyTokenLimit(value: unknown, fallback = DEFAULT_AI_DAILY_TOKEN_LIMIT) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 100) return fallback;
  return Math.min(200000, Math.floor(parsed));
}

export function configuredDefaultAiDailyLimit() {
  return normalizeAiDailyLimit(process.env.LEARNBUDDY_AI_DAILY_LIMIT, DEFAULT_AI_DAILY_LIMIT);
}

export function configuredDefaultAiDailyTokenLimit() {
  return normalizeAiDailyTokenLimit(process.env.LEARNBUDDY_AI_DAILY_TOKEN_LIMIT, DEFAULT_AI_DAILY_TOKEN_LIMIT);
}
