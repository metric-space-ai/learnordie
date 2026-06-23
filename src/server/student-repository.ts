// Student / Enrollment / Join-Code repository (parallel-product-plan §7).
//
// All student-facing data access goes through this contract. The Local and Postgres
// implementations MUST satisfy the same interface — no feature may work only locally.
//
// In local mode "series" are derived from lectures grouped by slugify(seriesTitle);
// in Postgres mode the real lecture_series rows are used. Either way a join code is a
// deliberate, human-readable product object and never falls back to demo content.

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { and, desc, eq } from "drizzle-orm";

import { normalizeJoinCode, sanitizeJoinCode } from "@/lib/join-code";
import { lectureStudentView } from "@/lib/lecture-status";
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
};

export interface StudentRepository {
  getOrCreateStudentProfile(input: GetOrCreateStudentProfileInput): Promise<StudentProfile>;
  getProfileById(profileId: string): Promise<StudentProfile | null>;
  getProfileByAnonymousKey(anonymousKey: string): Promise<StudentProfile | null>;
  updateStudentPseudonym(profileId: string, pseudonym: string): Promise<StudentProfile | null>;
  resolveJoinCode(code: string): Promise<ResolvedJoinTarget | null>;
  createEnrollmentFromJoinCode(profileId: string, joinCodeId: string, source?: EnrollmentSource): Promise<StudentEnrollment | null>;
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
}

// ── Shared helpers ──────────────────────────────────────────────────────────

function nowIso() {
  return new Date().toISOString();
}

function pseudonymOrDefault(value?: string) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed.slice(0, 80) : "Pseudonym";
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

