const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_MS = 30_000;
const DEFAULT_CRON_LIMIT = 5;
const MAX_ATTEMPTS_LIMIT = 10;
const MAX_RETRY_BASE_MS = 15 * 60_000;
export const WORKER_MAX_BATCH_LIMIT = 25;

function numericEnv(name: string, fallback: number, min: number, max: number) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

export function configuredWorkerMaxAttempts() {
  return numericEnv("LEARNBUDDY_WORKER_MAX_ATTEMPTS", DEFAULT_MAX_ATTEMPTS, 1, MAX_ATTEMPTS_LIMIT);
}

export function configuredWorkerRetryBaseMs() {
  return numericEnv("LEARNBUDDY_WORKER_RETRY_BASE_MS", DEFAULT_RETRY_BASE_MS, 1_000, MAX_RETRY_BASE_MS);
}

export function configuredWorkerCronLimit() {
  return numericEnv("LEARNBUDDY_WORKER_CRON_LIMIT", DEFAULT_CRON_LIMIT, 1, WORKER_MAX_BATCH_LIMIT);
}

export function normalizeWorkerLimit(value: unknown, fallback = 1) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return normalizeWorkerLimit(fallback, 1);
  return Math.max(1, Math.min(WORKER_MAX_BATCH_LIMIT, Math.floor(parsed)));
}

export function nextWorkerRetryAt(attemptCount: number, now = new Date()) {
  const exponent = Math.max(0, attemptCount - 1);
  const delayMs = configuredWorkerRetryBaseMs() * (2 ** exponent);
  return new Date(now.getTime() + delayMs);
}
