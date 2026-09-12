import {
  anonymizedDisplayName,
  migratedDisplayName,
  pseudonymKey,
  suggestPseudonyms,
  validateClaimablePseudonym
} from "@/lib/student-pseudonym";
import type { StudentEnrollment, StudentProfile } from "@/lib/types";

export class PseudonymTakenError extends Error {
  pseudonym: string;
  seriesId?: string;
  constructor(pseudonym: string, seriesId?: string) {
    super("Dieses Pseudonym ist schon vergeben.");
    this.name = "PseudonymTakenError";
    this.pseudonym = pseudonym;
    this.seriesId = seriesId;
  }
}

export class ClaimRequiredError extends Error {
  constructor() {
    super("Bitte zuerst ein Pseudonym für diese Vorlesung wählen.");
    this.name = "ClaimRequiredError";
  }
}

export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; cause?: unknown };
  if (record.code === "23505") return true;
  if (record.cause && typeof record.cause === "object" && (record.cause as { code?: unknown }).code === "23505") {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /duplicate key|unique constraint|23505/i.test(message);
}

export function activeSeriesEnrollments(enrollments: StudentEnrollment[], seriesId: string) {
  return enrollments.filter((item) => item.status === "active" && item.seriesId === seriesId);
}

export function takenKeysForSeries(
  enrollments: StudentEnrollment[],
  seriesId: string,
  exceptProfileId?: string
): Set<string> {
  const keys = new Set<string>();
  for (const enrollment of activeSeriesEnrollments(enrollments, seriesId)) {
    if (exceptProfileId && enrollment.studentProfileId === exceptProfileId) continue;
    if (!enrollment.displayNameNormalized && !enrollment.displayName) continue;
    keys.add(enrollment.displayNameNormalized || pseudonymKey(enrollment.displayName ?? ""));
  }
  return keys;
}

export function findActiveClaim(
  enrollments: StudentEnrollment[],
  profileId: string,
  seriesId: string
): StudentEnrollment | undefined {
  return enrollments.find(
    (item) =>
      item.status === "active" &&
      item.studentProfileId === profileId &&
      item.seriesId === seriesId
  );
}

export function findRankingEnrollment(
  enrollments: StudentEnrollment[],
  profileId: string,
  seriesId: string
): StudentEnrollment | undefined {
  const matches = enrollments.filter(
    (item) => item.studentProfileId === profileId && item.seriesId === seriesId
  );
  return (
    matches.find((item) => item.status === "active") ??
    matches.find((item) => item.status === "anonymized") ??
    [...matches].sort((left, right) =>
      (right.lastOpenedAt ?? right.addedAt).localeCompare(left.lastOpenedAt ?? left.addedAt)
    )[0]
  );
}

export function suggestionsForSeries(
  enrollments: StudentEnrollment[],
  seriesId: string,
  count = 3,
  exceptProfileId?: string,
  extraExclude: Iterable<string> = []
): string[] {
  const exclude = takenKeysForSeries(enrollments, seriesId, exceptProfileId);
  for (const name of extraExclude) {
    const key = pseudonymKey(name);
    if (key) exclude.add(key);
  }
  return suggestPseudonyms({
    count,
    exclude
  });
}

function collapseDuplicateActiveClaims(enrollments: StudentEnrollment[]): boolean {
  const newestFirst = [...enrollments]
    .filter((item) => item.status === "active")
    .sort((left, right) =>
      (right.lastOpenedAt ?? right.addedAt).localeCompare(left.lastOpenedAt ?? left.addedAt) ||
      right.id.localeCompare(left.id)
    );
  const seen = new Set<string>();
  let changed = false;
  for (const enrollment of newestFirst) {
    const key = `${enrollment.studentProfileId}:${enrollment.seriesId}`;
    if (seen.has(key)) {
      enrollment.status = "removed";
      changed = true;
      continue;
    }
    seen.add(key);
  }
  return changed;
}

