import { notFound, redirect } from "next/navigation";

import { LecturerLiveExperience } from "@/components/LecturerLiveExperience";
import { createLecturerCsrfToken, getLecturerSession } from "@/server/auth";
import { isValidPublicLectureToken } from "@/server/public-params";
import { getLectureRepository } from "@/server/repository";
import { withParticipationPath } from "@/server/lecture-participation";

export default async function LecturerLivePage({ params }: { params: Promise<{ token: string }> }) {
  const session = await getLecturerSession();
  if (!session) redirect("/lecturer/login");

  const { token } = await params;
  if (!isValidPublicLectureToken(token)) notFound();

  const lecture = (await getLectureRepository().listLectures(session.email)).find((item) => item.publicToken === token);
  if (!lecture) notFound();

  return <LecturerLiveExperience lecture={await withParticipationPath(lecture)} csrfToken={createLecturerCsrfToken(session)} />;
}
