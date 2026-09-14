import assert from "node:assert/strict";
import test from "node:test";
import { demoLecture } from "./demo-data";
import { learnQuestionFamilies, normalizeLearnQuestionDensity, visibleLearnQuestionFamilies } from "./learn-settings";
import type { QuestionLevel } from "./types";

const levels: QuestionLevel[] = ["4.0", "3.0", "2.0", "1.0"];
const family = (familyId: string, slideId?: string) => levels.map((level) => ({
  ...demoLecture.questions[0], familyId, slideId, level
}));

test("density controls distinct complete question spots, not difficulty or navigation cadence", () => {
  const families = learnQuestionFamilies(Array.from({ length: 8 }, (_, i) => family(`f-${i}`, "slide-a")).flat(), "slide-a");
  for (let density = 1; density <= 7; density += 1) {
    const visible = visibleLearnQuestionFamilies(families, density);
    assert.equal(visible.length, density);
    assert.equal(new Set(visible.map((group) => group[0].familyId)).size, density);
    visible.forEach((group) => assert.deepEqual(new Set(group.map((question) => question.level)), new Set(levels)));
  }
  assert.equal(visibleLearnQuestionFamilies(families.slice(0, 1), 7).length, 1);
  assert.equal(normalizeLearnQuestionDensity("invalid"), 4);
  assert.equal(normalizeLearnQuestionDensity(99), 7);
  assert.equal(normalizeLearnQuestionDensity(-1), 1);
});

test("spots belong to the current slide, with lecture-wide fallback only", () => {
  const questions = [...family("local", "slide-a"), ...family("other", "slide-b"), ...family("general")];
  assert.deepEqual(learnQuestionFamilies(questions, "slide-a").map((group) => group[0].familyId), ["local"]);
  assert.deepEqual(learnQuestionFamilies(questions, "slide-c").map((group) => group[0].familyId), ["general"]);
  assert.equal(learnQuestionFamilies(family("other", "slide-b"), "slide-a").length, 0);
});

test("an incomplete or duplicate-level family is not offered as a four-level spot", () => {
  assert.equal(learnQuestionFamilies(family("partial").slice(0, 3)).length, 0);
  const duplicate = family("duplicate");
  duplicate[3].level = "2.0";
  assert.equal(learnQuestionFamilies(duplicate).length, 0);
});
