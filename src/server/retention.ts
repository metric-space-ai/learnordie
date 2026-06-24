import { and, eq, isNotNull, lt, sql } from "drizzle-orm";

import type { Lecture, RetentionCountItem, RetentionSummary } from "@/lib/types";
import { resolvedRetentionPolicy } from "@/lib/retention-policy";
import { getAnalyticsRepository } from "./analytics-repository";
import { getDb } from "./db/client";
import {
  analyticsEvents,
  answers,
  lectureAssets,
  materialProcessingRuns,
  participantSessions,
  presentationAssets,
  questionReviewItems,
  questions,
  standaloneExportJobs,
  standaloneExports,
  studentChatQuestions,
  transcriptSegments
} from "./db/schema";

const DEFAULT_RETENTION_YEARS = 5;
const cleanupKeys = new Set([
  "participant_sessions",
  "analytics_events",
  "answers",
  "student_chat_questions",
  "transcript_segments"
]);

export function retentionYears() {
  const parsed = Number(process.env.LEARNBUDDY_RETENTION_YEARS);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 50) return DEFAULT_RETENTION_YEARS;
  return Math.floor(parsed);
}

function retentionCutoff(asOf: Date, years = retentionYears()) {
  const cutoff = new Date(asOf);
  cutoff.setFullYear(cutoff.getFullYear() - years);
  return cutoff;
}

function olderThan(value: string | undefined, cutoff: Date) {
  if (!value) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date < cutoff;
}

function summarizeTotals(counts: RetentionCountItem[]) {
  const cleanupTotal = counts
    .filter((item) => cleanupKeys.has(item.key))
    .reduce((sum, item) => sum + item.count, 0);
  const contentTotal = counts
    .filter((item) => !cleanupKeys.has(item.key))
    .reduce((sum, item) => sum + item.count, 0);
  return {
    cleanupTotal,
    contentTotal,
    staleTotal: cleanupTotal + contentTotal
  };
}

function recommendation(cleanupTotal: number, contentTotal: number) {
  if (cleanupTotal === 0 && contentTotal === 0) return "Keine Datensätze außerhalb der Aufbewahrungsfrist.";
  if (cleanupTotal > 0) return "Pseudonyme Lernsignale außerhalb der Aufbewahrungsfrist anonymisieren; Kursinhalte und Standalone-Artefakte bleiben owner-gesteuert erhalten.";
  return "Pseudonyme Lernsignale sind bereinigt; Kursinhalte und Standalone-Artefakte werden gemäß Content-Policy nur berichtet.";
}

function normalizeCounts(items: RetentionCountItem[]) {
  return items.filter((item) => item.count > 0);
}

async function buildPostgresRetentionSummary(lecture: Lecture, years: number, asOf: Date, cutoff: Date): Promise<RetentionSummary> {
  const db = getDb();
  const count = async <T>(table: T, condition: Parameters<typeof db.$count>[1]) => db.$count(table as never, condition);

  const counts: RetentionCountItem[] = normalizeCounts([
    {
      key: "participant_sessions",
      label: "Pseudonyme Sitzungen",
      count: await count(participantSessions, and(
        eq(participantSessions.lectureId, lecture.id),
        lt(participantSessions.lastSeenAt, cutoff),
        sql`${participantSessions.anonymousKey} not like 'retained:%'`
      ))
    },
    {
      key: "analytics_events",
      label: "Analytics Events",
      count: await count(analyticsEvents, and(
        eq(analyticsEvents.lectureId, lecture.id),
        lt(analyticsEvents.occurredAt, cutoff),
        sql`coalesce(${analyticsEvents.eventPayload}->>'retained', 'false') <> 'true'`
      ))
    },
    {
      key: "answers",
      label: "Antworten",
      count: await count(answers, and(
        eq(answers.lectureId, lecture.id),
        lt(answers.createdAt, cutoff),
        isNotNull(answers.participantSessionId)
      ))
    },
    {
      key: "student_chat_questions",
      label: "Chatfragen",
      count: await count(studentChatQuestions, and(
        eq(studentChatQuestions.lectureId, lecture.id),
        lt(studentChatQuestions.createdAt, cutoff),
        sql`${studentChatQuestions.questionText} <> '[nach Aufbewahrungsfrist anonymisiert]'`
      ))
    },
    {
      key: "transcript_segments",
      label: "Transkriptsegmente",
      count: await count(transcriptSegments, and(
        eq(transcriptSegments.lectureId, lecture.id),
        lt(transcriptSegments.createdAt, cutoff),
        sql`${transcriptSegments.text} <> '[nach Aufbewahrungsfrist redigiert]'`
      ))
    },
    {
      key: "lecture_assets",
      label: "Materialien",
      count: await count(lectureAssets, and(eq(lectureAssets.lectureId, lecture.id), lt(lectureAssets.createdAt, cutoff)))
    },
    {
      key: "presentation_assets",
      label: "Präsentationsassets",
      count: await count(presentationAssets, and(eq(presentationAssets.lectureId, lecture.id), lt(presentationAssets.createdAt, cutoff)))
    },
    {
      key: "material_processing_runs",
      label: "Materialläufe",
      count: await count(materialProcessingRuns, and(eq(materialProcessingRuns.lectureId, lecture.id), lt(materialProcessingRuns.startedAt, cutoff)))
    },
    {
      key: "question_review_items",
      label: "Fragenreviews",
      count: await count(questionReviewItems, and(eq(questionReviewItems.lectureId, lecture.id), lt(questionReviewItems.createdAt, cutoff)))
    },
    {
      key: "questions",
      label: "Aktive Fragen",
      count: await count(questions, and(eq(questions.lectureId, lecture.id), lt(questions.createdAt, cutoff)))
    },
    {
      key: "standalone_exports",
      label: "Standalone-Exporte",
      count: await count(standaloneExports, and(eq(standaloneExports.lectureId, lecture.id), lt(standaloneExports.createdAt, cutoff)))
    },
    {
      key: "standalone_export_jobs",
      label: "Exportjobs",
      count: await count(standaloneExportJobs, and(eq(standaloneExportJobs.lectureId, lecture.id), lt(standaloneExportJobs.createdAt, cutoff)))
    }
  ]);

  const { staleTotal, cleanupTotal, contentTotal } = summarizeTotals(counts);
  return {
    lectureId: lecture.id,
    lectureToken: lecture.publicToken,
    policy: resolvedRetentionPolicy(years, cutoff.toISOString(), asOf.toISOString()),
    staleTotal,
    cleanupTotal,
    contentTotal,
    counts,
    recommendation: recommendation(cleanupTotal, contentTotal),
    mode: "postgres"
  };
}

