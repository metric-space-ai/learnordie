import assert from "node:assert/strict";
import test from "node:test";

import { demoLecture } from "@/lib/demo-data";
import type { Lecture } from "@/lib/types";
import { evaluateStudentChatQuestion } from "./chat-question-filter";
import { moderateStudentChatQuestion } from "./chat-question-moderation";
import { acceptedTranscriptContext } from "./question-generation";

const lecture: Lecture = {
  ...demoLecture,
  title: "Modellbegriff",
  seriesTitle: "Wissenschaftstheorie",
  slides: [],
  questions: [],
  materials: [],
  transcriptSegments: []
};
const question = "Wie verändern sich Ruhelage und Schwingung, wenn dieselbe Masse an einer weicheren Feder hängt?";
const speech = "Eine Masse hängt an einer Feder. Wenn die Feder weicher wird, hängt die Masse weiter nach unten. Die Schwingung wird langsamer.";

test("a student question about accepted current speech is admitted without a static-slide keyword", async () => {
  assert.equal(evaluateStudentChatQuestion(lecture, question).status, "ignored");
  const result = evaluateStudentChatQuestion(lecture, question, speech);
  assert.equal(result.status, "accepted");
  assert.ok(result.matches.includes("masse"));
  assert.ok(result.matches.includes("feder"));
  assert.ok(!result.matches.includes("einer"));

  const previous = process.env.LEARNBUDDY_CHAT_MODERATION_PROVIDER;
  process.env.LEARNBUDDY_CHAT_MODERATION_PROVIDER = "local";
  try {
    assert.equal((await moderateStudentChatQuestion(lecture, question, speech)).status, "accepted");
    assert.equal((await moderateStudentChatQuestion(lecture, question)).status, "ignored");
  } finally {
    if (previous === undefined) delete process.env.LEARNBUDDY_CHAT_MODERATION_PROVIDER;
    else process.env.LEARNBUDDY_CHAT_MODERATION_PROVIDER = previous;
  }
});

test("old-session, rejected, and pre-restart audio cannot admit a current chat question", () => {
  const start = Date.parse("2026-09-14T01:00:00.000Z");
  const current = new Date(start + 20_000).toISOString();
  const old = new Date(start - 20_000).toISOString();
  const segment = { id: "speech", lectureId: lecture.id, text: speech, provider: "fixture", status: "accepted" as const, relevanceReason: "fixture", createdAt: current };
  for (const variant of [
    { ...segment, createdAt: old },
    { ...segment, status: "ignored" as const },
    { ...segment, startedAt: old, endedAt: current }
  ]) {
    const context = acceptedTranscriptContext({ ...lecture, transcriptSegments: [variant] }, start);
    assert.equal(context.accumulated, "");
    assert.equal(evaluateStudentChatQuestion(lecture, question, context.accumulated).status, "ignored");
  }
  const active = { ...lecture, transcriptSegments: [segment] };
  assert.equal(evaluateStudentChatQuestion(lecture, question, acceptedTranscriptContext(active, start).accumulated).status, "accepted");
  assert.equal(acceptedTranscriptContext(active, null).accumulated, "");
});

test("bearing vocabulary is not a universal admission rule for unrelated lectures", () => {
  assert.equal(evaluateStudentChatQuestion(lecture, "Wie verändert Viskosität den Schmierfilm im Gleitlager?").status, "ignored");
  assert.equal(evaluateStudentChatQuestion(demoLecture, "Wie verändert Viskosität den Schmierfilm im Gleitlager?").status, "accepted");
});

test("generic phrasing alone does not establish a lecture relation", () => {
  assert.equal(evaluateStudentChatQuestion(lecture, "Können wir nach einer Pause auch über Fußball sprechen?", "In einer Vorlesung können wir dieses Thema unter einer Frage behandeln.").status, "ignored");
  assert.equal(evaluateStudentChatQuestion(lecture, "Wann kommt die nächste Fußballübertragung?", speech).status, "ignored");
  assert.equal(evaluateStudentChatQuestion(lecture, "Feder?", speech).status, "ignored");
});

test("static lecture context remains available without recording, including later slides", () => {
  const laterSlide = { ...demoLecture.slides[0], title: "Randbedingung", topic: "Saite", copy: ["Die Randbedingung legt die Auslenkung an den Enden der Saite fest."] };
  const withSlides = { ...lecture, slides: [...Array.from({ length: 6 }, () => ({ ...laterSlide, title: "Modell", topic: "Abbildung", copy: [] })), laterSlide] };
  assert.equal(evaluateStudentChatQuestion(withSlides, "Welche Randbedingung gilt am Ende der Saite?").status, "accepted");
});
