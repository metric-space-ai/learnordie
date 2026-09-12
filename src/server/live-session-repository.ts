import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { groupQuestionFamilies, questionsForSlide } from "@/lib/questions";
import type { LiveAnswerReceipt, LiveCommand, LiveSessionView } from "@/lib/live-session";
import type { Lecture, QuestionLevel, QuestionVariant } from "@/lib/types";
import { getDb } from "./db/client";
import { analyticsEvents, lectureSeries, lectures, liveAnswers, liveSessions, participantSessions, studentEnrollments, studentProfiles, users } from "./db/schema";
import { rankingDisplayName } from "./student-claims";

export type StoredLiveRound = { id: string; expiresAt: number; questions: QuestionVariant[] };
export class LiveSessionError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
type Transaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
async function databaseNow(db: Transaction | ReturnType<typeof getDb>) {
  const [row] = await db.execute<{ now: string }>(sql`select extract(epoch from clock_timestamp()) * 1000 as now`);
  return Number(row.now);
}

export async function liveLecture(token: string, ownerEmail?: string) {
  if (!process.env.DATABASE_URL) throw new LiveSessionError(503, "Live-Synchronisierung benötigt PostgreSQL (DATABASE_URL). Der lokale Lernmodus bleibt verfügbar.");
  const [row] = await getDb().select({ id: lectures.id, seriesId: lectures.seriesId, leaderboardEnabled: lectures.leaderboardEnabled })
    .from(lectures).leftJoin(lectureSeries, eq(lectures.seriesId, lectureSeries.id))
    .leftJoin(users, eq(lectureSeries.ownerId, users.id))
    .where(and(eq(lectures.publicToken, token), ownerEmail ? eq(users.email, ownerEmail) : undefined)).limit(1);
  if (!row) throw new LiveSessionError(404, "Vorlesung nicht gefunden.");
  return row;
}

/** Row locks serialize commands and answers; an answer queued past expiry is rejected. */
export async function commandLiveSession(lecture: Lecture, command: LiveCommand) {
  const db = getDb();
  await db.transaction(async (tx) => {
    // Locks the existing parent too, making concurrent first-session creation safe.
    await tx.select({ id: lectures.id }).from(lectures).where(eq(lectures.id, lecture.id)).for("update");
    const [current] = await tx.select().from(liveSessions).where(eq(liveSessions.lectureId, lecture.id)).for("update");
    if ((current?.revision ?? 0) !== command.revision) throw new LiveSessionError(409, "Sitzung wurde geändert. Bitte erneut versuchen.");
    const now = await databaseNow(tx);
    if (command.action === "start") {
      // Reloading the presenter must resume, never silently restart a running class.
      if (current?.status === "active") return;
      const values = { sessionId: randomUUID(), revision: (current?.revision ?? 0) + 1, status: "active" as const, slideIndex: 0, showIntro: true, round: null, updatedAt: new Date(now) };
      await tx.insert(liveSessions).values({ lectureId: lecture.id, ...values })
        .onConflictDoUpdate({ target: liveSessions.lectureId, set: values });
      return;
    }
    if (!current || current.status !== "active") throw new LiveSessionError(409, "Keine aktive Live-Sitzung.");
    const update: Partial<typeof liveSessions.$inferInsert> = { revision: current.revision + 1, updatedAt: new Date(now) };
    if (command.action === "slide") {
      if (command.slideIndex < 0 || command.slideIndex >= lecture.slides.length || (command.showIntro && command.slideIndex !== 0)) {
        throw new LiveSessionError(400, "Ungültige Folie.");
      }
      Object.assign(update, { slideIndex: command.slideIndex, showIntro: command.showIntro, round: null });
    } else if (command.action === "fire") {
      if (current.showIntro) throw new LiveSessionError(409, "Bitte zuerst die Präsentation starten.");
      const families = groupQuestionFamilies(questionsForSlide(lecture.questions, lecture.slides[current.slideIndex]?.id));
      const questions = families[command.familyIndex];
      if (!questions?.length) throw new LiveSessionError(400, "Fragenfamilie nicht gefunden.");
      update.round = { id: randomUUID(), expiresAt: now + command.durationSeconds * 1000, questions };
    } else {
      update.round = null;
      if (command.action === "end") update.status = "ended";
    }
    await tx.update(liveSessions).set(update).where(eq(liveSessions.lectureId, lecture.id));
  });
}

