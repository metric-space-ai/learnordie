import assert from "node:assert/strict";
import test from "node:test";
import { canvasFingerprint, isCanvasGestureActive } from "./canvas-sync";

test("schema property normalization must not echo a native edit back into its gesture", () => {
  const native = { elements: [{ id: "a", type: "text", text: "Hello", version: 2, customData: { z: 1, a: 2 }, omitted: undefined }], files: {} };
  const persisted = { files: {}, elements: [{ type: "text", id: "a", version: 2, text: "Hello", customData: { a: 2, z: 1 } }] };
  assert.equal(canvasFingerprint(native), canvasFingerprint(persisted));
  assert.notEqual(canvasFingerprint(native), canvasFingerprint({ ...native, elements: [{ ...native.elements[0], text: "Changed" }] }));
  assert.notEqual(canvasFingerprint({ elements: [1, 2] }), canvasFingerprint({ elements: [2, 1] }));
});

test("intermediate drawing, text input and resize states remain owned by native editor", () => {
  for (const state of [{ cursorButton: "down" }, { newElement: {} }, { editingTextElement: {} }, { resizingElement: {} }, { isResizing: true }, { isRotating: true }]) {
    assert.equal(isCanvasGestureActive(state), true);
  }
  assert.equal(isCanvasGestureActive({ cursorButton: "up", newElement: null, editingTextElement: null, isResizing: false }), false);
});
