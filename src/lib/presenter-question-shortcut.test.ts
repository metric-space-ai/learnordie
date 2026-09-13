import assert from "node:assert/strict";
import test from "node:test";
import { presenterQuestionShortcut } from "./presenter-question-shortcut.ts";

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
