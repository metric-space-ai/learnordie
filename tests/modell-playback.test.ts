import assert from "node:assert/strict";
import test from "node:test";
import { createModellSceneState, resetModellLearning, trainModellStep } from "../packages/slide-engine/src/scenes/modell-state";
import { modellSceneKeys } from "../packages/slide-engine/src/scenes/modell-types";
import { modellIsPlaying, setModellPlaying, toggleModellPlaying } from "../packages/slide-engine/src/scenes/modell-playback";

test("reduced-motion runtime starts inactive and begins execution only after play", () => {
  const state = createModellSceneState(false);
  assert.equal(state.executing, false);
  assert.equal(modellIsPlaying("runtime", state), false);
  state.inputX = -.7;
  toggleModellPlaying("runtime", state);
  assert.equal(state.executing, true);
  assert.equal(state.outputAngle, -42);
  assert.equal(modellIsPlaying("runtime", state), true);
});

for (const key of modellSceneKeys) {
  test(`${key}: play/pause/resume controls the effective simulation state`, () => {
    const state = createModellSceneState(false);
    assert.equal(modellIsPlaying(key, state), false);
    toggleModellPlaying(key, state);
    assert.equal(modellIsPlaying(key, state), true);
    toggleModellPlaying(key, state);
    assert.equal(modellIsPlaying(key, state), false);
    toggleModellPlaying(key, state);
    assert.equal(modellIsPlaying(key, state), true);
  });
}
test("global play starts learning, pause preserves coefficients, resume advances them", () => {
  const state = createModellSceneState(true);
  assert.equal(modellIsPlaying("learning", state), false);
  toggleModellPlaying("learning", state);
  trainModellStep(state, .1);
  assert.ok(state.steps > 0);
  const before = [...state.a];
  setModellPlaying("learning", state, false);
  trainModellStep(state, .1);
  assert.deepEqual(state.a, before);
  toggleModellPlaying("learning", state);
  trainModellStep(state, .1);
  assert.notDeepEqual(state.a, before);
  resetModellLearning(state);
  assert.equal(modellIsPlaying("learning", state), false);
  toggleModellPlaying("learning", state);
  trainModellStep(state, .1);
  assert.ok(state.steps > 0);
});
test("completed learning can restart without resetting the learned coefficients", () => {
  const state = createModellSceneState(true);
  state.steps = state.trainingLimit;
  const coefficients = [...state.a];
  toggleModellPlaying("learning", state);
  assert.equal(state.trainingLimit, 1000);
  assert.deepEqual(state.a, coefficients);
  trainModellStep(state, .1);
  assert.ok(state.steps > 600);
});
test("runtime restart applies the current input even after it changed while paused", () => {
  const state = createModellSceneState(true);
  toggleModellPlaying("runtime", state);
  state.inputX = -.7;
  toggleModellPlaying("runtime", state);
  assert.equal(state.executing, true);
  assert.equal(state.outputAngle, -42);
});
