import { notFound } from "next/navigation";

import { StudentLiveExperience } from "@/components/StudentLiveExperience";
import { seriesIdFromTitle } from "@/lib/series";
import { isValidPublicLectureToken } from "@/server/public-params";
import { getLectureRepository } from "@/server/repository";
import { getStudentRepository } from "@/server/student-repository";
import { getCurrentStudentProfile } from "@/server/student-session";

export default async function StudentLivePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isValidPublicLectureToken(token)) notFound();

  const lecture = await getLectureRepository().getLectureByToken(token);
  if (!lecture) notFound();

  // Enrollment-aware: a known student opening a direct live link gets the series
  // added to their dashboard (idempotent). Anonymous visitors stay login-free.
  const profile = await getCurrentStudentProfile();
  if (profile) {
    await getStudentRepository().createDirectEnrollment(profile.id, {
      seriesId: seriesIdFromTitle(lecture.seriesTitle),
      seriesTitle: lecture.seriesTitle,
      lectureId: lecture.id,
      source: "direct_live_link"
    });
  }

  return <StudentLiveExperience lecture={lecture} />;
}
