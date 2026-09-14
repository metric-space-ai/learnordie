import { NextResponse } from "next/server";
import { z } from "zod";

import { consumeLoginCode, LoginCodeAttemptsError } from "@/server/auth";
import { readJsonBody } from "@/server/request-json";

const schema = z.object({
  email: z.email(),
  code: z.string().trim().regex(/^\d{6}$/)
});

export async function POST(request: Request) {
  const body = await readJsonBody(request, 2048);
  if (!body.ok) return NextResponse.json({ error: "Bitte E-Mail und 6-stelligen Code eingeben." }, { status: 400 });
  const parsed = schema.safeParse(body.body);
  if (!parsed.success) return NextResponse.json({ error: "Bitte den 6-stelligen Code eingeben." }, { status: 400 });

  try {
    const session = await consumeLoginCode(parsed.data.email, parsed.data.code);
    if (!session) return NextResponse.json({ error: "Code falsch oder abgelaufen." }, { status: 401 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof LoginCodeAttemptsError) {
      return NextResponse.json(
        { error: "Zu viele Versuche. Bitte neuen Code anfordern.", retryAfterSeconds: error.retryAfterSeconds },
        { status: 429, headers: { "retry-after": String(error.retryAfterSeconds) } }
      );
    }
    console.error("Login code verification failed", error);
    return NextResponse.json({ error: "Anmeldung fehlgeschlagen. Bitte erneut versuchen." }, { status: 500 });
  }
}
