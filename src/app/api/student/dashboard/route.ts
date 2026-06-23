import { NextResponse } from "next/server";

import { getStudentRepository } from "@/server/student-repository";
import { getCurrentStudentProfile, toPublicProfile } from "@/server/student-session";

export async function GET() {
  const profile = await getCurrentStudentProfile();
  if (!profile) {
    return NextResponse.json({ dashboard: null });
  }
  const dashboard = await getStudentRepository().listStudentDashboard(profile.id);
  return NextResponse.json({
    dashboard: dashboard ? { ...dashboard, profile: toPublicProfile(dashboard.profile) } : null
  });
}
