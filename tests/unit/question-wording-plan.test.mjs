import assert from "node:assert/strict";
import test from "node:test";
import { buildWordingPlan, wordingFingerprint } from "../../scripts/lib/question-wording-plan.mjs";

const lectureId = "00000000-0000-4000-8000-000000000001";
const familyId = "00000000-0000-4000-8000-000000000002";
function fixture() {
  const questions = ["4.0", "3.0", "2.0", "1.0"].map((level) => ({
    familyId, level, text: "Welche Aussage aus Abschn. 1.1 stimmt?",
    answers: ["A", "B", "C", "D"].map((key) => ({ key, text: `Antwort ${key}`, correct: key === "C" })),
    explanation: "Das Skript begründet C.",
  }));
  return {
    inventory: { lectureId, questions },
    review: { lectureId, families: [{ familyId, variants: questions.map((question) => ({
      level: question.level, expectedFingerprint: wordingFingerprint(question),
      text: "Warum vereinfacht ein Modell die Wirklichkeit?",
      explanation: "Es hebt die für seine Aufgabe wesentlichen Eigenschaften hervor.",
      reason: "Replaces an unavailable section reference with the substantive question.",
    })) }] },
  };
}

test("compiles four-level private plan without mutating inventory or claiming DB application", () => {
  const { inventory, review } = fixture();
  const before = structuredClone(inventory);
  const plan = buildWordingPlan(inventory, review);
  assert.equal(plan.changes.length, 4);
  assert.equal(plan.databaseApplied, false);
  assert.equal(plan.fullyReviewed, true);
  assert.deepEqual(inventory, before);
  assert.equal(plan.changes[0].replacement.answers[2].correct, true);
});

test("fingerprints ignore object property and answer order, but capture changed text and correctness", () => {
  const { inventory } = fixture();
  const original = inventory.questions[0];
  const reordered = { explanation: original.explanation, answers: [...original.answers].reverse(), text: original.text };
  assert.equal(wordingFingerprint(original), wordingFingerprint(reordered));
  assert.notEqual(wordingFingerprint(original), wordingFingerprint({ ...original, text: "Andere Frage?" }));
  assert.notEqual(wordingFingerprint(original), wordingFingerprint({
    ...original, answers: original.answers.map((answer) => ({ ...answer, correct: answer.key === "A" })),
  }));
});

test("rejects stale reviews, wrong lecture, missing or duplicate levels, and grading changes", () => {
  const mutations = [
    ({ inventory }) => { inventory.questions[0].text = "Später bearbeitet?"; },
    ({ review }) => { review.lectureId = familyId; },
    ({ review }) => { review.families[0].variants.pop(); },
    ({ review }) => { review.families[0].variants[1].level = "4.0"; },
    ({ inventory, review }) => { review.families[0].variants[0].answers = inventory.questions[0].answers.map((answer) => ({ ...answer, correct: answer.key === "A" })); },
  ];
  for (const mutate of mutations) {
    const data = fixture();
    mutate(data);
    assert.throws(() => buildWordingPlan(data.inventory, data.review));
  }
});

test("rejects source-dependent stems, answers and explanations", () => {
  for (const field of ["text", "explanation", "answers"]) {
    const { inventory, review } = fixture();
    const variant = review.families[0].variants[0];
    if (field === "answers") variant.answers = inventory.questions[0].answers.map((answer) => ({ ...answer, text: `${answer.text} laut der Folie` }));
    else variant[field] = "Wie in Abschn. 1.1 erklärt.";
    assert.throws(() => buildWordingPlan(inventory, review), /Source-dependent/);
  }
});

test("partial inventory review cannot be reported as full review", () => {
  const { inventory, review } = fixture();
  inventory.questions.push(...inventory.questions.map((question) => ({ ...question, familyId: "00000000-0000-4000-8000-000000000003" })));
  const plan = buildWordingPlan(inventory, review);
  assert.equal(plan.fullyReviewed, false);
  assert.equal(plan.totalFamilies, 2);
  assert.equal(plan.reviewedFamilies, 1);
});

test("rejects missing answers, duplicates and nonboolean correctness", () => {
  for (const mutate of [
    (answers) => answers.pop(),
    (answers) => { answers[0].text = answers[1].text; },
    (answers) => { answers[0].key = answers[1].key; },
    (answers) => { answers[0].correct = "false"; },
  ]) {
    const { inventory, review } = fixture();
    const answers = structuredClone(inventory.questions[0].answers);
    mutate(answers);
    review.families[0].variants[0].answers = answers;
    assert.throws(() => buildWordingPlan(inventory, review));
  }
});