export async function answerLiveSession(lectureId: string, anonymousKey: string, input: { sessionId: string; roundId: string; level: QuestionLevel; selected: string }): Promise<LiveAnswerReceipt> {
  return getDb().transaction(async (tx) => {
    const [session] = await tx.select().from(liveSessions).where(eq(liveSessions.lectureId, lectureId)).for("update");
    const now = await databaseNow(tx);
    const round = session?.round;
    if (!session || session.status !== "active" || session.sessionId !== input.sessionId || !round || round.id !== input.roundId || round.expiresAt <= now) {
      throw new LiveSessionError(409, "Diese Frage ist bereits geschlossen.");
    }
    const [identity] = await tx.select({ profileId: studentProfiles.id, name: studentEnrollments.displayName })
      .from(studentProfiles).innerJoin(studentEnrollments, eq(studentEnrollments.studentProfileId, studentProfiles.id))
      .innerJoin(lectures, eq(lectures.seriesId, studentEnrollments.seriesId))
      .where(and(eq(studentProfiles.anonymousKey, anonymousKey), eq(lectures.id, lectureId), eq(studentEnrollments.status, "active"))).limit(1);
    if (!identity?.name) throw new LiveSessionError(409, "Teilnahme wird noch vorbereitet. Bitte erneut versuchen.");
    const [previous] = await tx.select().from(liveAnswers).where(and(eq(liveAnswers.roundId, round.id), eq(liveAnswers.studentProfileId, identity.profileId)));
    if (previous) return previous.receipt; // Idempotent retry; level switching cannot earn again.
    const question = round.questions.find((item) => item.level === input.level);
    const answer = question?.answers.find((item) => item.key === input.selected);
    if (!question || !answer) throw new LiveSessionError(400, "Ungültige Antwort.");
    const receipt: LiveAnswerReceipt = { level: input.level, selected: input.selected, correct: answer.correct, points: answer.correct ? question.points : 0, explanation: question.explanation };
    await tx.insert(liveAnswers).values({ lectureId, sessionId: session.sessionId, roundId: round.id, studentProfileId: identity.profileId, points: receipt.points, correct: receipt.correct, receipt });
    const [participant] = await tx.insert(participantSessions).values({ lectureId, anonymousKey, studentProfileId: identity.profileId, pseudonym: identity.name })
      .onConflictDoUpdate({ target: [participantSessions.lectureId, participantSessions.anonymousKey], set: { pseudonym: identity.name, studentProfileId: identity.profileId, lastSeenAt: new Date(now) } }).returning({ id: participantSessions.id });
    await tx.insert(analyticsEvents).values({ lectureId, participantSessionId: participant.id, eventType: "answer_selected", eventPayload: {
      mode: "live", liveSessionId: session.sessionId, liveRoundId: round.id, level: question.level, familyId: question.familyId,
      slideId: question.slideId, points: question.points, earnedPoints: receipt.points, correct: receipt.correct,
      questionText: question.text, selected: answer.key, selectedAnswerKey: answer.key, selectedAnswerText: answer.text
    } });
    return receipt;
  });
}

export async function readLiveSession(lecture: Awaited<ReturnType<typeof liveLecture>>, anonymousKey: string | null, includeLeaderboard: boolean): Promise<LiveSessionView> {
  const db = getDb();
  const [session] = await db.select().from(liveSessions).where(eq(liveSessions.lectureId, lecture.id));
  const now = await databaseNow(db);
  const activeRound = session?.status === "active" && session.round && session.round.expiresAt > now ? session.round : null;
  const [profile] = anonymousKey ? await db.select({ id: studentProfiles.id }).from(studentProfiles).where(eq(studentProfiles.anonymousKey, anonymousKey)).limit(1) : [];
  const [answer] = activeRound && profile ? await db.select({ receipt: liveAnswers.receipt }).from(liveAnswers)
    .where(and(eq(liveAnswers.roundId, activeRound.id), eq(liveAnswers.studentProfileId, profile.id))).limit(1) : [];
  const view: LiveSessionView = {
    sessionId: session?.sessionId ?? null, revision: session?.revision ?? 0, status: session?.status ?? "waiting",
    slideIndex: session?.slideIndex ?? 0, showIntro: session?.showIntro ?? true, serverNow: now,
    round: activeRound ? { id: activeRound.id, expiresAt: activeRound.expiresAt, questions: activeRound.questions.map((q) => ({
      level: q.level, text: q.text, points: q.points, answers: q.answers.map(({ key, text }) => ({ key, text }))
    })) } : null,
    receipt: answer?.receipt ?? null
  };
  if (includeLeaderboard && lecture.leaderboardEnabled && session) {
    const rows = await db.select({ profileId: liveAnswers.studentProfileId, points: sql<number>`sum(${liveAnswers.points})::integer`,
      correct: sql<number>`count(*) filter (where ${liveAnswers.correct})::integer`, answers: sql<number>`count(*)::integer`,
      lastAt: sql<Date>`max(${liveAnswers.createdAt})` }).from(liveAnswers).where(eq(liveAnswers.sessionId, session.sessionId))
      .groupBy(liveAnswers.studentProfileId).orderBy(desc(sql`sum(${liveAnswers.points})`), asc(sql`max(${liveAnswers.createdAt})`), asc(liveAnswers.studentProfileId)).limit(10);
    view.leaderboard = await Promise.all(rows.map(async (row, index) => {
      const [claim] = lecture.seriesId ? await db.select().from(studentEnrollments).where(and(eq(studentEnrollments.studentProfileId, row.profileId), eq(studentEnrollments.seriesId, lecture.seriesId)))
        .orderBy(desc(sql`${studentEnrollments.status} = 'active'`), desc(studentEnrollments.addedAt), asc(studentEnrollments.id)).limit(1) : [];
      return { rank: index + 1, name: rankingDisplayName(claim ? { id: claim.id, studentProfileId: row.profileId, seriesId: claim.seriesId ?? "", seriesTitle: "", source: claim.source, status: claim.status, displayName: claim.displayName, addedAt: claim.addedAt.toISOString() } : null, row.profileId), points: row.points, correct: row.correct, answers: row.answers, self: row.profileId === profile?.id };
    }));
  }
  return view;
}
