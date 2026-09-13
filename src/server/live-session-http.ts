import { NextResponse } from "next/server";
import { LiveSessionError } from "./live-session-repository";
export { sameOrigin } from "./request-origin";

// State and personal receipts must never be shared by a CDN/browser cache.
export function liveJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" } });
}
export function liveError(error: unknown) {
  if (error instanceof LiveSessionError) return liveJson({ error: error.message }, error.status);
  console.error("Live session storage unavailable");
  return liveJson({ error: "Live-Verbindung nicht verfügbar. Bitte erneut versuchen." }, 503);
}
