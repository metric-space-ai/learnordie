const MAX_TRANSCRIPT_SEGMENT_MS = 15 * 60 * 1000;
const FUTURE_SKEW_MS = 2 * 60 * 1000;

type TranscriptTimeRangeInput = {
  startedAt?: string | null;
  endedAt?: string | null;
};

type TranscriptTimeRangeResult =
  | { ok: true; startedAt?: string; endedAt?: string }
  | { ok: false };

function parseOptionalTimestamp(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return { ok: true as const, value: undefined };

  const parsed = new Date(trimmed);
  if (!Number.isFinite(parsed.getTime())) return { ok: false as const };
  return { ok: true as const, value: parsed };
}

export function normalizeTranscriptTimeRange(
  input: TranscriptTimeRangeInput,
  now = new Date()
): TranscriptTimeRangeResult {
  const startedAt = parseOptionalTimestamp(input.startedAt);
  const endedAt = parseOptionalTimestamp(input.endedAt);
  if (!startedAt.ok || !endedAt.ok) return { ok: false };

  const latestAllowed = now.getTime() + FUTURE_SKEW_MS;
  if (
    (startedAt.value && startedAt.value.getTime() > latestAllowed) ||
    (endedAt.value && endedAt.value.getTime() > latestAllowed)
  ) {
    return { ok: false };
  }

  if (startedAt.value && endedAt.value) {
    const durationMs = endedAt.value.getTime() - startedAt.value.getTime();
    if (durationMs < 0 || durationMs > MAX_TRANSCRIPT_SEGMENT_MS) return { ok: false };
  }

  return {
    ok: true,
    startedAt: startedAt.value?.toISOString(),
    endedAt: endedAt.value?.toISOString()
  };
}
