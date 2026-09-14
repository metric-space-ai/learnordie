import { z } from "zod";
import { answerLiveSession, liveLecture, readLiveSession } from "@/server/live-session-repository";
import { liveError, liveJson, sameOrigin } from "@/server/live-session-http";
import { isValidPublicLectureToken } from "@/server/public-params";
import { readJsonBody } from "@/server/request-json";
import { getStudentAnonymousKey } from "@/server/student-session";

export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  if (!isValidPublicLectureToken(token)) return liveJson({ error: "Vorlesung nicht gefunden." }, 404);
  try {
    return liveJson(await readLiveSession(await liveLecture(token), await getStudentAnonymousKey(), new URL(request.url).searchParams.get("leaderboard") === "1"));
  } catch (error) { return liveError(error); }
}
const answer = z.object({ sessionId: z.uuid(), roundId: z.uuid(), level: z.enum(["1.0", "2.0", "3.0", "4.0"]), selected: z.enum(["A", "B", "C", "D"]) }).strict();
export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  if (!sameOrigin(request)) return liveJson({ error: "Sicherheitsprüfung fehlgeschlagen." }, 403);
  const { token } = await context.params;
  if (!isValidPublicLectureToken(token)) return liveJson({ error: "Vorlesung nicht gefunden." }, 404);
  const anonymousKey = await getStudentAnonymousKey();
  if (!anonymousKey) return liveJson({ error: "Teilnahme wird noch vorbereitet." }, 401);
  const body = await readJsonBody(request, 2048);
  if (!body.ok) return liveJson({ error: "Ungültige Antwort." }, body.status);
  const parsed = answer.safeParse(body.body);
  if (!parsed.success) return liveJson({ error: "Ungültige Antwort." }, 400);
  try {
    const lecture = await liveLecture(token);
    return liveJson({ receipt: await answerLiveSession(lecture.id, anonymousKey, parsed.data) });
  } catch (error) { return liveError(error); }
}
