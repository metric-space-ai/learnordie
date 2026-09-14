import assert from "node:assert/strict";
import test from "node:test";
import { isValidRouteEntityId, isValidSeriesId, UUID_PATTERN } from "./route-params";

test("model UUIDv8 survives route validation and canonical repository lookup", () => {
  for (const id of ["dc5f697a-f158-8ac9-822e-bcb22dd9adb2", "39504208-0e83-8131-9ac7-76b1e165114c", "d1428313-9a26-4017-b556-74a7db10639e"]) {
    assert.equal(UUID_PATTERN.test(id), true);
    assert.equal(isValidRouteEntityId(id), true);
    assert.equal(isValidSeriesId(id), true);
  }
});

test("UUID compatibility does not admit malformed entity IDs", () => {
  for (const id of ["dc5f697a-f158-0ac9-822e-bcb22dd9adb2", "dc5f697a-f158-9ac9-822e-bcb22dd9adb2", "dc5f697a-f158-8ac9-722e-bcb22dd9adb2", "../lecture", "' or true --", ""]) {
    assert.equal(UUID_PATTERN.test(id), false);
    assert.equal(isValidRouteEntityId(id), false);
  }
  assert.equal(isValidRouteEntityId("lecture_demo"), true);
  assert.equal(isValidSeriesId("gleitlagerung-demo"), true);
  assert.equal(isValidSeriesId("../lecture"), false);
});
