import assert from "node:assert/strict";
import test from "node:test";
import { LiveOperationScope } from "@/lib/live-operation-scope";

test("polling and slide changes in the same session preserve in-flight work", () => {
  const scope = new LiveOperationScope();
  assert.equal(scope.capture(), null);
  scope.setSession("first");
  const operation = scope.capture();
  assert.equal(scope.setSession("first"), false);
  assert.equal(scope.isCurrent(operation), true);
});

test("session replacement aborts old audio and rejects its late result", async () => {
  const scope = new LiveOperationScope();
  scope.setSession("first");
  const audio = scope.capture();
  const lateResult = Promise.resolve().then(() => scope.isCurrent(audio));
  scope.setSession("second");
  assert.equal(audio?.signal.aborted, true);
  assert.equal(await lateResult, false);
  assert.equal(scope.capture()?.sessionId, "second");
});

test("ending or leaving a session invalidates outstanding question generation", () => {
  const scope = new LiveOperationScope();
  scope.setSession("first");
  const question = scope.capture();
  scope.setSession(null);
  assert.equal(scope.isCurrent(question), false);
  assert.equal(question?.signal.aborted, true);
  scope.setSession("first");
  assert.equal(scope.isCurrent(question), false);
  const resumed = scope.capture();
  scope.dispose();
  assert.equal(resumed?.signal.aborted, true);
  assert.equal(scope.isCurrent(resumed), false);
});
