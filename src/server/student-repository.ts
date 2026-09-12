// Student, enrollment, and join-code repository.
//
// All student-facing data access goes through this contract. The Local and Postgres
// implementations MUST satisfy the same interface — no feature may work only locally.
//
// In local mode "series" are derived from lectures grouped by slugify(seriesTitle);
// in Postgres mode the real lecture_series rows are used. Either way a join code is a
// deliberate, human-readable product object and never falls back to demo content.

import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs/promises";
import path from "node:path";

import { and, desc, eq, sql } from "drizzle-orm";

import { normalizeJoinCode, sanitizeJoinCode } from "@/lib/join-code";
import { QA_MECHANICS_JOIN_CODE, QA_MECHANICS_SERIES_TITLE } from "@/lib/qa-fixture-mechanics";
import { lectureStudentView } from "@/lib/lecture-status";
import { seriesIdForLecture } from "@/lib/series";
import { suggestPseudonyms, validateClaimablePseudonym } from "@/lib/student-pseudonym";
import {
  anonymizeClaim,
  applyClaim,
  ClaimRequiredError,
  findActiveClaim,
  findRankingEnrollment,
  isUniqueViolation,
  migrateEnrollmentClaims,
  PseudonymTakenError,
  suggestionsForSeries
} from "./student-claims";
import type {
  EnrollmentSource,
  JoinCode,
  Lecture,
  ReadinessSnapshot,
  ResolvedJoinTarget,
  StudentDashboard,
  StudentDashboardEvent,
  StudentDashboardSeries,
  StudentEnrollment,
  StudentProfile
} from "@/lib/types";
import { getAnalyticsRepository, type AnalyticsEventRecord } from "./analytics-repository";
import { getDb } from "./db/client";
import { UUID_PATTERN } from "./route-params";
import { joinCodes, lectures as lecturesTable, lectureSeries, studentEnrollments, studentProfiles } from "./db/schema";
import { slugify } from "./lecture-factory";
import { computeReadinessSnapshot, type ReadinessAnswerSignal } from "./readiness";
import { getLectureRepository } from "./repository";

const STORE_PATH = path.join(process.cwd(), ".data", "learnbuddy-students.json");

export type GetOrCreateStudentProfileInput = {
  anonymousKey: string;
  pseudonym?: string;
  locale?: string;
};

export type SeriesShareInfo = {
  seriesId: string;
  seriesTitle: string;
  joinCode?: string;
  joinPath?: string;
  enabled: boolean;
};

export type CreateDirectEnrollmentInput = {
  seriesId: string;
  seriesTitle: string;
  lectureId?: string;
  source: EnrollmentSource;
  displayName?: string;
};

export interface StudentRepository {
  getOrCreateStudentProfile(input: GetOrCreateStudentProfileInput): Promise<StudentProfile>;
  getProfileById(profileId: string): Promise<StudentProfile | null>;
  getProfileByAnonymousKey(anonymousKey: string): Promise<StudentProfile | null>;
  updateStudentPseudonym(profileId: string, pseudonym: string): Promise<StudentProfile | null>;
  listAvailablePseudonyms(
    seriesId: string,
    count?: number,
    exceptProfileId?: string,
    extraExclude?: Iterable<string>
  ): Promise<string[]>;
  getActiveClaim(profileId: string, seriesId: string): Promise<StudentEnrollment | null>;
  getClaimByAnonymousKey(anonymousKey: string, seriesId: string): Promise<StudentEnrollment | null>;
  getRankingClaim(anonymousKey: string, seriesId: string): Promise<StudentEnrollment | null>;
  claimDisplayName(profileId: string, seriesId: string, displayName: string): Promise<StudentEnrollment>;
  anonymizeEnrollment(profileId: string, enrollmentId: string): Promise<StudentEnrollment | null>;
  resolveJoinCode(code: string): Promise<ResolvedJoinTarget | null>;
  createEnrollmentFromJoinCode(
    profileId: string,
    joinCodeId: string,
    source?: EnrollmentSource,
    displayName?: string
  ): Promise<StudentEnrollment | null>;
  createDirectEnrollment(profileId: string, input: CreateDirectEnrollmentInput): Promise<StudentEnrollment | null>;
  removeEnrollment(profileId: string, enrollmentId: string): Promise<boolean>;
  touchEnrollment(profileId: string, seriesId: string): Promise<void>;
  listStudentDashboard(profileId: string): Promise<StudentDashboard | null>;
  listStudentSeries(profileId: string): Promise<StudentDashboardSeries[]>;
  getStudentSeriesDetail(profileId: string, seriesId: string): Promise<StudentDashboardSeries | null>;
  setLectureSeriesJoinCode(userId: string | undefined, seriesId: string, code: string): Promise<JoinCode>;
  disableJoinCode(userId: string | undefined, joinCodeId: string): Promise<JoinCode | null>;
  getShareInfoForSeries(userId: string | undefined, seriesId: string): Promise<SeriesShareInfo | null>;
  computeReadiness(profileId: string, seriesId: string): Promise<ReadinessSnapshot | null>;
  migrateEnrollmentClaims(): Promise<void>;
}

export { ClaimRequiredError, PseudonymTakenError };

// ── Shared helpers ──────────────────────────────────────────────────────────

function nowIso() {
  return new Date().toISOString();
}

function preferredName(profile: StudentProfile, fallback?: string) {
  if (fallback !== undefined && !validateClaimablePseudonym(fallback)) throw new Error("INVALID_PSEUDONYM");
  return validateClaimablePseudonym(fallback ?? "") ?? validateClaimablePseudonym(profile.pseudonym) ?? "Teilnehmer";
}

function withinWindow(code: JoinCode, now = new Date()): boolean {
  if (code.startsAt && new Date(code.startsAt).getTime() > now.getTime()) return false;
  if (code.expiresAt && new Date(code.expiresAt).getTime() < now.getTime()) return false;
  return true;
}

type SeriesGroup = {
  seriesId: string;
  seriesTitle: string;
  language: string;
  examDate?: string;
  lectures: Lecture[];
};

function ownsLocalSeries(email: string | undefined, group: SeriesGroup | undefined): boolean {
  if (!email || !group?.lectures.length) return false;
  const owner = email.trim().toLowerCase();
  // Local ownerless fixtures remain shared. A mixed-owner legacy slug is never
  // sufficient authority to mutate or reveal another teacher's join code.
  return group.lectures.every((lecture) => !lecture.ownerEmail || lecture.ownerEmail.toLowerCase() === owner);
}

function groupLecturesBySeries(lectures: Lecture[]): Map<string, SeriesGroup> {
  const map = new Map<string, SeriesGroup>();
  for (const lecture of lectures) {
    const seriesId = seriesIdForLecture(lecture);
    const group = map.get(seriesId) ?? {
      seriesId,
      seriesTitle: lecture.seriesTitle,
      language: lecture.language,
      examDate: lecture.examDate,
      lectures: []
    };
    group.lectures.push(lecture);
    // Latest exam date across the series wins.
    if (lecture.examDate && (!group.examDate || lecture.examDate > group.examDate)) {
      group.examDate = lecture.examDate;
    }
    map.set(seriesId, group);
  }
  return map;
}

