import assert from "node:assert/strict";
import test from "node:test";
import { createModelQuestionBank } from "../src/lib/model-question-bank";

const slideIds = Array.from({ length: 8 }, (_, i) => `original-slide-${i + 1}`);
test("all eight original slides retain a complete standalone four-level question family", () => {
  const questions = createModelQuestionBank(slideIds);
  assert.equal(questions.length, 32);
  for (const slideId of slideIds) {
    const family = questions.filter(q => q.slideId === slideId);
    assert.deepEqual(family.map(q => q.level), ["4.0", "3.0", "2.0", "1.0"]);
    assert.equal(new Set(family.map(q => q.familyId)).size, 1);
    for (const q of family) {
      assert.equal(q.answers.length, 4);
      assert.equal(q.answers.filter(a => a.correct).length, 1);
      assert.equal(new Set(q.answers.map(a => a.text)).size, 4);
      assert.doesNotMatch(q.text, /Abschn\.?|Kapitel|Seite\s+\d|Skript|Manuskript|Vorlesung|Demo|Begriffsgang|betrachtete LLM/i);
      assert.ok(q.text.length <= 210, q.text);
      assert.equal(q.promptVersion, "model-question-bank-standalone-v2");
    }
  }
});
test("calculation and parameter-learning questions supply their scenario locally", () => {
  const questions = createModelQuestionBank(slideIds);
  const servo = questions.find(q => q.slideId === slideIds[4] && q.level === "2.0")!;
  assert.match(servo.text, /y = 60° · x/);
  assert.match(servo.text, /x = 0,5/);
  assert.match(servo.answers.find(a => a.correct)!.text, /30°/);
  const learning = questions.find(q => q.slideId === slideIds[5] && q.level === "4.0")!;
  assert.match(learning.text, /a₀ \+ a₁x \+ a₂x²/);
  assert.match(learning.text, /festem Polynomgrad/);
});
