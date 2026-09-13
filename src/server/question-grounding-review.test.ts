import assert from "node:assert/strict";
import test from "node:test";
import { parseQuestionGroundingReview, reviewQuestionGrounding } from "./question-grounding-review";
import type { AIProvider } from "./providers/ai";

const sources = "Die Eigenfrequenz einer Feder-Masse-Schwingung ist proportional zur Wurzel der Federkonstante bei gleichbleibender Masse.";
const valid = () => ({ reviews: ["4.0", "3.0", "2.0", "1.0"].map(level => ({ level, approved: true, sourceQuote: sources, reason: "Die genannte Beziehung trägt die Lösung." })) });

test("grounding approval requires all four levels and an actual source quote for each", () => {
  assert.doesNotThrow(() => parseQuestionGroundingReview(JSON.stringify(valid()), sources));
  const fabricated = valid(); fabricated.reviews[2].sourceQuote = "Ab einer Sommerfeldzahl von 0,9 ist die Schmierung ausreichend.";
  assert.throws(() => parseQuestionGroundingReview(JSON.stringify(fabricated), sources), /Beleg fehlt/);
  const rejected = valid(); rejected.reviews[2].approved = false; rejected.reviews[2].reason = "Unbelegter Sicherheitsgrenzwert";
  assert.throws(() => parseQuestionGroundingReview(JSON.stringify(rejected), sources), /Unbelegter Sicherheitsgrenzwert/);
  const missing = valid(); missing.reviews.pop();
  assert.throws(() => parseQuestionGroundingReview(JSON.stringify(missing), sources), /vier Einzelprüfungen/);
  const duplicate = valid(); duplicate.reviews[3].level = "2.0";
  assert.throws(() => parseQuestionGroundingReview(JSON.stringify(duplicate), sources), /doppelte Stufe/);
  const wrongBoolean = { reviews: valid().reviews.map(v => ({ ...v, approved: "true" })) };
  assert.throws(() => parseQuestionGroundingReview(JSON.stringify(wrongBoolean), sources), /Fachprüfung/);
  assert.throws(() => parseQuestionGroundingReview("null", sources), /vier Einzelprüfungen/);
  assert.throws(() => parseQuestionGroundingReview("not json", sources));
});

test("review fails closed for provider failure, malformed approval and elapsed deadline", async () => {
  let calls = 0;
  const provider = { complete: async () => { calls++; throw new Error("provider unavailable"); } } as unknown as AIProvider;
  await assert.rejects(reviewQuestionGrounding(provider, [], sources, Date.now() + 2000), /provider unavailable/);
  await assert.rejects(reviewQuestionGrounding(provider, [], sources, Date.now() - 1), /Zeitlimit/);
  await assert.rejects(reviewQuestionGrounding(provider, [], "", Date.now() + 2000), /Vorlesungsquelle/);
  assert.equal(calls, 1);
});
