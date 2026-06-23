"use client";

// Client-side helpers for the pseudonymous student identity. The browser-wide
// anonymous key is stable per browser and is the same key used to tag live/learn
// answer events, so readiness reflects real interactions. Server identity is held
// in an httpOnly cookie set by POST /api/student/profile.

import type { StudentProfile } from "./types";

const STUDENT_KEY = "lb_student_key";

export function getOrCreateStudentKey(): string {
  if (typeof window === "undefined") return "";
  let key = window.localStorage.getItem(STUDENT_KEY);
  if (!key || key.length < 8) {
    key = `student_${crypto.randomUUID()}`;
    window.localStorage.setItem(STUDENT_KEY, key);
  }
  return key;
}

export function peekStudentKey(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STUDENT_KEY);
}

export async function fetchCurrentProfile(): Promise<StudentProfile | null> {
  try {
    const response = await fetch("/api/student/profile", { cache: "no-store" });
    if (!response.ok) return null;
    const data = (await response.json()) as { profile: StudentProfile | null };
    return data.profile ?? null;
  } catch {
    return null;
  }
}

export async function saveProfile(pseudonym: string): Promise<StudentProfile | null> {
  const anonymousKey = getOrCreateStudentKey();
  try {
    const response = await fetch("/api/student/profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ anonymousKey, pseudonym })
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { profile: StudentProfile };
    return data.profile;
  } catch {
    return null;
  }
}