function toDashboardEvent(lecture: Lecture, now: Date): StudentDashboardEvent {
  const view = lectureStudentView(lecture, now);
  return {
    lectureId: lecture.id,
    publicToken: lecture.publicToken,
    title: lecture.title,
    status: lecture.status,
    bucket: view.bucket,
    liveAt: lecture.liveAt,
    examDate: lecture.examDate,
    aiAccessUntil: lecture.aiAccessUntil,
    aiAccessActive: view.aiAccessActive,
    liveAvailable: view.liveAvailable,
    learnAvailable: view.learnAvailable
  };
}

function answerSignalsForStudent(events: AnalyticsEventRecord[], anonymousKey: string, tokens: Set<string>): ReadinessAnswerSignal[] {
  const signals: ReadinessAnswerSignal[] = [];
  for (const event of events) {
    if (event.eventType !== "answer_selected") continue;
    if (event.anonymousKey !== anonymousKey) continue;
    if (!event.lectureToken || !tokens.has(event.lectureToken)) continue;
    const level = event.payload.level;
    if (level !== "4.0" && level !== "3.0" && level !== "2.0" && level !== "1.0") continue;
    signals.push({
      lectureToken: event.lectureToken,
      level,
      correct: event.payload.correct === true
    });
  }
  return signals;
}

function learnMarkerCount(events: AnalyticsEventRecord[], anonymousKey: string, tokens: Set<string>): number {
  return events.filter(
    (event) =>
      event.eventType === "learn_marker_opened" &&
      event.anonymousKey === anonymousKey &&
      event.lectureToken &&
      tokens.has(event.lectureToken)
  ).length;
}

function buildSeriesView(
  group: SeriesGroup,
  enrollment: StudentEnrollment,
  joinCode: string | undefined,
  readiness: ReadinessSnapshot | undefined,
  now: Date
): StudentDashboardSeries {
  const events = group.lectures
    .map((lecture) => toDashboardEvent(lecture, now))
    .sort((left, right) => left.liveAt.localeCompare(right.liveAt));

  return {
    enrollmentId: enrollment.id,
    seriesId: group.seriesId,
    seriesTitle: group.seriesTitle,
    displayName: enrollment.displayName,
    language: group.language,
    examDate: group.examDate,
    joinCode,
    source: enrollment.source,
    addedAt: enrollment.addedAt,
    lastOpenedAt: enrollment.lastOpenedAt,
    events,
    liveNow: events.filter((event) => event.bucket === "live"),
    upcoming: events.filter((event) => event.bucket === "upcoming"),
    learn: events.filter((event) => event.bucket === "learn"),
    readiness
  };
}

// ── Local implementation ─────────────────────────────────────────────────────

type LocalStudentData = {
  profiles: StudentProfile[];
  joinCodes: JoinCode[];
  enrollments: StudentEnrollment[];
};

async function ensureStudentStore() {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  try {
    await fs.access(STORE_PATH);
  } catch {
    await writeStudentStore({ profiles: [], joinCodes: [], enrollments: [] });
  }
}

async function readStudentStore(): Promise<LocalStudentData> {
  await ensureStudentStore();
  const data = JSON.parse(await fs.readFile(STORE_PATH, "utf8")) as Partial<LocalStudentData>;
  return {
    profiles: data.profiles ?? [],
    joinCodes: data.joinCodes ?? [],
    enrollments: data.enrollments ?? []
  };
}

