import { JoinFlow } from "@/components/student/JoinFlow";
import { getStudentRepository } from "@/server/student-repository";
import { getCurrentStudentProfile } from "@/server/student-session";
import { redirect } from "next/navigation";
import { activeClassroomForJoin } from "@/server/lecture-participation";

export const dynamic = "force-dynamic";

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const decoded = decodeURIComponent(code);
  const repository = getStudentRepository();
  const [target, profile] = await Promise.all([
    repository.resolveJoinCode(decoded),
    getCurrentStudentProfile()
  ]);
  const liveToken = target ? await activeClassroomForJoin(target) : null;
  if (liveToken) redirect(`/l/${encodeURIComponent(liveToken)}`);
  const claim = profile && target ? await repository.getActiveClaim(profile.id, target.seriesId) : null;

  return (
    <JoinFlow
      code={decoded}
      target={target}
      hasProfile={Boolean(profile)}
      hasClaim={Boolean(claim?.displayName)}
      pseudonym={claim?.displayName ?? profile?.pseudonym}
    />
  );
}
