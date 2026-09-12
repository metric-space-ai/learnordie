import assert from "node:assert/strict";
import test from "node:test";

import {
  anonymizedDisplayName,
  migratedDisplayName,
  normalizePseudonym,
  PSEUDONYM_MAX_LENGTH,
  pseudonymKey,
  suggestPseudonyms,
  suggestionsWithoutRejected,
  validateClaimablePseudonym
} from "./student-pseudonym";

test("T03 normalizes unicode, space and case", () => {
  assert.equal(normalizePseudonym("  Zahnrad  Joe  "), "Zahnrad Joe");
  assert.equal(pseudonymKey("Keilspalt"), pseudonymKey("KEILSPALT"));
  assert.equal(pseudonymKey("Ä"), "ä");
  assert.equal(validateClaimablePseudonym("x"), null);
  assert.equal(validateClaimablePseudonym("   "), null);
  assert.equal(validateClaimablePseudonym("Anonymisiert"), null);
  assert.equal(validateClaimablePseudonym("anonym"), null);
  assert.equal(validateClaimablePseudonym("Pseudonym"), null);
});

test("T04 truncates at 40 so later characters cannot distinguish claims", () => {
  const long = `Welle-${"x".repeat(50)}`;
  const valid = validateClaimablePseudonym(long);
  assert.equal(valid?.length, PSEUDONYM_MAX_LENGTH);
  const a = validateClaimablePseudonym(`${"A".repeat(40)}ONE`);
  const b = validateClaimablePseudonym(`${"A".repeat(40)}TWO`);
  assert.equal(a, b);
});

test("migration suffix is deterministic and unique", () => {
  const first = migratedDisplayName("Keilspalt", "student_aaa111", ["Keilspalt"]);
  const again = migratedDisplayName("Keilspalt", "student_aaa111", ["Keilspalt"]);
  const other = migratedDisplayName("Keilspalt", "student_bbb222", ["Keilspalt", first]);
  assert.equal(first, again);
  assert.notEqual(first, "Keilspalt");
  assert.notEqual(first, other);
  assert.ok(first.length <= 40);
});

test("anonymized labels never equal reserved or personal base names", () => {
  const name = anonymizedDisplayName("student_abc123", []);
  assert.notEqual(pseudonymKey(name), "anonymisiert");
  assert.notEqual(pseudonymKey(name), "anonym");
  assert.match(name, /^Anonym·/);
  assert.equal(anonymizedDisplayName("student_abc123", []), name);
});

test("suggestions skip taken names and stay unique", () => {
  const names = suggestPseudonyms({ count: 3, exclude: ["Zahnrad-Joe"] });
  assert.equal(names.length, 3);
  assert.equal(new Set(names.map(pseudonymKey)).size, 3);
  assert.ok(!names.map(pseudonymKey).includes("zahnrad-joe"));
});

test("conflict suggestions drop the rejected name", () => {
  const filtered = suggestionsWithoutRejected(["Keilspalt-Scout", "Kette-86", "Feder-42"], "Keilspalt-Scout");
  assert.equal(filtered.length, 2);
  assert.ok(!filtered.map(pseudonymKey).includes(pseudonymKey("Keilspalt-Scout")));
});
