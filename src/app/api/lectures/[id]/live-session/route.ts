import { z } from "zod";
import { getLecturerSession, isValidLecturerCsrfRequest } from "@/server/auth";
import { liveError, liveJson } from "@/server/live-session-http";
import { commandLiveSession, liveLecture, readLiveSession } from "@/server/live-session-repository";
import { readJsonBody } from "@/server/request-json";
import { getLectureRepository } from "@/server/repository";
import { isValidRouteEntityId } from "@/server/route-params";

export const dynamic = "force-dynamic";
const revision = z.number().int().min(0).max(2147483646);
const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), revision }),
  z.object({ action: z.literal("slide"), revision, slideIndex: z.number().int().min(0), showIntro: z.boolean() }),
  z.object({ action: z.literal("fire"), revision, familyIndex: z.number().int().min(0), durationSeconds: z.number().int().min(5).max(180), familyId: z.string().min(1).max(120).optional(), sessionId: z.string().uuid().optional(), prepared: z.boolean().optional() }),
  z.object({ action: z.literal("publishDraft"), revision, questionId: z.string().min(1).max(120) }),
  z.object({ action: z.literal("close"), revision }),
  z.object({ action: z.literal("end"), revision })
]);
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getLecturerSession();
  if (!session) return liveJson({ error: "Nicht angemeldet." }, 401);
  if (!isValidLecturerCsrfRequest(request, session)) return liveJson({ error: "Sicherheitsprüfung fehlgeschlagen." }, 403);
  const { id } = await context.params;
  if (!isValidRouteEntityId(id)) return liveJson({ error: "Vorlesung nicht gefunden." }, 404);
  const body = await readJsonBody(request, 2048);
  if (!body.ok) return liveJson({ error: "Ungültige Anfrage." }, body.status);
  const parsed = command.safeParse(body.body);
  if (!parsed.success) return liveJson({ error: "Ungültiger Sitzungsbefehl." }, 400);
  try {
    const repository = getLectureRepository();
    const lecture = (await repository.listLectures(session.email)).find((item) => item.id === id);
    if (!lecture) return liveJson({ error: "Vorlesung nicht gefunden." }, 404);
    // Also enforce ownership at the database boundary (public token is not teacher authority).
    const context = await liveLecture(lecture.publicToken, session.email);
    await commandLiveSession(lecture, parsed.data);
    return liveJson(await readLiveSession(context, null, false));
  } catch (error) { return liveError(error); }
}