export function applyClaim(
  enrollment: StudentEnrollment,
  displayName: string,
  enrollments: StudentEnrollment[]
): StudentEnrollment {
  const name = validateClaimablePseudonym(displayName);
  if (!name) throw new Error("INVALID_PSEUDONYM");
  const taken = takenKeysForSeries(enrollments, enrollment.seriesId, enrollment.studentProfileId);
  if (taken.has(pseudonymKey(name))) throw new PseudonymTakenError(name, enrollment.seriesId);
  for (const other of enrollments) {
    if (
      other !== enrollment &&
      other.status === "active" &&
      other.studentProfileId === enrollment.studentProfileId &&
      other.seriesId === enrollment.seriesId
    ) {
      other.status = "removed";
    }
  }
  enrollment.displayName = name;
  enrollment.displayNameNormalized = pseudonymKey(name);
  enrollment.status = "active";
  return enrollment;
}

export function anonymizeClaim(
  enrollment: StudentEnrollment,
  enrollments: StudentEnrollment[]
): StudentEnrollment {
  const taken = enrollments
    .filter(
      (item) =>
        item.status === "anonymized" &&
        item.seriesId === enrollment.seriesId &&
        item.id !== enrollment.id
    )
    .map((item) => item.displayName ?? "");
  const name = anonymizedDisplayName(enrollment.studentProfileId, taken);
  enrollment.status = "anonymized";
  enrollment.displayName = name;
  enrollment.displayNameNormalized = pseudonymKey(name);
  return enrollment;
}

export function rankingDisplayName(
  claim: StudentEnrollment | null | undefined,
  profileId: string
): string {
  if (claim?.status === "active" && claim.displayName) {
    return claim.displayName.slice(0, 40);
  }
  return anonymizedDisplayName(claim?.studentProfileId || profileId, []);
}

export function migrateEnrollmentClaims(profiles: StudentProfile[], enrollments: StudentEnrollment[]): boolean {
  let changed = collapseDuplicateActiveClaims(enrollments);

  const bySeries = new Map<string, StudentEnrollment[]>();
  for (const enrollment of enrollments) {
    if (enrollment.status !== "active") continue;
    const list = bySeries.get(enrollment.seriesId) ?? [];
    list.push(enrollment);
    bySeries.set(enrollment.seriesId, list);
  }

  for (const list of bySeries.values()) {
    list.sort((left, right) => left.addedAt.localeCompare(right.addedAt) || left.id.localeCompare(right.id));
    const assigned = new Set<string>();
    for (const enrollment of list) {
      const current = enrollment.displayName ?? "";
      const valid = validateClaimablePseudonym(current);
      const keepable = Boolean(valid && !assigned.has(pseudonymKey(valid)));
      if (keepable && valid) {
        if (enrollment.displayName !== valid || enrollment.displayNameNormalized !== pseudonymKey(valid)) {
          enrollment.displayName = valid;
          enrollment.displayNameNormalized = pseudonymKey(valid);
          changed = true;
        }
        assigned.add(pseudonymKey(valid));
        continue;
      }

      const profile = profiles.find((item) => item.id === enrollment.studentProfileId);
      const name = migratedDisplayName(
        valid ?? profile?.pseudonym ?? "Teilnehmer",
        enrollment.studentProfileId,
        assigned
      );
      if (enrollment.displayName !== name || enrollment.displayNameNormalized !== pseudonymKey(name)) {
        enrollment.displayName = name;
        enrollment.displayNameNormalized = pseudonymKey(name);
        changed = true;
      }
      assigned.add(pseudonymKey(name));
    }
  }

  const anonymizedBySeries = new Map<string, StudentEnrollment[]>();
  for (const enrollment of enrollments) {
    if (enrollment.status !== "anonymized") continue;
    const list = anonymizedBySeries.get(enrollment.seriesId) ?? [];
    list.push(enrollment);
    anonymizedBySeries.set(enrollment.seriesId, list);
  }
  for (const list of anonymizedBySeries.values()) {
    list.sort((left, right) => left.studentProfileId.localeCompare(right.studentProfileId) || left.id.localeCompare(right.id));
    const assigned = new Set<string>();
    for (const enrollment of list) {
      const name = anonymizedDisplayName(enrollment.studentProfileId, assigned);
      if (enrollment.displayName !== name || enrollment.displayNameNormalized !== pseudonymKey(name)) {
        enrollment.displayName = name;
        enrollment.displayNameNormalized = pseudonymKey(name);
        changed = true;
      }
      assigned.add(pseudonymKey(name));
    }
  }

  return changed;
}
