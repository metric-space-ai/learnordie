import { redirect } from "next/navigation";

import { StudentSeriesDetail } from "@/components/student/StudentSeriesDetail";
import { getStudentRepository } from "@/server/student-repository";
import { getCurrentStudentProfile } from "@/server/student-session";

export const dynamic = "force-dynamic";

export default async function StudentSeriesPage({ params }: { params: Promise<{ seriesId: string }> }) {
  const profile = await getCurrentStudentProfile();
  if (!profile) redirect("/student");

  const { seriesId } = await params;
  const series = await getStudentRepository().getStudentSeriesDetail(profile.id, decodeURIComponent(seriesId));
  if (!series) redirect("/student");

  return <StudentSeriesDetail series={series} />;
}
