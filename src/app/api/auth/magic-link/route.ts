import { NextResponse } from "next/server";
import { z } from "zod";

import { createMagicLoginLink, createMagicToken, MagicLinkRateLimitError } from "@/server/auth";
import { getMailProvider } from "@/server/providers/mail";

const MAX_MAGIC_LINK_REQUEST_BYTES = 2048;

const schema = z.object({
  email: z.email()
});

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).length > MAX_MAGIC_LINK_REQUEST_BYTES) {
    return NextResponse.json({ error: "Magic-Link-Anfrage ist zu groß." }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Bitte eine gültige E-Mail eingeben." }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Bitte eine gültige E-Mail eingeben." }, { status: 400 });
  }

  try {
    const token = await createMagicToken(parsed.data.email);
    const magicLink = createMagicLoginLink(request, token);
    const delivery = await getMailProvider().sendMagicLink({ email: parsed.data.email, magicLink });
    return NextResponse.json({
      sent: true,
      ...(delivery.delivery === "local" ? { magicLink: delivery.magicLink } : {})
    });
  } catch (error) {
    if (error instanceof MagicLinkRateLimitError) {
      return NextResponse.json({
        error: "Zu viele Magic-Link-Anfragen. Bitte später erneut versuchen.",
        retryAfterSeconds: error.retryAfterSeconds
      }, {
        status: 429,
        headers: { "retry-after": String(error.retryAfterSeconds) }
      });
    }
    console.error("Magic link delivery failed", error);
    return NextResponse.json({ error: "Magic Link konnte nicht versendet werden." }, { status: 502 });
  }
}
