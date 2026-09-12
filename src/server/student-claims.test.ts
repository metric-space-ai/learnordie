import assert from "node:assert/strict";
import test from "node:test";

import type { StudentEnrollment, StudentProfile } from "@/lib/types";
import {
  anonymizeClaim,
  applyClaim,
  isUniqueViolation,
  migrateEnrollmentClaims,
  PseudonymTakenError,
  rankingDisplayName
} from "./student-claims";

function profile(id: string, pseudonym: string): StudentProfile {
  return {
    id,
    anonymousKey: `key-${id}`,
    pseudonym,
    locale: "de",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastSeenAt: "2026-01-01T00:00:00.000Z"
  };
}

function enrollment(partial: Partial<StudentEnrollment> & Pick<StudentEnrollment, "id" | "studentProfileId">): StudentEnrollment {
  return {
    seriesId: "maschinenelemente-i",
    seriesTitle: "Maschinenelemente I",
    source: "code",
    status: "active",
    addedAt: "2026-01-01T00:00:00.000Z",
    ...partial
  };
}

test("T01 second claim of the same normalized name is rejected", () => {
  const first = enrollment({ id: "e1", studentProfileId: "p1" });
  const second = enrollment({ id: "e2", studentProfileId: "p2" });
  const all = [first, second];
  applyClaim(first, "Lager-Kim", all);
  assert.throws(() => applyClaim(second, "  lager-kim  ", all), (error: unknown) => error instanceof PseudonymTakenError);
});

test("same participant reclaiming the same name is idempotent", () => {
  const row = enrollment({ id: "e1", studentProfileId: "p1" });
  applyClaim(row, "Lager-Kim", [row]);
  applyClaim(row, "lager-kim", [row]);
  assert.equal(row.displayNameNormalized, "lager-kim");
});

test("T15 two names for the same profile collapse to one active claim", () => {
  const first = enrollment({ id: "e1", studentProfileId: "p1", addedAt: "2026-01-01T00:00:00.000Z" });
  const extra = enrollment({ id: "e2", studentProfileId: "p1", addedAt: "2026-01-02T00:00:00.000Z" });
  applyClaim(first, "Welle-1", [first]);
  applyClaim(extra, "Welle-2", [first, extra]);
  assert.equal(extra.status, "active");
  assert.equal(extra.displayName, "Welle-2");
  assert.equal(first.status, "removed");
});

test("T16 rename to a taken name leaves the previous claim unchanged", () => {
  const first = enrollment({ id: "e1", studentProfileId: "p1" });
  const second = enrollment({ id: "e2", studentProfileId: "p2" });
  applyClaim(first, "Nabe-A", [first, second]);
  applyClaim(second, "Nabe-B", [first, second]);
  assert.throws(() => applyClaim(second, "Nabe-A", [first, second]), (error: unknown) => error instanceof PseudonymTakenError);
  assert.equal(second.displayName, "Nabe-B");
});

test("T14 altbestand migrates twice without changing assigned names", () => {
  const profiles = [
    profile("student_aaa111", "Keilspalt"),
    profile("student_bbb222", "Keilspalt"),
    profile("student_ccc333", "Anonymisiert"),
    profile("student_ddd444", "X".repeat(60)),
    profile("student_eee555", "Alt")
  ];
  const enrollments = [
    enrollment({ id: "e1", studentProfileId: "student_aaa111" }),
    enrollment({ id: "e2", studentProfileId: "student_bbb222" }),
    enrollment({ id: "e3", studentProfileId: "student_ccc333", displayName: "anonym" }),
    enrollment({ id: "e4", studentProfileId: "student_ddd444", displayName: "X".repeat(60) }),
    enrollment({ id: "e5", studentProfileId: "student_eee555", status: "removed", displayName: "Keilspalt" }),
    enrollment({ id: "e6", studentProfileId: "student_eee555", status: "anonymized", displayName: "Zahnrad-Joe" })
  ];
  assert.equal(migrateEnrollmentClaims(profiles, enrollments), true);
  const firstPass = enrollments.map((item) => `${item.id}:${item.status}:${item.displayName}`);
  assert.equal(migrateEnrollmentClaims(profiles, enrollments), false);
  const secondPass = enrollments.map((item) => `${item.id}:${item.status}:${item.displayName}`);
  assert.deepEqual(secondPass, firstPass);
  const activeNames = enrollments.filter((item) => item.status === "active").map((item) => item.displayNameNormalized);
  assert.equal(new Set(activeNames).size, activeNames.length);
  assert.ok(enrollments[3]!.displayName!.length <= 40);
  assert.notEqual(enrollments[5]!.displayName, "Zahnrad-Joe");
  assert.match(enrollments[5]!.displayName ?? "", /^Anonym/i);
});

test("released names can be reused without mixing ranking labels", () => {
  const oldRow = enrollment({
    id: "old",
    studentProfileId: "p-old",
    status: "removed",
    displayName: "Keilspalt",
    displayNameNormalized: "keilspalt"
  });
  const fresh = enrollment({ id: "new", studentProfileId: "p-new" });
  applyClaim(fresh, "Keilspalt", [oldRow, fresh]);
  assert.notEqual(rankingDisplayName(oldRow, "p-old"), "Keilspalt");
  assert.equal(fresh.displayName, "Keilspalt");
});

test("anonymizeClaim replaces a personal name", () => {
  const row = enrollment({ id: "e1", studentProfileId: "student_zzz999", displayName: "Zahnrad-Joe" });
  anonymizeClaim(row, [row]);
  assert.equal(row.status, "anonymized");
  assert.notEqual(row.displayName, "Zahnrad-Joe");
});

test("T06 thirty active claims stay unique after migration", () => {
  const profiles = Array.from({ length: 30 }, (_, index) => profile(`student_${index}`, "Keilspalt"));
  const enrollments = profiles.map((item, index) =>
    enrollment({
      id: `e${index}`,
      studentProfileId: item.id,
      addedAt: `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`
    })
  );
  migrateEnrollmentClaims(profiles, enrollments);
  migrateEnrollmentClaims(profiles, enrollments);
  const names = enrollments.map((item) => item.displayNameNormalized);
  assert.equal(new Set(names).size, 30);
});

test("postgres unique-violation mapper recognizes 23505", () => {
  assert.equal(isUniqueViolation({ code: "23505" }), true);
  assert.equal(isUniqueViolation({ cause: { code: "23505" } }), true);
  assert.equal(isUniqueViolation(new Error("other")), false);
});
