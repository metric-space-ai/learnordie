import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { demoLecture } from "./demo-data";
import { createModelQuestionBank } from "./model-question-bank";
import { originalModelSlides } from "./model-original-source";

const slideIds = Object.freeze(Array.from({ length: 8 }, (_, index) => `original-slide-${index + 1}`));
const expectedFamilies = [
  ["model-reviewed-begriffsgang-v1", "Begriffsgang"],
  ["model-reviewed-gedankenminiatur-v1", "Gedankenminiatur"],
  ["model-reviewed-naturgesetz-v1", "Naturgesetz"],
  ["model-reviewed-modellgrenzen-v1", "Modellgrenzen"],
  ["model-reviewed-ausfuehrung-v1", "Ausführung"],
  ["model-reviewed-lernen-v1", "Lernen"],
  ["model-reviewed-llm-v1", "LLM"],
  ["model-reviewed-produktentwicklung-v1", "Produktentwicklung"]
] as const;
const levels = ["4.0", "3.0", "2.0", "1.0"];

test("eight authored source slides each have one stable, complete four-level family", () => {
  const bank = createModelQuestionBank(slideIds);
  assert.equal(bank.length, 32);
  assert.deepEqual(originalModelSlides.map((slide) => slide.nav), expectedFamilies.map(([, nav]) => nav));
  assert.deepEqual([...new Set(bank.map((question) => question.familyId))], expectedFamilies.map(([id]) => id));
  for (const [index, [familyId, nav]] of expectedFamilies.entries()) {
    const family = bank.filter((question) => question.familyId === familyId);
    assert.deepEqual(family.map((question) => question.level), levels);
    assert.deepEqual(family.map((question) => question.points), [1, 2, 3, 4]);
    assert.deepEqual([...new Set(family.map((question) => question.slideId))], [slideIds[index]]);
    assert.equal(new Set(family.map((question) => question.learningObjective)).size, 1);
    for (const question of family) {
      assert.equal(question.familySource, "prepared");
      assert.equal(question.reviewStatus, "reviewed");
      assert.equal(question.promptVersion, "model-question-bank-standalone-v2");
      assert.ok(question.sourceRef?.includes(`Originalfolie ${index + 1} „${nav}“`));
      assert.ok(question.sourceRef?.includes(`Begleitskript Kap. ${index + 1}`));
      assert.match(question.sourceRef ?? "", /Neu verfasste Übungsfrage/);
      assert.match(question.reviewerComment ?? "", /keine aus der Vorlage importierte Frage/);
    }
  }
});

test("bindings are deterministic, positional and preserve caller IDs exactly", () => {
  const first = createModelQuestionBank(slideIds);
  assert.deepEqual(createModelQuestionBank(slideIds), first);
  const replacementIds = Object.freeze([" z ", "a", "X-3", "9", "slide-five", "six", "seven", "eight"]);
  const rebound = createModelQuestionBank(replacementIds);
  for (const [index, question] of rebound.entries()) {
    assert.equal(question.slideId, replacementIds[Math.floor(index / 4)]);
    assert.deepEqual({ ...question, slideId: first[index].slideId }, first[index]);
  }
  const reversed = createModelQuestionBank([...slideIds].reverse());
  assert.equal(reversed[0].slideId, slideIds[7]);
  assert.equal(reversed[0].familyId, expectedFamilies[0][0]);
});

test("missing, extra, blank, duplicate and sparse IDs fail instead of losing slide bindings", () => {
  for (const invalid of [
    [], slideIds.slice(0, 7), [...slideIds, "extra"], Array(8).fill("same"),
    [...slideIds.slice(0, 7), ""], [...slideIds.slice(0, 7), " \n "],
    [...slideIds.slice(0, 7), slideIds[0]], new Array<string>(8)
  ]) {
    assert.throws(() => createModelQuestionBank(invalid), /exactly eight distinct, nonblank slide IDs/);
  }
});

test("each question has four unique answers, exactly one correct and balanced answer positions", () => {
  const bank = createModelQuestionBank(slideIds);
  for (const question of bank) {
    assert.deepEqual(question.answers.map((answer) => answer.key), ["A", "B", "C", "D"]);
    assert.equal(new Set(question.answers.map((answer) => answer.text)).size, 4);
    assert.equal(question.answers.filter((answer) => answer.correct).length, 1);
  }
  for (const [familyId] of expectedFamilies) {
    const correctKeys = bank.filter((question) => question.familyId === familyId)
      .map((question) => question.answers.find((answer) => answer.correct)?.key);
    assert.deepEqual(correctKeys.sort(), ["A", "B", "C", "D"]);
  }
  // Anchor the application answers independently of the answer-position helper.
  assert.deepEqual(bank.filter((question) => question.level === "2.0")
    .map((question) => question.answers.find((answer) => answer.correct)?.text), [
    "Es wird ausgeführt; dafür ist kein Lernen nötig.",
    "Die Farbe des Gestells.",
    "ω steigt auf das Doppelte.",
    "Das Modell erfasst den Energieverlust durch Reibung nicht.",
    "Ein Sollwinkel von 30°.",
    "Die Vorhersage ŷ = 9.",
    "Die Ausführung mit einem veränderten Kontext.",
    "Passende Daten für die weiteren Lastfälle beschaffen und prüfen."
  ]);
});

test("reviewed wording stays concise and answers have comparable lengths", () => {
  const bank = createModelQuestionBank(slideIds);
  assert.equal(new Set(bank.map((question) => question.text)).size, 32);
  for (const question of bank) {
    assert.ok(question.text.length <= 200, question.text);
    assert.ok(question.explanation.length <= 220, question.text);
    assert.equal((question.text.match(/\?/g) ?? []).length, 1, question.text);
    const lengths = question.answers.map((answer) => answer.text.length);
    assert.ok(Math.max(...lengths) <= 90, question.text);
    assert.ok(Math.max(...lengths) - Math.min(...lengths) <= 40, question.text);
    for (const text of [question.text, question.explanation, ...question.answers.map((answer) => answer.text)]) {
      assert.ok(text.trim().length > 0);
      assert.equal(text, text.trim());
      assert.doesNotMatch(text, /[\r\n]|<[^>]+>|\.\.\./);
    }
  }
});

test("callers cannot mutate the authored bank through a previous result", () => {
  const changed = createModelQuestionBank(slideIds);
  const pristine = createModelQuestionBank(slideIds);
  changed[0].text = "Edited by caller";
  changed[0].answers[0].text = "Edited answer";
  changed[0].answers[0].correct = !changed[0].answers[0].correct;
  changed[0].answers.reverse();
  changed.pop();
  assert.deepEqual(createModelQuestionBank(slideIds), pristine);
});

test("demo copy review preserves the four answer keys, levels and points", () => {
  assert.deepEqual(demoLecture.questions.map((question) => ({
    level: question.level,
    points: question.points,
    keys: question.answers.map((answer) => answer.key),
    correct: question.answers.filter((answer) => answer.correct).map((answer) => answer.key)
  })), levels.map((level, index) => ({
    level,
    points: index + 1,
    keys: ["A", "B", "C", "D"],
    correct: [index % 2 === 0 ? "B" : "A"]
  })));
});

test("database seed uses the same reviewed questions as newly created lectures", () => {
  const seedSource = readFileSync(new URL("../../scripts/admin.mjs", import.meta.url), "utf8");
  for (const question of demoLecture.questions) {
    for (const text of [question.text, question.explanation, ...question.answers.map((answer) => answer.text)]) {
      assert.ok(seedSource.includes(JSON.stringify(text)), `Database seed has stale wording: ${text}`);
    }
  }
});
