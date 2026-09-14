import type { TranscriptSegment } from "./types";

/** Confirmed speech from this session only; also shared by the question context. */
export function currentSessionTranscript(segments: readonly TranscriptSegment[], sessionStartedAt: number | null) {
  if (sessionStartedAt === null || !Number.isFinite(sessionStartedAt)) return [];
  return segments.filter(segment => segment.status === "accepted"
    && Date.parse(segment.createdAt) >= sessionStartedAt
    && Date.parse(segment.startedAt ?? segment.createdAt) >= sessionStartedAt
    && Date.parse(segment.endedAt ?? segment.createdAt) >= sessionStartedAt)
    .sort((left, right) => Date.parse(left.endedAt ?? left.createdAt) - Date.parse(right.endedAt ?? right.createdAt));
}
