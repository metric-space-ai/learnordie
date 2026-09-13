import { notFound } from "next/navigation";

import { StudentLiveExperience } from "@/components/StudentLiveExperience";
import { SeriesClaimGate } from "@/components/student/SeriesClaimGate";
import { isValidPublicLectureToken } from "@/server/public-params";
import { getLectureRepository } from "@/server/repository";
import { withParticipationPath } from "@/server/lecture-participation";
import { activeClassroomForJoin } from "@/server/lecture-participation";
import { getStudentRepository } from "@/server/student-repository";
import JoinPage from "@/app/join/[code]/page";

export default async function StudentLivePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isValidPublicLectureToken(token)) notFound();

  const repository = getLectureRepository();
  // Keep existing public links valid. An enabled short code is an additional
  // public entry point, never a new route around enrollment or role checks.
  let lecture = await repository.getLectureByToken(token);
  if (!lecture) {
    const target = await getStudentRepository().resolveJoinCode(token);
    if (!target) notFound();
    const resolved = target.lectureToken ?? await activeClassroomForJoin(target);
    if (!resolved) return JoinPage({ params: Promise.resolve({ code: token }) });
    lecture = await repository.getLectureByToken(resolved);
  }
  if (!lecture) notFound();

  const publicLecture = { ...await withParticipationPath(lecture), tenantBudgetKey: "", questions: [], transcriptSegments: [], studentChatQuestions: [], assistantMessages: [], agentThreads: [], questionReviews: [], materials: [], materialProcessingRuns: [], standaloneExportJobs: [],
    slideDocument: lecture.slideDocument ? { ...lecture.slideDocument, slides: lecture.slideDocument.slides.map((slide) => ({ ...slide, speakerNotes: [] })) } : undefined
  };

  return (
    <SeriesClaimGate lecture={publicLecture} source="direct_live_link">
      <StudentLiveExperience lecture={publicLecture} />
    </SeriesClaimGate>
  );
}
