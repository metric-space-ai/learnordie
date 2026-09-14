import assert from "node:assert/strict";
import test from "node:test";
import type { TranscriptSegment } from "./types";
import { currentSessionTranscript } from "./session-transcript";

test("visible live transcript and question context exclude historical, late old and ignored speech", () => {
  const start = Date.parse("2026-09-14T02:00:00Z");
  const segment = (id: string, overrides: Partial<TranscriptSegment> = {}): TranscriptSegment => ({
    id, lectureId: "fixture", text: id, provider: "fixture", status: "accepted", relevanceReason: "fixture",
    startedAt: new Date(start + 1000).toISOString(), endedAt: new Date(start + 2000).toISOString(),
    createdAt: new Date(start + 3000).toISOString(), ...overrides
  });
  const segments = [segment("later", {endedAt: new Date(start + 4000).toISOString()}),
    segment("history", {createdAt: new Date(start - 1000).toISOString()}),
    segment("late-old-upload", {startedAt: new Date(start - 1000).toISOString()}),
    segment("old-end", {endedAt: new Date(start - 1000).toISOString()}),
    segment("ignored", {status: "ignored"}), segment("first"),
    segment("invalid", {startedAt: "invalid"})];
  assert.deepEqual(currentSessionTranscript(segments, start).map(entry => entry.id), ["first", "later"]);
  assert.equal(segments[0].id, "later", "must not reorder stored history");
  assert.deepEqual(currentSessionTranscript(segments, null), []);
  assert.deepEqual(currentSessionTranscript(segments, NaN), []);
  assert.deepEqual(currentSessionTranscript(segments, start + 10_000), [], "a restart clears visible old speech");
  assert.equal(currentSessionTranscript([segment("legacy", {startedAt: undefined, endedAt: undefined})], start).length, 1);
});
