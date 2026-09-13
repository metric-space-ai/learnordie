import { notFound } from "next/navigation";

import { StudentLiveExperience } from "@/components/StudentLiveExperience";
import { SeriesClaimGate } from "@/components/student/SeriesClaimGate";
import { isValidPublicLectureToken } from "@/server/public-params";
import { getLectureRepository } from "@/server/repository";
import { withParticipationPath } from "@/server/lecture-participation";

export default async function StudentLivePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isValidPublicLectureToken(token)) notFound();

  const lecture = await getLectureRepository().getLectureByToken(token);
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
