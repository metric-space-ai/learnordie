import { JoinFlow } from "@/components/student/JoinFlow";
import { getStudentRepository } from "@/server/student-repository";
import { getCurrentStudentProfile } from "@/server/student-session";

export const dynamic = "force-dynamic";

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const decoded = decodeURIComponent(code);
  const [target, profile] = await Promise.all([
    getStudentRepository().resolveJoinCode(decoded),
    getCurrentStudentProfile()
  ]);

  return (
    <JoinFlow
      code={decoded}
      target={target}
      hasProfile={Boolean(profile)}
      pseudonym={profile?.pseudonym}
    />
  );
}
