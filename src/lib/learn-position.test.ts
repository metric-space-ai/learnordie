import assert from "node:assert/strict";
import test from "node:test";
import { savedLearnSlideIndex } from "./learn-position";

test("study resume follows slide identity through reordering and safely handles removed or invalid positions", () => {
  const slides = [{id:"intro"}, {id:"formula"}, {id:"application"}];
  assert.equal(savedLearnSlideIndex("formula", slides), 1);
  assert.equal(savedLearnSlideIndex("formula", [slides[1], slides[0], slides[2]]), 0);
  for (const missing of [null, "", "deleted", "99", "-1"]) assert.equal(savedLearnSlideIndex(missing, slides), 0);
  assert.equal(savedLearnSlideIndex("formula", []), 0);
});