async function buildLocalRetentionSummary(lecture: Lecture, years: number, asOf: Date, cutoff: Date): Promise<RetentionSummary> {
  const events = (await getAnalyticsRepository().listEvents()).filter((event) => event.lectureToken === lecture.publicToken);
  const oldEvents = events.filter((event) => olderThan(event.occurredAt, cutoff));
  const oldAnonymousKeys = new Set(oldEvents.map((event) => event.anonymousKey).filter(Boolean));

  const counts: RetentionCountItem[] = normalizeCounts([
    {
      key: "participant_sessions",
      label: "Pseudonyme Lernende",
      count: oldAnonymousKeys.size
    },
    {
      key: "analytics_events",
      label: "Analytics Events",
      count: oldEvents.length
    },
    {
      key: "student_chat_questions",
      label: "Chatfragen",
      count: (lecture.studentChatQuestions ?? []).filter((item) => olderThan(item.createdAt, cutoff)).length
    },
    {
      key: "transcript_segments",
      label: "Transkriptsegmente",
      count: (lecture.transcriptSegments ?? []).filter((item) => olderThan(item.createdAt, cutoff)).length
    },
    {
      key: "lecture_assets",
      label: "Materialien",
      count: (lecture.materials ?? []).filter((item) => olderThan(item.createdAt, cutoff)).length
    },
    {
      key: "presentation_assets",
      label: "Präsentationsassets",
      count: (lecture.presentationAssets ?? []).filter((item) => olderThan(item.createdAt, cutoff)).length
    },
    {
      key: "material_processing_runs",
      label: "Materialläufe",
      count: (lecture.materialProcessingRuns ?? []).filter((item) => olderThan(item.startedAt, cutoff)).length
    },
    {
      key: "question_review_items",
      label: "Fragenreviews",
      count: (lecture.questionReviews ?? []).filter((item) => olderThan(item.createdAt, cutoff)).length
    },
    {
      key: "standalone_exports",
      label: "Standalone-Exporte",
      count: (lecture.standaloneExports ?? []).filter((item) => olderThan(item.createdAt, cutoff)).length
    },
    {
      key: "standalone_export_jobs",
      label: "Exportjobs",
      count: (lecture.standaloneExportJobs ?? []).filter((item) => olderThan(item.createdAt, cutoff)).length
    }
  ]);

  const { staleTotal, cleanupTotal, contentTotal } = summarizeTotals(counts);
  return {
    lectureId: lecture.id,
    lectureToken: lecture.publicToken,
    policy: resolvedRetentionPolicy(years, cutoff.toISOString(), asOf.toISOString()),
    staleTotal,
    cleanupTotal,
    contentTotal,
    counts,
    recommendation: recommendation(cleanupTotal, contentTotal),
    mode: "local"
  };
}

export async function buildRetentionSummary(lecture: Lecture, asOf = new Date()): Promise<RetentionSummary> {
  const years = retentionYears();
  const cutoff = retentionCutoff(asOf, years);

  if (process.env.LEARNBUDDY_REPOSITORY !== "local" && process.env.DATABASE_URL) {
    return buildPostgresRetentionSummary(lecture, years, asOf, cutoff);
  }

  return buildLocalRetentionSummary(lecture, years, asOf, cutoff);
}
