import assert from "node:assert/strict";
import test from "node:test";
import { participationUrl } from "@/lib/participation-url";

test("preview studio and presentation use the canonical short classroom URL", () => {
  const preview = "https://learn-buddy-preview.vercel.app";
  const expected = "https://learnordie.app/l/DT-01";
  assert.equal(participationUrl("/join/DT-01", "https://learnordie.app", preview), expected);
  assert.equal(participationUrl("/l/DT-01", "https://learnordie.app", preview), expected);
});

test("local origin is only a fallback and URL paths are not duplicated", () => {
  assert.equal(participationUrl("/l/DT-01", "https://learnordie.app/base/", "http://localhost:3070"), "https://learnordie.app/l/DT-01");
  assert.equal(participationUrl("/join/TEST-01", "invalid", "http://localhost:3070"), "http://localhost:3070/l/TEST-01");
  assert.equal(participationUrl("/l/DT-01", undefined), "/l/DT-01");
});
