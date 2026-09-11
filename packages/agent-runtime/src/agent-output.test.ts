import assert from "node:assert/strict";
import test from "node:test";

import { extractReplacementText } from "./index";

test("extracts structured slide copy without exposing model reasoning", () => {
  assert.equal(
    extractReplacementText('<think>private reasoning</think>{"replacementText":"Kurzer Folientext","summary":"ok"}'),
    "Kurzer Folientext"
  );
});

test("rejects unstructured or unfinished reasoning output", () => {
  assert.equal(extractReplacementText("<think>unfinished private reasoning"), "");
  assert.equal(extractReplacementText("unstructured model commentary"), "");
});
