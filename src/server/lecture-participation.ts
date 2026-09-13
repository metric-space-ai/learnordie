import type { Lecture, ResolvedJoinTarget } from "@/lib/types";
import { and, eq, or, sql } from "drizzle-orm";
import { seriesIdForLecture } from "@/lib/series";
import { getStudentRepository } from "./student-repository";
import { getDb } from "./db/client";
import { joinCodes, lectures, liveSessions } from "./db/schema";

/** Resolve the actual configured code; never manufacture a code from a technical token. */
export async function withParticipationPath(lecture: Lecture): Promise<Lecture> {
  if (process.env.DATABASE_URL && lecture.seriesId) {
    // Public participation pages must not depend on an owner email being exposed
    // in their lecture payload. These are already-enabled public join codes.
    const [code] = await getDb().select({ code: joinCodes.code }).from(joinCodes)
      .where(and(eq(joinCodes.enabled, true), or(
        and(eq(joinCodes.scope, "lecture"), eq(joinCodes.lectureId, lecture.id)),
        and(eq(joinCodes.scope, "series"), eq(joinCodes.seriesId, lecture.seriesId))
      )))
      .orderBy(sql`case when ${joinCodes.scope} = 'lecture' then 0 else 1 end`, joinCodes.createdAt).limit(1);
    return { ...lecture, participationPath: code ? `/l/${encodeURIComponent(code.code)}` : `/l/${encodeURIComponent(lecture.publicToken)}` };
  }
  const share = await getStudentRepository().getShareInfoForSeries(lecture.ownerEmail, seriesIdForLecture(lecture));
  return { ...lecture, participationPath: share?.enabled && share.joinPath
    ? share.joinPath.replace(/^\/join\//, "/l/") : `/l/${encodeURIComponent(lecture.publicToken)}` };
}

/** An enabled series code enters its one active classroom, not a generic dashboard. */
export async function activeClassroomForJoin(target: ResolvedJoinTarget): Promise<string | null> {
  if (!process.env.DATABASE_URL) return null;
  const candidates = await getDb().select({ token: lectures.publicToken }).from(lectures)
    .innerJoin(liveSessions, eq(liveSessions.lectureId, lectures.id))
    .where(and(eq(liveSessions.status, "active"), target.scope === "lecture" && target.lectureId
      ? eq(lectures.id, target.lectureId) : eq(lectures.seriesId, target.seriesId))).limit(2);
  // Ambiguous series must retain the normal lecture selection instead of guessing.
  return candidates.length === 1 ? candidates[0].token : null;
}
