import { notFound, redirect } from "next/navigation";

import { LecturerLiveExperience } from "@/components/LecturerLiveExperience";
import { createLecturerCsrfToken, getLecturerSession } from "@/server/auth";
import { isValidPublicLectureToken } from "@/server/public-params";
import { getLectureRepository } from "@/server/repository";

export default async function LecturerLivePage({ params }: { params: Promise<{ token: string }> }) {
  const session = await getLecturerSession();
  if (!session) redirect("/lecturer/login");

  const { token } = await params;
  if (!isValidPublicLectureToken(token)) notFound();

  const lecture = await getLectureRepository().getLectureByToken(token);
  if (!lecture) notFound();

  return <LecturerLiveExperience lecture={lecture} csrfToken={createLecturerCsrfToken(session)} />;
}
