import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createMagicLoginLink, createMagicToken, MagicLinkRateLimitError } from "@/server/auth";
import { getMailProvider } from "@/server/providers/mail";

const MAX_MAGIC_LINK_FORM_BYTES = 4096;

const schema = z.object({
  email: z.email()
});

export async function POST(request: NextRequest) {
  const redirectUrl = new URL("/lecturer/login", request.url);
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_MAGIC_LINK_FORM_BYTES) {
    redirectUrl.searchParams.set("error", "invalid-email");
    return NextResponse.redirect(redirectUrl, 303);
  }

  const formData = await request.formData();
  const parsed = schema.safeParse({ email: formData.get("email") });

  if (!parsed.success) {
    redirectUrl.searchParams.set("error", "invalid-email");
    return NextResponse.redirect(redirectUrl, 303);
  }

  try {
    const token = await createMagicToken(parsed.data.email);
    const magicLink = createMagicLoginLink(request, token);
    const delivery = await getMailProvider().sendMagicLink({ email: parsed.data.email, magicLink });
    redirectUrl.searchParams.set("sent", "1");
    if (delivery.delivery === "local") {
      redirectUrl.searchParams.set("magicLink", delivery.magicLink);
    }
  } catch (error) {
    if (error instanceof MagicLinkRateLimitError) {
      redirectUrl.searchParams.set("error", "rate-limited");
      return NextResponse.redirect(redirectUrl, 303);
    }
    console.error("Magic link delivery failed", error);
    redirectUrl.searchParams.set("error", "send-failed");
  }

  return NextResponse.redirect(redirectUrl, 303);
}
