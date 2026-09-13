import assert from "node:assert/strict";
import test from "node:test";
import { canvasFingerprint, canvasFitMinimum, canvasZoomAtCentre, isCanvasGestureActive } from "./canvas-sync";

test("schema property normalization must not echo a native edit back into its gesture", () => {
  const native = { elements: [{ id: "a", type: "text", text: "Hello", version: 2, customData: { z: 1, a: 2 }, omitted: undefined }], files: {} };
  const persisted = { files: {}, elements: [{ type: "text", id: "a", version: 2, text: "Hello", customData: { a: 2, z: 1 } }] };
  assert.equal(canvasFingerprint(native), canvasFingerprint(persisted));
  assert.notEqual(canvasFingerprint(native), canvasFingerprint({ ...native, elements: [{ ...native.elements[0], text: "Changed" }] }));
  assert.notEqual(canvasFingerprint({ elements: [1, 2] }), canvasFingerprint({ elements: [2, 1] }));
});

test("intermediate drawing, text input and resize states remain owned by native editor", () => {
  for (const state of [{ cursorButton: "down" }, { pendingImageElementId: "image-awaiting-bytes" }, { newElement: {} }, { editingTextElement: {} }, { resizingElement: {} }, { isResizing: true }, { isRotating: true }]) {
    assert.equal(isCanvasGestureActive(state), true);
  }
  assert.equal(isCanvasGestureActive({ cursorButton: "up", pendingImageElementId: null, newElement: null, editingTextElement: null, isResizing: false }), false);
});

test("mobile fit uses available width without rounding down to a tiny slide", () => {
  const elements = [{ x: 40, y: 80, width: 1280, height: 500 }];
  assert.equal(canvasFitMinimum(elements, 390, 600), 0.92 * 390 / 1280);
  assert.equal(canvasFitMinimum(elements, 1280, 900), undefined);
  assert.equal(canvasFitMinimum([], 390, 600), undefined);
  assert.equal(canvasFitMinimum(elements, 0, 600), undefined);
  assert.equal(canvasFitMinimum([...elements, { x: -9000, y: 0, width: 100, height: 100, isDeleted: true }], 390, 600), canvasFitMinimum(elements, 390, 600));
});

test("mobile fit includes rotated bounds and the available height", () => {
  const rotated = [{ x: 0, y: 0, width: 1000, height: 100, angle: Math.PI / 2 }];
  assert.ok(Math.abs(canvasFitMinimum(rotated, 390, 500)! - 0.46) < 1e-10);
});

test("reader zoom preserves the same scene point at the viewport centre", () => {
  const state = { width: 390, height: 700, zoom: { value: 0.25 }, scrollX: -120, scrollY: 70 };
  const zoomed = canvasZoomAtCentre(state, 1.5)!;
  assert.equal(zoomed.zoom.value, 0.375);
  for (const [size, scroll] of [["width", "scrollX"], ["height", "scrollY"]] as const) {
    const before = state[size] / (2 * state.zoom.value) - state[scroll];
    const after = state[size] / (2 * zoomed.zoom.value) - zoomed[scroll];
    assert.ok(Math.abs(before - after) < 1e-10);
  }
  const restored = canvasZoomAtCentre({ ...state, ...zoomed }, 1 / 1.5)!;
  assert.deepEqual(restored, { zoom: state.zoom, scrollX: state.scrollX, scrollY: state.scrollY });
  assert.equal(state.zoom.value, 0.25);
});

test("reader zoom is bounded and rejects incomplete native viewport state", () => {
  const state = { width: 390, height: 700, zoom: { value: 1 }, scrollX: 0, scrollY: 0 };
  assert.equal(canvasZoomAtCentre(state, 100)!.zoom.value, 4);
  assert.equal(canvasZoomAtCentre(state, 0.001)!.zoom.value, 0.1);
  for (const invalid of [{}, { ...state, width: 0 }, { ...state, zoom: { value: 0 } }, { ...state, scrollX: NaN }]) {
    assert.equal(canvasZoomAtCentre(invalid, 1.5), null);
  }
  assert.equal(canvasZoomAtCentre(state, -1), null);
});
