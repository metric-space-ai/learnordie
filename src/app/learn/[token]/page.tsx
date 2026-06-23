import { notFound } from "next/navigation";

import { LearnExperience } from "@/components/LearnExperience";
import { seriesIdFromTitle } from "@/lib/series";
import { isValidPublicLectureToken } from "@/server/public-params";
import { getLectureRepository } from "@/server/repository";
import { getStudentRepository } from "@/server/student-repository";
import { getCurrentStudentProfile } from "@/server/student-session";

export default async function LearnPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isValidPublicLectureToken(token)) notFound();

  const lecture = await getLectureRepository().getLectureByToken(token);
  if (!lecture) notFound();

  // Enrollment-aware: a known student opening a direct learn link gets the series
  // added to their dashboard (idempotent). Anonymous visitors are unaffected.
  const profile = await getCurrentStudentProfile();
  if (profile) {
    await getStudentRepository().createDirectEnrollment(profile.id, {
      seriesId: seriesIdFromTitle(lecture.seriesTitle),
      seriesTitle: lecture.seriesTitle,
      lectureId: lecture.id,
      source: "direct_learn_link"
    });
  }

  return <LearnExperience lecture={lecture} />;
}
