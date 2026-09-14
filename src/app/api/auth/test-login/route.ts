import { NextResponse } from "next/server";
import { z } from "zod";

import { loginTestAccount, MagicLinkRateLimitError } from "@/server/auth";
import { readJsonBody } from "@/server/request-json";
import { configuredTestAccounts } from "@/server/test-accounts";
import { sameOrigin } from "@/server/request-origin";

const schema = z.object({ email: z.email().max(160), password: z.string().min(1).max(256) });

export async function POST(request: Request) {
  if (!configuredTestAccounts().length) return NextResponse.json({ error: "Testzugang nicht verfügbar." }, { status: 404 });
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "Anfrage nicht erlaubt." }, { status: 403 });
  }
  const body = await readJsonBody(request, 4096);
  if (!body.ok) return NextResponse.json({ error: "Ungültige Anmeldung." }, { status: body.status });
  const parsed = schema.safeParse(body.body);
  if (!parsed.success) return NextResponse.json({ error: "Bitte E-Mail und Passwort eingeben." }, { status: 400 });
  try {
    const session = await loginTestAccount(parsed.data.email, parsed.data.password);
    if (!session) return NextResponse.json({ error: "E-Mail oder Passwort falsch." }, { status: 401 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof MagicLinkRateLimitError) {
      return NextResponse.json({ error: "Zu viele Versuche. Bitte später erneut versuchen." }, {
        status: 429, headers: { "retry-after": String(error.retryAfterSeconds) }
      });
    }
    console.error("Test account login failed");
    return NextResponse.json({ error: "Anmeldung momentan nicht möglich." }, { status: 503 });
  }
}
