// Pseudonymous student identity.
//
// A student is identified by a stable, browser-wide anonymous key — never a real
// account. The key lives in an httpOnly cookie (for server rendering + API calls)
// and is mirrored to localStorage on the client (so live/learn answer events can be
// tagged with the same key, which is what readiness is computed from).

import { cookies } from "next/headers";

import type { StudentProfile } from "@/lib/types";
import { shouldUseSecureCookies } from "./runtime-config";
import { getStudentRepository } from "./student-repository";

export const STUDENT_COOKIE = "lb_student_key";
const STUDENT_COOKIE_TTL_SECONDS = 60 * 60 * 24 * 365; // 1 year

const ANONYMOUS_KEY_PATTERN = /^[A-Za-z0-9_-]{8,200}$/;

export function isValidAnonymousKey(value: string | undefined | null): value is string {
  return Boolean(value && ANONYMOUS_KEY_PATTERN.test(value));
}

export async function getStudentAnonymousKey(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(STUDENT_COOKIE)?.value;
  return isValidAnonymousKey(value) ? value : null;
}

export async function setStudentCookie(anonymousKey: string): Promise<void> {
  const store = await cookies();
  store.set(STUDENT_COOKIE, anonymousKey, {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookies(),
    maxAge: STUDENT_COOKIE_TTL_SECONDS,
    path: "/"
  });
}

export async function clearStudentCookie(): Promise<void> {
  const store = await cookies();
  store.set(STUDENT_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: shouldUseSecureCookies(), maxAge: 0, path: "/" });
}

/** Resolve the current student profile from the cookie, if any. */
export async function getCurrentStudentProfile(): Promise<StudentProfile | null> {
  const anonymousKey = await getStudentAnonymousKey();
  if (!anonymousKey) return null;
  return getStudentRepository().getProfileByAnonymousKey(anonymousKey);
}

/**
 * Projection safe to send over the wire: never expose the bearer-like `anonymousKey`
 * or `emailHash`. The client already holds its own key in localStorage.
 */
export type PublicStudentProfile = Omit<StudentProfile, "anonymousKey" | "emailHash">;

export function toPublicProfile(profile: StudentProfile): PublicStudentProfile {
  const { anonymousKey: _anonymousKey, emailHash: _emailHash, ...rest } = profile;
  void _anonymousKey;
  void _emailHash;
  return rest;
}
