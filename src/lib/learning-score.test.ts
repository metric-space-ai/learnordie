import assert from "node:assert/strict";
import test from "node:test";
import { learningScoreEvents } from "@/lib/learning-score";

const event = (id: string, points = 3, extra: Record<string, unknown> = {}) => ({
  id, lectureToken: "lecture-a", anonymousKey: "student-a", eventType: "answer_selected",
  occurredAt: `2026-09-13T12:00:0${id}Z`, payload: { mode: "learn", familyId: "family-a", points, correct: true, ...extra }
});
const score = (payload: Record<string, unknown>) => payload.correct ? Number(payload.points) : 0;
test("same question after reload or concurrent submission scores once", () => {
  const events = [event("1"), event("2"), event("3")];
  const selected = learningScoreEvents(events, score);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].id, "1");
  assert.equal(selected.reduce((total, item) => total + score(item.payload), 0), 3);
  assert.deepEqual(learningScoreEvents([...events].reverse(), score), selected);
});
test("higher level improves the family best score rather than adding to it", () => {
  const selected = learningScoreEvents([event("1", 2), event("2", 4), event("3", 4, { correct: false })], score);
  assert.equal(selected.length, 1);
  assert.equal(score(selected[0].payload), 4);
});
test("different students, lectures, families and real live rounds remain independent", () => {
  const events = [event("1"), { ...event("2"), anonymousKey: "student-b" },
    { ...event("3"), lectureToken: "lecture-b" }, event("4", 3, { familyId: "family-b" }),
    event("5", 3, { mode: "live", roundId: "round-a" }), event("6", 3, { mode: "live", roundId: "round-b" })];
  assert.equal(learningScoreEvents(events, score).length, events.length);
});
test("legacy text identity is deduplicated without collapsing unrelated anonymous events", () => {
  const old = [event("1", 3, { familyId: undefined, questionText: "Was ist ein Modell?" }), event("2", 3, { familyId: undefined, questionText: "Was ist ein Modell?" })];
  assert.equal(learningScoreEvents(old, score).length, 1);
  assert.equal(learningScoreEvents(old.map(item => ({ ...item, anonymousKey: undefined })), score).length, 2);
});