function groupLecturesBySeries(lectures: Lecture[]): Map<string, SeriesGroup> {
  const map = new Map<string, SeriesGroup>();
  for (const lecture of lectures) {
    const seriesId = slugify(lecture.seriesTitle);
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

class LocalStudentRepository implements StudentRepository {
  private async loadSeriesIndex(): Promise<Map<string, SeriesGroup>> {
    const lectures = await getLectureRepository().listLectures();
    return groupLecturesBySeries(lectures);
  }

  async getOrCreateStudentProfile(input: GetOrCreateStudentProfileInput): Promise<StudentProfile> {
    const store = await readStudentStore();
    const existing = store.profiles.find((profile) => profile.anonymousKey === input.anonymousKey);
    if (existing) {
      existing.lastSeenAt = nowIso();
      if (input.pseudonym && input.pseudonym.trim()) existing.pseudonym = pseudonymOrDefault(input.pseudonym);
      if (input.locale) existing.locale = input.locale;
      await writeStudentStore(store);
      return existing;
    }

    const profile: StudentProfile = {
      id: `student_${crypto.randomUUID()}`,
      anonymousKey: input.anonymousKey,
      pseudonym: pseudonymOrDefault(input.pseudonym),
      locale: input.locale ?? "de",
      createdAt: nowIso(),
      lastSeenAt: nowIso()
    };
    store.profiles.push(profile);
    await writeStudentStore(store);
    return profile;
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
    const trimmed = pseudonym.trim();
    if (!trimmed) return null;
    const store = await readStudentStore();
    const profile = store.profiles.find((item) => item.id === profileId);
    if (!profile) return null;
    profile.pseudonym = pseudonymOrDefault(trimmed);
    profile.lastSeenAt = nowIso();
    await writeStudentStore(store);
    return profile;
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
        seriesId: slugify(lecture.seriesTitle),
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
    target: { seriesId: string; seriesTitle: string; lectureId?: string; joinCodeId?: string; source: EnrollmentSource }
  ): Promise<StudentEnrollment> {
    const existing = store.enrollments.find(
      (item) => item.studentProfileId === profileId && item.seriesId === target.seriesId && item.status === "active"
    );
    if (existing) {
      // Idempotent: reactivating / re-joining keeps a single active enrollment.
      existing.lastOpenedAt = nowIso();
      if (target.lectureId) existing.lectureId = target.lectureId;
      if (target.joinCodeId) existing.joinCodeId = target.joinCodeId;
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
    return enrollment;
  }

  async createEnrollmentFromJoinCode(profileId: string, joinCodeId: string, source: EnrollmentSource = "code"): Promise<StudentEnrollment | null> {
    const store = await readStudentStore();
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
      seriesId = slugify(lecture.seriesTitle);
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
      source
    });
    await writeStudentStore(store);
    return enrollment;
  }

  async createDirectEnrollment(profileId: string, input: CreateDirectEnrollmentInput): Promise<StudentEnrollment | null> {
    const store = await readStudentStore();
    const profile = store.profiles.find((item) => item.id === profileId);
    if (!profile) return null;
    const enrollment = await this.createEnrollmentInternal(store, profileId, {
      seriesId: input.seriesId,
      seriesTitle: input.seriesTitle,
      lectureId: input.lectureId,
      source: input.source
    });
    await writeStudentStore(store);
    return enrollment;
  }

  async removeEnrollment(profileId: string, enrollmentId: string): Promise<boolean> {
    const store = await readStudentStore();
    const enrollment = store.enrollments.find(
      (item) => item.id === enrollmentId && item.studentProfileId === profileId
    );
    if (!enrollment) return false;
    enrollment.status = "removed";
    await writeStudentStore(store);
    return true;
  }

  async touchEnrollment(profileId: string, seriesId: string): Promise<void> {
    const store = await readStudentStore();
    const enrollment = store.enrollments.find(
      (item) => item.studentProfileId === profileId && item.seriesId === seriesId && item.status === "active"
    );
    if (!enrollment) return;
    enrollment.lastOpenedAt = nowIso();
    await writeStudentStore(store);
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
    const normalized = sanitizeJoinCode(code);
    if (!normalized) {
      throw new Error("Ungültiger Code. Erlaubt sind Buchstaben, Zahlen und Bindestriche.");
    }
    const store = await readStudentStore();
    const seriesIndex = await this.loadSeriesIndex();
    const group = seriesIndex.get(seriesId);
    if (!group) throw new Error("Vorlesungsreihe nicht gefunden.");

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
  }

  async disableJoinCode(userId: string | undefined, joinCodeId: string): Promise<JoinCode | null> {
    const store = await readStudentStore();
    const joinCode = store.joinCodes.find((item) => item.id === joinCodeId);
    if (!joinCode) return null;
    joinCode.enabled = false;
    joinCode.updatedAt = nowIso();
    await writeStudentStore(store);
    return joinCode;
  }

  async getShareInfoForSeries(userId: string | undefined, seriesId: string): Promise<SeriesShareInfo | null> {
    const store = await readStudentStore();
    const seriesIndex = await this.loadSeriesIndex();
    const group = seriesIndex.get(seriesId);
    if (!group) return null;
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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class PostgresStudentRepository implements StudentRepository {
  private readonly db = getDb();

  // The API surface uses the slug (`seriesIdFromTitle`) as the canonical seriesId in
  // BOTH local and Postgres modes. Internally Postgres keys by lecture_series.id (UUID),
  // so resolve a slug-or-UUID identifier to the actual series row at the DB boundary.
  private async resolveSeriesRow(idOrSlug: string): Promise<typeof lectureSeries.$inferSelect | null> {
    if (UUID_PATTERN.test(idOrSlug)) {
      const [row] = await this.db.select().from(lectureSeries).where(eq(lectureSeries.id, idOrSlug)).limit(1);
      return row ?? null;
    }
    const rows = await this.db.select().from(lectureSeries);
    return rows.find((row) => slugify(row.title) === idOrSlug) ?? null;
  }

  async getOrCreateStudentProfile(input: GetOrCreateStudentProfileInput): Promise<StudentProfile> {
    const [row] = await this.db
      .insert(studentProfiles)
      .values({
        anonymousKey: input.anonymousKey,
        pseudonym: pseudonymOrDefault(input.pseudonym),
        locale: input.locale ?? "de"
      })
      .onConflictDoUpdate({
        target: studentProfiles.anonymousKey,
        set: {
          lastSeenAt: new Date(),
          ...(input.pseudonym && input.pseudonym.trim() ? { pseudonym: pseudonymOrDefault(input.pseudonym) } : {}),
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
    const trimmed = pseudonym.trim();
    if (!trimmed) return null;
    const [row] = await this.db
      .update(studentProfiles)
      .set({ pseudonym: pseudonymOrDefault(trimmed), lastSeenAt: new Date() })
      .where(eq(studentProfiles.id, profileId))
      .returning();
    return row ? this.mapProfile(row) : null;
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
      if (!lecture) return null;
      return {
        joinCode,
        scope: "lecture",
        seriesId: slugify(lecture.seriesTitle ?? lecture.title),
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
      seriesId: slugify(series.title),
      seriesTitle: series.title
    };
  }

  async createEnrollmentFromJoinCode(profileId: string, joinCodeId: string, source: EnrollmentSource = "code"): Promise<StudentEnrollment | null> {
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

    return this.upsertEnrollment(profileId, { seriesId, seriesTitle, lectureId, joinCodeId, source });
  }

  async createDirectEnrollment(profileId: string, input: CreateDirectEnrollmentInput): Promise<StudentEnrollment | null> {
    return this.upsertEnrollment(profileId, {
      seriesId: input.seriesId,
      seriesTitle: input.seriesTitle,
      lectureId: input.lectureId,
      source: input.source
    });
  }

  private async upsertEnrollment(
    profileId: string,
    target: { seriesId?: string; seriesTitle: string; lectureId?: string; joinCodeId?: string; source: EnrollmentSource }
  ): Promise<StudentEnrollment | null> {
    if (!target.seriesId) return null;
    // target.seriesId may be a slug (direct enrollment) or a UUID (join-code path);
    // resolve to the real lecture_series.id for the FK.
    const seriesRow = await this.resolveSeriesRow(target.seriesId);
    if (!seriesRow) return null;
    const seriesUuid = seriesRow.id;
    const seriesTitle = target.seriesTitle || seriesRow.title;
    const existing = await this.db
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
      const [updated] = await this.db
        .update(studentEnrollments)
        .set({ lastOpenedAt: new Date(), ...(target.lectureId ? { lectureId: target.lectureId } : {}), ...(target.joinCodeId ? { joinCodeId: target.joinCodeId } : {}) })
        .where(eq(studentEnrollments.id, existing[0].id))
        .returning();
      return this.mapEnrollment(updated, seriesTitle);
    }
    const [created] = await this.db
      .insert(studentEnrollments)
      .values({
        studentProfileId: profileId,
        seriesId: seriesUuid,
        lectureId: target.lectureId,
        joinCodeId: target.joinCodeId,
        source: target.source,
        status: "active",
        // Match local-store semantics so dashboard ordering is stable across modes.
        lastOpenedAt: new Date()
      })
      .returning();
    return this.mapEnrollment(created, seriesTitle);
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
    const now = new Date();
    const enrollmentRows = await this.db
      .select()
      .from(studentEnrollments)
      .where(and(eq(studentEnrollments.studentProfileId, profile.id), eq(studentEnrollments.status, "active")))
      .orderBy(desc(studentEnrollments.lastOpenedAt));
    const events = await getAnalyticsRepository().listEvents();
    const lectures = await getLectureRepository().listLectures();
    const byPgSeries = new Map<string, Lecture[]>();
    // We need to map enrollment.seriesId (lecture_series.id) to lectures. Lectures
    // expose seriesTitle only, so group by slug AND look the title up via the series row.
    const views: StudentDashboardSeries[] = [];
    const seriesRows = await this.db.select().from(lectureSeries);
    const seriesById = new Map(seriesRows.map((row) => [row.id, row]));

    for (const enrollmentRow of enrollmentRows) {
      const seriesUuid = enrollmentRow.seriesId;
      if (!seriesUuid) continue;
      const seriesRow = seriesById.get(seriesUuid);
      if (!seriesRow) continue;
      // Expose the slug as the canonical seriesId (consistent with local mode + routes).
      const seriesSlug = slugify(seriesRow.title);
      if (onlySeriesId && seriesSlug !== onlySeriesId && seriesUuid !== onlySeriesId) continue;
      const groupLectures = byPgSeries.get(seriesUuid)
        ?? lectures.filter((lecture) => slugify(lecture.seriesTitle) === seriesSlug);
      byPgSeries.set(seriesUuid, groupLectures);
      const group: SeriesGroup = {
        seriesId: seriesSlug,
        seriesTitle: seriesRow.title,
        language: seriesRow.language,
        examDate: seriesRow.examDate?.toISOString(),
        lectures: groupLectures
      };
      const tokens = new Set(groupLectures.map((lecture) => lecture.publicToken));
      const enrollment = this.mapEnrollment(enrollmentRow, seriesRow.title);
      const readiness = computeReadinessSnapshot({
        profile,
        seriesId: seriesSlug,
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
    const series = await this.resolveSeriesRow(seriesId);
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

  async disableJoinCode(_userId: string | undefined, joinCodeId: string): Promise<JoinCode | null> {
    const [row] = await this.db
      .update(joinCodes)
      .set({ enabled: false, updatedAt: new Date() })
      .where(eq(joinCodes.id, joinCodeId))
      .returning();
    return row ? this.mapJoinCode(row) : null;
  }

  async getShareInfoForSeries(_userId: string | undefined, seriesId: string): Promise<SeriesShareInfo | null> {
    const series = await this.resolveSeriesRow(seriesId);
    if (!series) return null;
    const [codeRow] = await this.db
      .select()
      .from(joinCodes)
      .where(and(eq(joinCodes.enabled, true), eq(joinCodes.scope, "series"), eq(joinCodes.seriesId, series.id)))
      .limit(1);
    return {
      seriesId: slugify(series.title),
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
      // Expose the slug as the canonical seriesId, consistent with local mode + routes.
      seriesId: seriesTitle ? slugify(seriesTitle) : (row.seriesId ?? ""),
      seriesTitle,
      lectureId: row.lectureId ?? undefined,
      joinCodeId: row.joinCodeId ?? undefined,
      source: row.source,
      status: row.status,
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
