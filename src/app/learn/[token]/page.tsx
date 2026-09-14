import { notFound } from "next/navigation";

import { LearnExperience } from "@/components/LearnExperience";
import { SeriesClaimGate } from "@/components/student/SeriesClaimGate";
import { isValidPublicLectureToken } from "@/server/public-params";
import { getLectureRepository } from "@/server/repository";
import { withParticipationPath } from "@/server/lecture-participation";

export default async function LearnPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isValidPublicLectureToken(token)) notFound();

  const lecture = await getLectureRepository().getLectureByToken(token);
  if (!lecture) notFound();

  return (
    <SeriesClaimGate lecture={lecture} source="direct_learn_link">
      <LearnExperience lecture={await withParticipationPath(lecture)} />
    </SeriesClaimGate>
  );
}
