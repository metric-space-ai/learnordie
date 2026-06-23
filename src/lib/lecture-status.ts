// Shared, client-safe helpers that map a lecture's status + timing onto the
// student-facing buckets (live now / upcoming / learn). Used by the dashboard,
// the join flow and readiness so the rules stay in one place.

import type { Lecture, LectureStatus, StudentEventBucket } from "./types";

type LectureLike = {
  status: LectureStatus;
  liveAt: string;
  aiAccessUntil?: string;
};

export function isLiveNow(lecture: LectureLike): boolean {
  return lecture.status === "live";
}

export function isLearnAvailable(lecture: LectureLike): boolean {
  return lecture.status === "learn_active" || lecture.status === "archived";
}

export function aiAccessActive(lecture: LectureLike, now: Date = new Date()): boolean {
  if (!lecture.aiAccessUntil) return false;
  const until = new Date(lecture.aiAccessUntil).getTime();
  if (Number.isNaN(until)) return false;
  return now.getTime() <= until;
}

export function studentEventBucket(lecture: LectureLike, now: Date = new Date()): StudentEventBucket {
  if (isLiveNow(lecture)) return "live";
  if (isLearnAvailable(lecture)) return "learn";

  const liveAt = new Date(lecture.liveAt).getTime();
  if (Number.isNaN(liveAt)) return "upcoming";
  // A lecture whose scheduled time is in the past but that was never opened for
  // learning still reads as "past" to the student.
  return liveAt > now.getTime() ? "upcoming" : "learn";
}

export type LectureStudentView = {
  bucket: StudentEventBucket;
  liveAvailable: boolean;
  learnAvailable: boolean;
  aiAccessActive: boolean;
};

export function lectureStudentView(lecture: Lecture, now: Date = new Date()): LectureStudentView {
  const bucket = studentEventBucket(lecture, now);
  return {
    bucket,
    liveAvailable: bucket === "live",
    learnAvailable: bucket === "learn",
    aiAccessActive: aiAccessActive(lecture, now)
  };
}
