import { notFound, redirect } from "next/navigation";
import { isValidPublicLectureToken } from "@/server/public-params";

// Old bookmarks must not opt out of an ongoing live lecture.
export default async function LearnPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isValidPublicLectureToken(token)) notFound();

  redirect(`/l/${encodeURIComponent(token)}`);
}
