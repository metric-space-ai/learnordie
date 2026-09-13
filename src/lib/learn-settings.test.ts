import assert from "node:assert/strict";
import test from "node:test";
import { learnQuestionCadenceLabel, learnQuestionInterval, normalizeLearnQuestionDensity, shouldOfferLearnQuestion } from "./learn-settings";

test("each density has a real, monotonically shorter slide interval", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(learnQuestionInterval), [7, 6, 5, 4, 3, 2, 1]);
  assert.equal(learnQuestionCadenceLabel(1), "alle 7 Folien");
  assert.equal(learnQuestionCadenceLabel(7), "jede Folie");
  assert.equal(normalizeLearnQuestionDensity("invalid"), 4);
  assert.equal(learnQuestionInterval(99), 1);
  assert.equal(learnQuestionInterval(-1), 7);
});

test("practice cadence counts completed slides, not difficulty shortcuts", () => {
  for (let density = 1; density <= 7; density += 1) {
    const interval = learnQuestionInterval(density);
    for (let completedSlides = 0; completedSlides <= 7; completedSlides += 1) {
      assert.equal(shouldOfferLearnQuestion({ density, completedSlides, atEnd: false, hasQuestions: true }), completedSlides >= interval);
    }
  }
});

test("short decks get a final prompt, but missing questions never trap navigation", () => {
  assert.equal(shouldOfferLearnQuestion({ density: 1, completedSlides: 3, atEnd: true, hasQuestions: true }), true);
  assert.equal(shouldOfferLearnQuestion({ density: 1, completedSlides: 0, atEnd: true, hasQuestions: true }), false);
  assert.equal(shouldOfferLearnQuestion({ density: 7, completedSlides: 12, atEnd: true, hasQuestions: false }), false);
});
