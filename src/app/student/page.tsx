import { StudentDashboard } from "@/components/student/StudentDashboard";
import { StudentOnboarding } from "@/components/student/StudentOnboarding";
import { getStudentRepository } from "@/server/student-repository";
import { getCurrentStudentProfile } from "@/server/student-session";

export const dynamic = "force-dynamic";

export default async function StudentDashboardPage() {
  const profile = await getCurrentStudentProfile();
  if (!profile) {
    return <StudentOnboarding />;
  }

  const dashboard = await getStudentRepository().listStudentDashboard(profile.id);
  if (!dashboard) {
    return <StudentOnboarding />;
  }

  return <StudentDashboard initialDashboard={dashboard} />;
}
