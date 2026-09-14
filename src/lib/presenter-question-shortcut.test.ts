import assert from "node:assert/strict";
import test from "node:test";
import { presenterQuestionShortcut } from "@/lib/presenter-question-shortcut";
import { preparedQuestionFamiliesForSlide } from "@/lib/questions";
import type { QuestionVariant } from "@/lib/types";

test("prepared Space families belong to the current slide and never use live or incomplete families", () => {
  const family = (id: string, slideId: string | undefined, source = "material") => ["4.0", "3.0", "2.0", "1.0"].map(level => ({familyId:id, slideId, familySource:source, level, reviewStatus:"approved"} as QuestionVariant));
  const questions = [...family("current", "slide-a"), ...family("other", "slide-b"), ...family("live", "slide-a", "live_transcript"), ...family("student", "slide-a", "student_question"), ...family("incomplete", "slide-a").slice(0, 3)];
  assert.deepEqual(preparedQuestionFamiliesForSlide(questions, "slide-a").map(f=>f[0].familyId), ["current"]);
  assert.deepEqual(preparedQuestionFamiliesForSlide(questions, "slide-c"), []);
  assert.deepEqual(preparedQuestionFamiliesForSlide(family("legacy", undefined), "slide-c").map(f=>f[0].familyId), ["legacy"]);
});

const space = {
  code: "Space", shiftKey: false, metaKey: false, ctrlKey: false,
  altKey: false, repeat: false, isComposing: false,
};

test("Space fires a normal round; Shift+Space fires only a transcript round", () => {
  assert.equal(presenterQuestionShortcut(space), "slide");
  assert.equal(presenterQuestionShortcut({ ...space, shiftKey: true }), "transcript-only");
});

test("L is no longer a question shortcut", () => {
  assert.equal(presenterQuestionShortcut({ ...space, code: "KeyL" }), null);
  assert.equal(presenterQuestionShortcut({ ...space, code: "KeyL", shiftKey: true }), null);
});

test("held keys, composition and system shortcuts never fire a round", () => {
  for (const shiftKey of [false, true]) {
    for (const flag of ["repeat", "isComposing", "metaKey", "ctrlKey", "altKey"] as const) {
      assert.equal(presenterQuestionShortcut({ ...space, shiftKey, [flag]: true }), null);
    }
  }
});