async function writeStudentStore(data: LocalStudentData) {
  const tmp = `${STORE_PATH}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await fs.rename(tmp, STORE_PATH);
}

let storeLock: Promise<void> = Promise.resolve();
const studentStoreContext = new AsyncLocalStorage<boolean>();

function withStudentStoreLock<T>(fn: () => Promise<T>): Promise<T> {
  if (studentStoreContext.getStore()) return fn();
  const guarded = () => studentStoreContext.run(true, fn);
  const run = storeLock.then(guarded, guarded);
  storeLock = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function seedQaJoinCode(store: LocalStudentData): Promise<boolean> {
  const seriesId = slugify(QA_MECHANICS_SERIES_TITLE);
  const normalized = sanitizeJoinCode(QA_MECHANICS_JOIN_CODE);
  if (!normalized) return false;
  if (store.joinCodes.some((item) => item.enabled && item.normalizedCode === normalized)) return false;
  const now = nowIso();
  store.joinCodes.push({
    id: `joincode_${crypto.randomUUID()}`,
    code: normalizeJoinCode(QA_MECHANICS_JOIN_CODE),
    normalizedCode: normalized,
    scope: "series",
    seriesId,
    enabled: true,
    createdAt: now,
    updatedAt: now
  });
  return true;
}

async function readStudentStoreMigrated(): Promise<LocalStudentData> {
  return withStudentStoreLock(async () => {
  const store = await readStudentStore();
  const migrated = migrateEnrollmentClaims(store.profiles, store.enrollments);
  const seeded = await seedQaJoinCode(store);
  if (migrated || seeded) {
    await writeStudentStore(store);
  }
  return store;
  });
}

class LocalStudentRepository implements StudentRepository {
  private async loadSeriesIndex(): Promise<Map<string, SeriesGroup>> {
    const lectures = await getLectureRepository().listLectures();
    return groupLecturesBySeries(lectures);
  }

  async getOrCreateStudentProfile(input: GetOrCreateStudentProfileInput): Promise<StudentProfile> {
    return withStudentStoreLock(async () => {
      const store = await readStudentStoreMigrated();
      const existing = store.profiles.find((profile) => profile.anonymousKey === input.anonymousKey);
      if (existing) {
        existing.lastSeenAt = nowIso();
        if (input.pseudonym && input.pseudonym.trim()) {
          const name = validateClaimablePseudonym(input.pseudonym);
          if (!name) throw new Error("INVALID_PSEUDONYM");
          existing.pseudonym = name;
        }
        if (input.locale) existing.locale = input.locale;
        await writeStudentStore(store);
        return existing;
      }

      const name = validateClaimablePseudonym(input.pseudonym ?? "") ?? suggestPseudonyms({ count: 1 })[0] ?? "Teilnehmer";
      const profile: StudentProfile = {
        id: `student_${crypto.randomUUID()}`,
        anonymousKey: input.anonymousKey,
        pseudonym: name,
        locale: input.locale ?? "de",
        createdAt: nowIso(),
        lastSeenAt: nowIso()
      };
      store.profiles.push(profile);
      await writeStudentStore(store);
      return profile;
    });
  }

  async getProfileById(profileId: string): Promise<StudentProfile | null> {
    const store = await readStudentStore();
    return store.profiles.find((profile) => profile.id === profileId) ?? null;
  }

  async getProfileByAnonymousKey(anonymousKey: string): Promise<StudentProfile | null> {
    const store = await readStudentStore();
    return store.profiles.find((profile) => profile.anonymousKey === anonymousKey) ?? null;
  }

  async updateStudentPseudonym(profileId: string, pseudonym: string): Promise<StudentProfile | null> {
    const name = validateClaimablePseudonym(pseudonym);
    if (!name) return null;
    return withStudentStoreLock(async () => {
      const store = await readStudentStoreMigrated();
      const profile = store.profiles.find((item) => item.id === profileId);
      if (!profile) return null;
      profile.pseudonym = name;
      profile.lastSeenAt = nowIso();
      await writeStudentStore(store);
      return profile;
    });
  }

  async listAvailablePseudonyms(
    seriesId: string,
    count = 3,
    exceptProfileId?: string,
    extraExclude?: Iterable<string>
  ): Promise<string[]> {
    const store = await readStudentStoreMigrated();
    return suggestionsForSeries(store.enrollments, seriesId, count, exceptProfileId, extraExclude);
  }

  async getActiveClaim(profileId: string, seriesId: string): Promise<StudentEnrollment | null> {
    const store = await readStudentStoreMigrated();
    return findActiveClaim(store.enrollments, profileId, seriesId) ?? null;
  }

  async getClaimByAnonymousKey(anonymousKey: string, seriesId: string): Promise<StudentEnrollment | null> {
    const store = await readStudentStoreMigrated();
    const profile = store.profiles.find((item) => item.anonymousKey === anonymousKey);
    if (!profile) return null;
    return findActiveClaim(store.enrollments, profile.id, seriesId) ?? null;
  }

  async getRankingClaim(anonymousKey: string, seriesId: string): Promise<StudentEnrollment | null> {
    const store = await readStudentStoreMigrated();
    const profile = store.profiles.find((item) => item.anonymousKey === anonymousKey);
    if (!profile) return null;
    return findRankingEnrollment(store.enrollments, profile.id, seriesId) ?? null;
  }

  async claimDisplayName(profileId: string, seriesId: string, displayName: string): Promise<StudentEnrollment> {
    return withStudentStoreLock(async () => {
      const store = await readStudentStoreMigrated();
      const enrollment = findActiveClaim(store.enrollments, profileId, seriesId);
      if (!enrollment) throw new ClaimRequiredError();
      applyClaim(enrollment, displayName, store.enrollments);
      await writeStudentStore(store);
      return enrollment;
    });
  }

  async anonymizeEnrollment(profileId: string, enrollmentId: string): Promise<StudentEnrollment | null> {
    return withStudentStoreLock(async () => {
      const store = await readStudentStoreMigrated();
      const enrollment = store.enrollments.find(
        (item) => item.id === enrollmentId && item.studentProfileId === profileId
      );
      if (!enrollment) return null;
      anonymizeClaim(enrollment, store.enrollments);
      await writeStudentStore(store);
      return enrollment;
    });
  }

  async migrateEnrollmentClaims(): Promise<void> {
    await withStudentStoreLock(async () => {
      const store = await readStudentStoreMigrated();
      await writeStudentStore(store);
    });
  }

  async resolveJoinCode(code: string): Promise<ResolvedJoinTarget | null> {
    const normalized = sanitizeJoinCode(code);
    if (!normalized) return null;
    const store = await readStudentStore();
    const joinCode = store.joinCodes.find((item) => item.enabled && item.normalizedCode === normalized);
    if (!joinCode || !withinWindow(joinCode)) return null;

    const seriesIndex = await this.loadSeriesIndex();

    if (joinCode.scope === "lecture" && joinCode.lectureId) {
      const lectures = await getLectureRepository().listLectures();
      const lecture = lectures.find((item) => item.id === joinCode.lectureId);
      if (!lecture) return null; // target gone — no demo fallback
      return {
        joinCode,
        scope: "lecture",
        seriesId: seriesIdForLecture(lecture),
        seriesTitle: lecture.seriesTitle,
        lectureId: lecture.id,
        lectureToken: lecture.publicToken,
        lectureTitle: lecture.title,
        lectureStatus: lecture.status
      };
    }

    const group = joinCode.seriesId ? seriesIndex.get(joinCode.seriesId) : undefined;
    if (!group) return null; // target gone — no demo fallback
    return {
      joinCode,
      scope: "series",
      seriesId: group.seriesId,
      seriesTitle: group.seriesTitle
    };
  }

  private async createEnrollmentInternal(
    store: LocalStudentData,
    profileId: string,
    target: {
      seriesId: string;
      seriesTitle: string;
      lectureId?: string;
      joinCodeId?: string;
      source: EnrollmentSource;
      displayName?: string;
    }
  ): Promise<StudentEnrollment> {
    const profile = store.profiles.find((item) => item.id === profileId);
    const existing = store.enrollments.find(
      (item) => item.studentProfileId === profileId && item.seriesId === target.seriesId && item.status === "active"
    );
    if (existing) {
      existing.lastOpenedAt = nowIso();
      if (target.lectureId) existing.lectureId = target.lectureId;
      if (target.joinCodeId) existing.joinCodeId = target.joinCodeId;
      if (target.displayName) applyClaim(existing, target.displayName, store.enrollments);
      else if (!existing.displayName) {
        applyClaim(existing, preferredName(profile!, target.displayName), store.enrollments);
      }
      return existing;
    }

    const enrollment: StudentEnrollment = {
      id: `enroll_${crypto.randomUUID()}`,
      studentProfileId: profileId,
      seriesId: target.seriesId,
      seriesTitle: target.seriesTitle,
      lectureId: target.lectureId,
      joinCodeId: target.joinCodeId,
      source: target.source,
      status: "active",
      addedAt: nowIso(),
      lastOpenedAt: nowIso()
    };
    store.enrollments.push(enrollment);
    applyClaim(enrollment, preferredName(profile!, target.displayName), store.enrollments);
    return enrollment;
  }

  async createEnrollmentFromJoinCode(
    profileId: string,
    joinCodeId: string,
    source: EnrollmentSource = "code",
    displayName?: string
  ): Promise<StudentEnrollment | null> {
    return withStudentStoreLock(async () => {
      const store = await readStudentStoreMigrated();
      const profile = store.profiles.find((item) => item.id === profileId);
      const joinCode = store.joinCodes.find((item) => item.id === joinCodeId && item.enabled);
      if (!profile || !joinCode || !withinWindow(joinCode)) return null;

      let seriesId = joinCode.seriesId;
      let seriesTitle: string | undefined;
      let lectureId = joinCode.scope === "lecture" ? joinCode.lectureId : undefined;

      const lectures = await getLectureRepository().listLectures();
      if (joinCode.scope === "lecture" && joinCode.lectureId) {
        const lecture = lectures.find((item) => item.id === joinCode.lectureId);
        if (!lecture) return null;
        seriesId = seriesIdForLecture(lecture);
        seriesTitle = lecture.seriesTitle;
        lectureId = lecture.id;
      } else if (seriesId) {
        const group = groupLecturesBySeries(lectures).get(seriesId);
        if (!group) return null;
        seriesTitle = group.seriesTitle;
      }

      if (!seriesId || !seriesTitle) return null;

      const enrollment = await this.createEnrollmentInternal(store, profileId, {
        seriesId,
        seriesTitle,
        lectureId,
        joinCodeId: joinCode.id,
        source,
        displayName
      });
      await writeStudentStore(store);
      return enrollment;
    });
  }

  async createDirectEnrollment(profileId: string, input: CreateDirectEnrollmentInput): Promise<StudentEnrollment | null> {
    return withStudentStoreLock(async () => {
      const store = await readStudentStoreMigrated();
      const profile = store.profiles.find((item) => item.id === profileId);
      if (!profile) return null;
      const group = (await this.loadSeriesIndex()).get(input.seriesId);
      if (!group || (input.lectureId && !group.lectures.some((lecture) => lecture.id === input.lectureId))) return null;
      const enrollment = await this.createEnrollmentInternal(store, profileId, {
        seriesId: input.seriesId,
        seriesTitle: group.seriesTitle,
        lectureId: input.lectureId,
        source: input.source,
        displayName: input.displayName
      });
      await writeStudentStore(store);
      return enrollment;
    });
  }

  async removeEnrollment(profileId: string, enrollmentId: string): Promise<boolean> {
    return withStudentStoreLock(async () => {
      const store = await readStudentStoreMigrated();
      const enrollment = store.enrollments.find(
        (item) => item.id === enrollmentId && item.studentProfileId === profileId
      );
      if (!enrollment) return false;
      enrollment.status = "removed";
      await writeStudentStore(store);
      return true;
    });
  }

  async touchEnrollment(profileId: string, seriesId: string): Promise<void> {
    return withStudentStoreLock(async () => {
    const store = await readStudentStore();
    const enrollment = store.enrollments.find(
      (item) => item.studentProfileId === profileId && item.seriesId === seriesId && item.status === "active"
    );
    if (!enrollment) return;
    enrollment.lastOpenedAt = nowIso();
    await writeStudentStore(store);
    });
  }

  async listStudentDashboard(profileId: string): Promise<StudentDashboard | null> {
    const store = await readStudentStore();
    const profile = store.profiles.find((item) => item.id === profileId);
    if (!profile) return null;
    const series = await this.composeSeriesViews(profile, store, undefined);
    return {
      profile,
      hasEnrollments: series.length > 0,
      series
    };
  }

  async listStudentSeries(profileId: string): Promise<StudentDashboardSeries[]> {
    const store = await readStudentStore();
    const profile = store.profiles.find((item) => item.id === profileId);
    if (!profile) return [];
    return this.composeSeriesViews(profile, store, undefined);
  }

  async getStudentSeriesDetail(profileId: string, seriesId: string): Promise<StudentDashboardSeries | null> {
    const store = await readStudentStore();
    const profile = store.profiles.find((item) => item.id === profileId);
    if (!profile) return null;
    const series = await this.composeSeriesViews(profile, store, seriesId);
    return series[0] ?? null;
  }

  private async composeSeriesViews(
    profile: StudentProfile,
    store: LocalStudentData,
    onlySeriesId: string | undefined
  ): Promise<StudentDashboardSeries[]> {
    const now = new Date();
    const seriesIndex = await this.loadSeriesIndex();
    const events = await getAnalyticsRepository().listEvents();
    const activeEnrollments = store.enrollments
      .filter((item) => item.studentProfileId === profile.id && item.status === "active")
      .filter((item) => (onlySeriesId ? item.seriesId === onlySeriesId : true))
      .sort((left, right) => (right.lastOpenedAt ?? right.addedAt).localeCompare(left.lastOpenedAt ?? left.addedAt));

    const views: StudentDashboardSeries[] = [];
    for (const enrollment of activeEnrollments) {
      const group = seriesIndex.get(enrollment.seriesId);
      if (!group) continue; // series no longer exists; skip silently
      const tokens = new Set(group.lectures.map((lecture) => lecture.publicToken));
      const readiness = computeReadinessSnapshot({
        profile,
        seriesId: group.seriesId,
        seriesTitle: group.seriesTitle,
        lectures: group.lectures.map((lecture) => {
          const view = lectureStudentView(lecture, now);
          return {
            lectureId: lecture.id,
            publicToken: lecture.publicToken,
            title: lecture.title,
            isPast: view.bucket === "learn",
            isLive: view.bucket === "live",
            isUpcoming: view.bucket === "upcoming"
          };
        }),
        answers: answerSignalsForStudent(events, profile.anonymousKey, tokens),
        learnMarkerCount: learnMarkerCount(events, profile.anonymousKey, tokens)
      });
      const joinCode = store.joinCodes.find(
        (item) => item.enabled && item.scope === "series" && item.seriesId === group.seriesId
      );
      views.push(buildSeriesView(group, enrollment, joinCode?.code, readiness, now));
    }
    return views;
  }

  async setLectureSeriesJoinCode(userId: string | undefined, seriesId: string, code: string): Promise<JoinCode> {
    return withStudentStoreLock(async () => {
    const normalized = sanitizeJoinCode(code);
    if (!normalized) {
      throw new Error("Ungültiger Code. Erlaubt sind Buchstaben, Zahlen und Bindestriche.");
    }
    const store = await readStudentStore();
    const seriesIndex = await this.loadSeriesIndex();
    const group = seriesIndex.get(seriesId);
    if (!ownsLocalSeries(userId, group)) throw new Error("Vorlesungsreihe nicht gefunden.");

    // Conflict: the code is enabled and bound to a different series.
    const conflict = store.joinCodes.find(
      (item) => item.enabled && item.normalizedCode === normalized && !(item.scope === "series" && item.seriesId === seriesId)
    );
    if (conflict) {
      throw new Error("Dieser Code ist bereits für eine andere Vorlesung vergeben. Bitte einen anderen Code wählen.");
    }

    // Reuse an existing series code row if present, else create one. Only one
    // enabled series code per series.
    const existing = store.joinCodes.find((item) => item.scope === "series" && item.seriesId === seriesId);
    const now = nowIso();
    if (existing) {
      existing.code = normalizeJoinCode(code);
      existing.normalizedCode = normalized;
      existing.enabled = true;
      existing.createdByUserId = userId ?? existing.createdByUserId;
      existing.updatedAt = now;
      await writeStudentStore(store);
      return existing;
    }

    const joinCode: JoinCode = {
      id: `joincode_${crypto.randomUUID()}`,
      code: normalizeJoinCode(code),
      normalizedCode: normalized,
      scope: "series",
      seriesId,
      createdByUserId: userId,
      enabled: true,
      createdAt: now,
      updatedAt: now
    };
    store.joinCodes.push(joinCode);
    await writeStudentStore(store);
    return joinCode;
    });
  }

  async disableJoinCode(userId: string | undefined, joinCodeId: string): Promise<JoinCode | null> {
    return withStudentStoreLock(async () => {
    const store = await readStudentStore();
    const joinCode = store.joinCodes.find((item) => item.id === joinCodeId);
    if (!joinCode) return null;
    const seriesIndex = await this.loadSeriesIndex();
    const group = joinCode.scope === "lecture"
      ? [...seriesIndex.values()].find((item) => item.lectures.some((lecture) => lecture.id === joinCode.lectureId))
      : seriesIndex.get(joinCode.seriesId ?? "");
    if (!ownsLocalSeries(userId, group)) return null;
    joinCode.enabled = false;
    joinCode.updatedAt = nowIso();
    await writeStudentStore(store);
    return joinCode;
    });
  }

  async getShareInfoForSeries(userId: string | undefined, seriesId: string): Promise<SeriesShareInfo | null> {
    const store = await readStudentStore();
    const seriesIndex = await this.loadSeriesIndex();
    const group = seriesIndex.get(seriesId);
    if (!group || !ownsLocalSeries(userId, group)) return null;
    const joinCode = store.joinCodes.find(
      (item) => item.enabled && item.scope === "series" && item.seriesId === seriesId
    );
    return {
      seriesId: group.seriesId,
      seriesTitle: group.seriesTitle,
      joinCode: joinCode?.code,
      joinPath: joinCode ? `/join/${encodeURIComponent(joinCode.code)}` : undefined,
      enabled: Boolean(joinCode)
    };
  }

  async computeReadiness(profileId: string, seriesId: string): Promise<ReadinessSnapshot | null> {
    const detail = await this.getStudentSeriesDetail(profileId, seriesId);
    return detail?.readiness ?? null;
  }
}

// ── Postgres implementation ──────────────────────────────────────────────────

class PostgresStudentRepository implements StudentRepository {
  private readonly db = getDb();
  private claimsReady?: Promise<void>;

  private ensureClaimsMigrated(): Promise<void> {
    this.claimsReady ??= this.migrateEnrollmentClaims().catch((error) => {
      this.claimsReady = undefined;
      throw error;
    });
    return this.claimsReady;
  }

  // UUIDs are canonical. Keep old slug links only when globally unambiguous,
  // including for owners: scoping first would let one legacy URL mean two series.
  private async resolveSeriesRow(idOrSlug: string): Promise<typeof lectureSeries.$inferSelect | null> {
    if (UUID_PATTERN.test(idOrSlug)) {
      const [row] = await this.db.select().from(lectureSeries).where(eq(lectureSeries.id, idOrSlug)).limit(1);
      return row ?? null;
    }
    const rows = await this.db.select().from(lectureSeries);
    const matches = rows.filter((row) => slugify(row.title) === idOrSlug);
    return matches.length === 1 ? matches[0] : null;
  }

  private async resolveOwnedSeriesRow(email: string | undefined, idOrSlug: string) {
    if (!email) return null;
    const series = await this.resolveSeriesRow(idOrSlug);
    if (!series?.ownerId) return null;
    const userId = await this.resolveUserId(email);
    return userId && series.ownerId === userId ? series : null;
  }

  async getOrCreateStudentProfile(input: GetOrCreateStudentProfileInput): Promise<StudentProfile> {
    const nextName = input.pseudonym?.trim() ? validateClaimablePseudonym(input.pseudonym) : undefined;
    if (input.pseudonym?.trim() && !nextName) throw new Error("INVALID_PSEUDONYM");
    const [row] = await this.db
      .insert(studentProfiles)
      .values({
        anonymousKey: input.anonymousKey,
        pseudonym: nextName ?? suggestPseudonyms({ count: 1 })[0] ?? "Teilnehmer",
        locale: input.locale ?? "de"
      })
      .onConflictDoUpdate({
        target: studentProfiles.anonymousKey,
        set: {
          lastSeenAt: new Date(),
          ...(nextName ? { pseudonym: nextName } : {}),
          ...(input.locale ? { locale: input.locale } : {})
        }
      })
      .returning();
    return this.mapProfile(row);
  }

  async getProfileById(profileId: string): Promise<StudentProfile | null> {
    const [row] = await this.db.select().from(studentProfiles).where(eq(studentProfiles.id, profileId)).limit(1);
    return row ? this.mapProfile(row) : null;
  }

  async getProfileByAnonymousKey(anonymousKey: string): Promise<StudentProfile | null> {
    const [row] = await this.db.select().from(studentProfiles).where(eq(studentProfiles.anonymousKey, anonymousKey)).limit(1);
    return row ? this.mapProfile(row) : null;
  }

  async updateStudentPseudonym(profileId: string, pseudonym: string): Promise<StudentProfile | null> {
    const name = validateClaimablePseudonym(pseudonym);
    if (!name) return null;
    const [row] = await this.db
      .update(studentProfiles)
      .set({ pseudonym: name, lastSeenAt: new Date() })
      .where(eq(studentProfiles.id, profileId))
      .returning();
    return row ? this.mapProfile(row) : null;
  }

  async listAvailablePseudonyms(
    seriesId: string,
    count = 3,
    exceptProfileId?: string,
    extraExclude?: Iterable<string>
  ): Promise<string[]> {
    await this.ensureClaimsMigrated();
    const series = await this.resolveSeriesRow(seriesId);
    if (!series) return suggestionsForSeries([], seriesId, count, exceptProfileId, extraExclude);
    const rows = await this.db.select().from(studentEnrollments).where(and(eq(studentEnrollments.status, "active"), eq(studentEnrollments.seriesId, series.id)));
    const mapped: StudentEnrollment[] = rows
      .filter((row) => row.seriesId === series.id)
      .map((row) => this.mapEnrollment(row, series.title));
    return suggestionsForSeries(mapped, series.id, count, exceptProfileId, extraExclude);
  }

  async getActiveClaim(profileId: string, seriesId: string): Promise<StudentEnrollment | null> {
    await this.ensureClaimsMigrated();
    const series = await this.resolveSeriesRow(seriesId);
    if (!series) return null;
    const [row] = await this.db
      .select()
      .from(studentEnrollments)
      .where(
        and(
          eq(studentEnrollments.studentProfileId, profileId),
          eq(studentEnrollments.seriesId, series.id),
          eq(studentEnrollments.status, "active")
        )
      )
      .limit(1);
    return row ? this.mapEnrollment(row, series.title) : null;
  }

  async getClaimByAnonymousKey(anonymousKey: string, seriesId: string): Promise<StudentEnrollment | null> {
    const profile = await this.getProfileByAnonymousKey(anonymousKey);
    if (!profile) return null;
    return this.getActiveClaim(profile.id, seriesId);
  }

  async getRankingClaim(anonymousKey: string, seriesId: string): Promise<StudentEnrollment | null> {
    await this.ensureClaimsMigrated();
    const profile = await this.getProfileByAnonymousKey(anonymousKey);
    if (!profile) return null;
    const series = await this.resolveSeriesRow(seriesId);
    if (!series) return null;
    const rows = await this.db
      .select()
      .from(studentEnrollments)
      .where(and(eq(studentEnrollments.studentProfileId, profile.id), eq(studentEnrollments.seriesId, series.id)));
    const mapped = rows.map((row) => this.mapEnrollment(row, series.title));
    return findRankingEnrollment(mapped, profile.id, series.id) ?? null;
  }

  async claimDisplayName(profileId: string, seriesId: string, displayName: string): Promise<StudentEnrollment> {
    const enrollment = await this.getActiveClaim(profileId, seriesId);
    if (!enrollment) throw new ClaimRequiredError();
    const siblings = await this.activeClaimsForSeries(seriesId);
    applyClaim(enrollment, displayName, siblings);
    const series = await this.resolveSeriesRow(seriesId);
    try {
      const [row] = await this.db
        .update(studentEnrollments)
        .set({
          displayName: enrollment.displayName ?? displayName,
          displayNameNormalized: enrollment.displayNameNormalized ?? "",
          lastOpenedAt: new Date()
        })
        .where(and(eq(studentEnrollments.id, enrollment.id), eq(studentEnrollments.status, "active")))
        .returning();
      if (!row) throw new ClaimRequiredError();
      return this.mapEnrollment(row, series?.title ?? enrollment.seriesTitle);
    } catch (error) {
      if (isUniqueViolation(error)) throw new PseudonymTakenError(displayName, seriesId);
      throw error;
    }
  }

  async anonymizeEnrollment(profileId: string, enrollmentId: string): Promise<StudentEnrollment | null> {
    const [row] = await this.db
      .select()
      .from(studentEnrollments)
      .where(and(eq(studentEnrollments.id, enrollmentId), eq(studentEnrollments.studentProfileId, profileId)))
      .limit(1);
    if (!row) return null;
    const series = row.seriesId
      ? (await this.db.select().from(lectureSeries).where(eq(lectureSeries.id, row.seriesId)).limit(1))[0]
      : undefined;
    const mapped = this.mapEnrollment(row, series?.title ?? "");
    const siblings = series ? await this.activeClaimsForSeries(series.id) : [];
    anonymizeClaim(mapped, siblings);
    const [updated] = await this.db
      .update(studentEnrollments)
      .set({
        status: "anonymized",
        displayName: mapped.displayName ?? "",
        displayNameNormalized: mapped.displayNameNormalized ?? ""
      })
      .where(eq(studentEnrollments.id, enrollmentId))
      .returning();
    return this.mapEnrollment(updated, series?.title ?? mapped.seriesTitle);
  }

  async migrateEnrollmentClaims(): Promise<void> {
    await this.db.transaction(async (tx) => {
      // A backfill must not overwrite claims/withdrawals made after its snapshot.
      // This also serializes cold starts across serverless instances.
      await tx.execute(sql`LOCK TABLE student_enrollments IN SHARE ROW EXCLUSIVE MODE`);
      const rows = await tx.select().from(studentEnrollments);
      const profiles = await tx.select().from(studentProfiles);
      const enrollments = rows.map((row) => ({
        ...this.mapEnrollment(row, ""), seriesId: row.seriesId ?? ""
      }));
      if (!migrateEnrollmentClaims(profiles.map((row) => this.mapProfile(row)), enrollments)) return;
      const originals = new Map(rows.map((row) => [row.id, row]));
      const changed = enrollments.filter((entry) => {
        const before = originals.get(entry.id)!;
        return before.status !== entry.status || before.displayName !== (entry.displayName ?? "") ||
          before.displayNameNormalized !== (entry.displayNameNormalized ?? "");
      });
      // Release only changed keys before assignment so normalization cannot clash
      // with an old key scheduled for replacement later in the same transaction.
      for (const entry of changed) {
        await tx.update(studentEnrollments).set({ displayNameNormalized: "", status: entry.status })
          .where(eq(studentEnrollments.id, entry.id));
      }
      for (const entry of changed) {
        await tx.update(studentEnrollments).set({
          status: entry.status,
          displayName: entry.displayName ?? "",
          displayNameNormalized: entry.displayNameNormalized ?? ""
        }).where(eq(studentEnrollments.id, entry.id));
      }
    });
  }

  private async activeClaimsForSeries(seriesId: string): Promise<StudentEnrollment[]> {
    const series = await this.resolveSeriesRow(seriesId);
    if (!series) return [];
    const rows = await this.db
      .select()
      .from(studentEnrollments)
      .where(and(eq(studentEnrollments.seriesId, series.id), eq(studentEnrollments.status, "active")));
    return rows.map((row) => this.mapEnrollment(row, series.title));
  }

  async resolveJoinCode(code: string): Promise<ResolvedJoinTarget | null> {
    const normalized = sanitizeJoinCode(code);
    if (!normalized) return null;
    const [row] = await this.db
      .select()
      .from(joinCodes)
      .where(and(eq(joinCodes.normalizedCode, normalized), eq(joinCodes.enabled, true)))
      .limit(1);
    if (!row) return null;
    const joinCode = this.mapJoinCode(row);
    if (!withinWindow(joinCode)) return null;

    if (joinCode.scope === "lecture" && row.lectureId) {
      const [lecture] = await this.db
        .select({
          id: lecturesTable.id,
          publicToken: lecturesTable.publicToken,
          title: lecturesTable.title,
          status: lecturesTable.status,
          seriesId: lecturesTable.seriesId,
          seriesTitle: lectureSeries.title
        })
        .from(lecturesTable)
        .leftJoin(lectureSeries, eq(lecturesTable.seriesId, lectureSeries.id))
        .where(eq(lecturesTable.id, row.lectureId))
        .limit(1);
      if (!lecture?.seriesId) return null;
      return {
        joinCode,
        scope: "lecture",
        seriesId: lecture.seriesId,
        seriesTitle: lecture.seriesTitle ?? lecture.title,
        lectureId: lecture.id,
        lectureToken: lecture.publicToken,
        lectureTitle: lecture.title,
        lectureStatus: lecture.status
      };
    }

    if (!row.seriesId) return null;
    const [series] = await this.db.select().from(lectureSeries).where(eq(lectureSeries.id, row.seriesId)).limit(1);
    if (!series) return null;
    return {
      joinCode,
      scope: "series",
      seriesId: series.id,
      seriesTitle: series.title
    };
  }

  async createEnrollmentFromJoinCode(
    profileId: string,
    joinCodeId: string,
    source: EnrollmentSource = "code",
    displayName?: string
  ): Promise<StudentEnrollment | null> {
    const [row] = await this.db.select().from(joinCodes).where(and(eq(joinCodes.id, joinCodeId), eq(joinCodes.enabled, true))).limit(1);
    if (!row) return null;
    const joinCode = this.mapJoinCode(row);
    if (!withinWindow(joinCode)) return null;

    let seriesId = row.seriesId ?? undefined;
    let seriesTitle = "Vorlesungsreihe";
    let lectureId = joinCode.scope === "lecture" ? row.lectureId ?? undefined : undefined;

    if (joinCode.scope === "lecture" && row.lectureId) {
      const [lecture] = await this.db
        .select({ id: lecturesTable.id, seriesId: lecturesTable.seriesId, title: lecturesTable.title, seriesTitle: lectureSeries.title })
        .from(lecturesTable)
        .leftJoin(lectureSeries, eq(lecturesTable.seriesId, lectureSeries.id))
        .where(eq(lecturesTable.id, row.lectureId))
        .limit(1);
      if (!lecture) return null;
      seriesId = lecture.seriesId ?? undefined;
      seriesTitle = lecture.seriesTitle ?? lecture.title;
      lectureId = lecture.id;
    } else if (row.seriesId) {
      const [series] = await this.db.select().from(lectureSeries).where(eq(lectureSeries.id, row.seriesId)).limit(1);
      if (!series) return null;
      seriesTitle = series.title;
    }

    return this.upsertEnrollment(profileId, { seriesId, seriesTitle, lectureId, joinCodeId, source, displayName });
  }

  async createDirectEnrollment(profileId: string, input: CreateDirectEnrollmentInput): Promise<StudentEnrollment | null> {
    return this.upsertEnrollment(profileId, {
      seriesId: input.seriesId,
      seriesTitle: input.seriesTitle,
      lectureId: input.lectureId,
      source: input.source,
      displayName: input.displayName
    });
  }

  private async upsertEnrollment(
    profileId: string,
    target: {
      seriesId?: string;
      seriesTitle: string;
      lectureId?: string;
      joinCodeId?: string;
      source: EnrollmentSource;
      displayName?: string;
    }
  ): Promise<StudentEnrollment | null> {
    if (!target.seriesId) return null;
    await this.ensureClaimsMigrated();
    const seriesRow = await this.resolveSeriesRow(target.seriesId);
    if (!seriesRow) return null;
    const seriesUuid = seriesRow.id;
    const seriesTitle = seriesRow.title;
    if (target.lectureId) {
      if (!UUID_PATTERN.test(target.lectureId)) return null;
      const [lecture] = await this.db.select({ id: lecturesTable.id }).from(lecturesTable)
        .where(and(eq(lecturesTable.id, target.lectureId), eq(lecturesTable.seriesId, seriesUuid))).limit(1);
      if (!lecture) return null;
    }
    const profile = await this.getProfileById(profileId);
    if (!profile) return null;
    const name = preferredName(profile, target.displayName);
    try {
    return await this.db.transaction(async (tx) => {
    // Serialize retries for one browser/profile; distinct students are protected
    // by the database's unique active-name index.
    await tx.select({ id: studentProfiles.id }).from(studentProfiles)
      .where(eq(studentProfiles.id, profileId)).for("update");
    const siblings = (await tx.select().from(studentEnrollments).where(and(
      eq(studentEnrollments.seriesId, seriesUuid), eq(studentEnrollments.status, "active")
    ))).map((row) => this.mapEnrollment(row, seriesTitle));
    const existing = await tx
      .select()
      .from(studentEnrollments)
      .where(
        and(
          eq(studentEnrollments.studentProfileId, profileId),
          eq(studentEnrollments.seriesId, seriesUuid),
          eq(studentEnrollments.status, "active")
        )
      )
      .limit(1);
    if (existing[0]) {
      const mapped = this.mapEnrollment(existing[0], seriesTitle);
      if (target.displayName !== undefined) applyClaim(mapped, name, siblings);
      else if (!mapped.displayName) applyClaim(mapped, preferredName(profile), siblings);
      const [updated] = await tx
        .update(studentEnrollments)
        .set({
          lastOpenedAt: new Date(),
          displayName: mapped.displayName,
          displayNameNormalized: mapped.displayNameNormalized ?? "",
          ...(target.lectureId ? { lectureId: target.lectureId } : {}),
          ...(target.joinCodeId ? { joinCodeId: target.joinCodeId } : {})
        })
        .where(eq(studentEnrollments.id, existing[0].id))
        .returning();
      return this.mapEnrollment(updated, seriesTitle);
    }
    const draft: StudentEnrollment = {
      id: "draft",
      studentProfileId: profileId,
      seriesId: seriesUuid,
      seriesTitle,
      source: target.source,
      status: "active",
      addedAt: nowIso()
    };
    applyClaim(draft, preferredName(profile, target.displayName), siblings);
    const [created] = await tx
      .insert(studentEnrollments)
      .values({
        studentProfileId: profileId,
        seriesId: seriesUuid,
        lectureId: target.lectureId,
        joinCodeId: target.joinCodeId,
        source: target.source,
        status: "active",
        displayName: draft.displayName ?? name,
        displayNameNormalized: draft.displayNameNormalized ?? "",
        lastOpenedAt: new Date()
      })
      .returning();
    return this.mapEnrollment(created, seriesTitle);
    });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new PseudonymTakenError(name ?? target.displayName ?? profile.pseudonym, seriesUuid);
      }
      throw error;
    }
  }

  async removeEnrollment(profileId: string, enrollmentId: string): Promise<boolean> {
    const result = await this.db
      .update(studentEnrollments)
      .set({ status: "removed" })
      .where(and(eq(studentEnrollments.id, enrollmentId), eq(studentEnrollments.studentProfileId, profileId)))
      .returning({ id: studentEnrollments.id });
    return result.length > 0;
  }

  async touchEnrollment(profileId: string, seriesId: string): Promise<void> {
    const series = await this.resolveSeriesRow(seriesId);
    if (!series) return;
    await this.db
      .update(studentEnrollments)
      .set({ lastOpenedAt: new Date() })
      .where(
        and(
          eq(studentEnrollments.studentProfileId, profileId),
          eq(studentEnrollments.seriesId, series.id),
          eq(studentEnrollments.status, "active")
        )
      );
  }

  async listStudentDashboard(profileId: string): Promise<StudentDashboard | null> {
    const profile = await this.getProfileById(profileId);
    if (!profile) return null;
    const series = await this.composeSeriesViews(profile, undefined);
    return { profile, hasEnrollments: series.length > 0, series };
  }

  async listStudentSeries(profileId: string): Promise<StudentDashboardSeries[]> {
    const profile = await this.getProfileById(profileId);
    if (!profile) return [];
    return this.composeSeriesViews(profile, undefined);
  }

  async getStudentSeriesDetail(profileId: string, seriesId: string): Promise<StudentDashboardSeries | null> {
    const profile = await this.getProfileById(profileId);
    if (!profile) return null;
    const series = await this.composeSeriesViews(profile, seriesId);
    return series[0] ?? null;
  }

  private async composeSeriesViews(profile: StudentProfile, onlySeriesId: string | undefined): Promise<StudentDashboardSeries[]> {
    await this.ensureClaimsMigrated();
    const requestedSeries = onlySeriesId ? await this.resolveSeriesRow(onlySeriesId) : null;
    if (onlySeriesId && !requestedSeries) return [];
    const now = new Date();
    const enrollmentRows = await this.db
      .select()
      .from(studentEnrollments)
      .where(and(eq(studentEnrollments.studentProfileId, profile.id), eq(studentEnrollments.status, "active")))
      .orderBy(desc(studentEnrollments.lastOpenedAt));
    const events = await getAnalyticsRepository().listEvents();
    const lectures = await getLectureRepository().listLectures();
    const byPgSeries = new Map<string, Lecture[]>();
    for (const lecture of lectures) {
      if (!lecture.seriesId) continue;
      const group = byPgSeries.get(lecture.seriesId) ?? [];
      group.push(lecture);
      byPgSeries.set(lecture.seriesId, group);
    }
    const views: StudentDashboardSeries[] = [];
    const seriesRows = await this.db.select().from(lectureSeries);
    const seriesById = new Map(seriesRows.map((row) => [row.id, row]));

    for (const enrollmentRow of enrollmentRows) {
      const seriesUuid = enrollmentRow.seriesId;
      if (!seriesUuid) continue;
      const seriesRow = seriesById.get(seriesUuid);
      if (!seriesRow) continue;
      if (requestedSeries && seriesUuid !== requestedSeries.id) continue;
      const groupLectures = byPgSeries.get(seriesUuid) ?? [];
      const group: SeriesGroup = {
        seriesId: seriesUuid,
        seriesTitle: seriesRow.title,
        language: seriesRow.language,
        examDate: seriesRow.examDate?.toISOString(),
        lectures: groupLectures
      };
      const tokens = new Set(groupLectures.map((lecture) => lecture.publicToken));
      const enrollment = this.mapEnrollment(enrollmentRow, seriesRow.title);
      const readiness = computeReadinessSnapshot({
        profile,
        seriesId: seriesUuid,
        seriesTitle: seriesRow.title,
        lectures: groupLectures.map((lecture) => {
          const view = lectureStudentView(lecture, now);
          return {
            lectureId: lecture.id,
            publicToken: lecture.publicToken,
            title: lecture.title,
            isPast: view.bucket === "learn",
            isLive: view.bucket === "live",
            isUpcoming: view.bucket === "upcoming"
          };
        }),
        answers: answerSignalsForStudent(events, profile.anonymousKey, tokens),
        learnMarkerCount: learnMarkerCount(events, profile.anonymousKey, tokens)
      });
      const [codeRow] = await this.db
        .select()
        .from(joinCodes)
        .where(and(eq(joinCodes.enabled, true), eq(joinCodes.scope, "series"), eq(joinCodes.seriesId, seriesUuid)))
        .limit(1);
      views.push(buildSeriesView(group, enrollment, codeRow?.code, readiness, now));
    }
    return views;
  }

  async setLectureSeriesJoinCode(userId: string | undefined, seriesId: string, code: string): Promise<JoinCode> {
    const normalized = sanitizeJoinCode(code);
    if (!normalized) throw new Error("Ungültiger Code. Erlaubt sind Buchstaben, Zahlen und Bindestriche.");
    const series = await this.resolveOwnedSeriesRow(userId, seriesId);
    if (!series) throw new Error("Vorlesungsreihe nicht gefunden.");
    const seriesUuid = series.id;

    const conflicts = await this.db.select().from(joinCodes).where(and(eq(joinCodes.normalizedCode, normalized), eq(joinCodes.enabled, true)));
    if (conflicts.some((row) => !(row.scope === "series" && row.seriesId === seriesUuid))) {
      throw new Error("Dieser Code ist bereits für eine andere Vorlesung vergeben. Bitte einen anderen Code wählen.");
    }

    const existing = await this.db.select().from(joinCodes).where(and(eq(joinCodes.scope, "series"), eq(joinCodes.seriesId, seriesUuid))).limit(1);
    if (existing[0]) {
      const [updated] = await this.db
        .update(joinCodes)
        .set({ code: normalizeJoinCode(code), normalizedCode: normalized, enabled: true, updatedAt: new Date(), createdByUserId: userId ? await this.resolveUserId(userId) : existing[0].createdByUserId })
        .where(eq(joinCodes.id, existing[0].id))
        .returning();
      return this.mapJoinCode(updated);
    }

    const [created] = await this.db
      .insert(joinCodes)
      .values({
        code: normalizeJoinCode(code),
        normalizedCode: normalized,
        scope: "series",
        seriesId: seriesUuid,
        createdByUserId: userId ? await this.resolveUserId(userId) : undefined,
        enabled: true
      })
      .returning();
    return this.mapJoinCode(created);
  }

  async disableJoinCode(userId: string | undefined, joinCodeId: string): Promise<JoinCode | null> {
    if (!UUID_PATTERN.test(joinCodeId)) return null;
    const [existing] = await this.db.select().from(joinCodes).where(eq(joinCodes.id, joinCodeId)).limit(1);
    if (!existing) return null;
    let seriesId = existing.seriesId;
    if (existing.scope === "lecture" && existing.lectureId) {
      const [lecture] = await this.db.select({ seriesId: lecturesTable.seriesId }).from(lecturesTable)
        .where(eq(lecturesTable.id, existing.lectureId)).limit(1);
      seriesId = lecture?.seriesId ?? null;
    }
    if (!seriesId || !(await this.resolveOwnedSeriesRow(userId, seriesId))) return null;
    const [row] = await this.db
      .update(joinCodes)
      .set({ enabled: false, updatedAt: new Date() })
      .where(eq(joinCodes.id, joinCodeId))
      .returning();
    return row ? this.mapJoinCode(row) : null;
  }

  async getShareInfoForSeries(userId: string | undefined, seriesId: string): Promise<SeriesShareInfo | null> {
    const series = await this.resolveOwnedSeriesRow(userId, seriesId);
    if (!series) return null;
    const [codeRow] = await this.db
      .select()
      .from(joinCodes)
      .where(and(eq(joinCodes.enabled, true), eq(joinCodes.scope, "series"), eq(joinCodes.seriesId, series.id)))
      .limit(1);
    return {
      seriesId: series.id,
      seriesTitle: series.title,
      joinCode: codeRow?.code,
      joinPath: codeRow ? `/join/${encodeURIComponent(codeRow.code)}` : undefined,
      enabled: Boolean(codeRow)
    };
  }

  async computeReadiness(profileId: string, seriesId: string): Promise<ReadinessSnapshot | null> {
    const detail = await this.getStudentSeriesDetail(profileId, seriesId);
    return detail?.readiness ?? null;
  }

  private async resolveUserId(email: string): Promise<string | undefined> {
    const { users } = await import("./db/schema");
    const [row] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, email.toLowerCase())).limit(1);
    return row?.id;
  }

  private mapProfile(row: typeof studentProfiles.$inferSelect): StudentProfile {
    return {
      id: row.id,
      anonymousKey: row.anonymousKey,
      pseudonym: row.pseudonym,
      emailHash: row.emailHash ?? undefined,
      locale: row.locale,
      createdAt: row.createdAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString()
    };
  }

  private mapJoinCode(row: typeof joinCodes.$inferSelect): JoinCode {
    return {
      id: row.id,
      code: row.code,
      normalizedCode: row.normalizedCode,
      scope: row.scope,
      seriesId: row.seriesId ?? undefined,
      lectureId: row.lectureId ?? undefined,
      createdByUserId: row.createdByUserId ?? undefined,
      enabled: row.enabled,
      startsAt: row.startsAt?.toISOString(),
      expiresAt: row.expiresAt?.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private mapEnrollment(row: typeof studentEnrollments.$inferSelect, seriesTitle: string): StudentEnrollment {
    return {
      id: row.id,
      studentProfileId: row.studentProfileId,
      seriesId: row.seriesId ?? "",
      seriesTitle,
      lectureId: row.lectureId ?? undefined,
      joinCodeId: row.joinCodeId ?? undefined,
      source: row.source,
      status: row.status,
      displayName: row.displayName || undefined,
      displayNameNormalized: row.displayNameNormalized || undefined,
      addedAt: row.addedAt.toISOString(),
      lastOpenedAt: row.lastOpenedAt?.toISOString()
    };
  }
}

let cachedRepository: StudentRepository | null = null;

export function getStudentRepository(): StudentRepository {
  if (process.env.LEARNBUDDY_REPOSITORY !== "local" && process.env.DATABASE_URL) {
    return new PostgresStudentRepository();
  }
  cachedRepository ??= new LocalStudentRepository();
  return cachedRepository;
}
