"use client";

// Client-side helpers for the pseudonymous student identity. The browser-wide
// anonymous key is stable per browser and is the same key used to tag live/learn
// answer events, so readiness reflects real interactions. Server identity is held
// in an httpOnly cookie set by POST /api/student/profile.

import { suggestPseudonyms } from "./student-pseudonym";
import type { StudentProfile } from "./types";

const STUDENT_KEY = "lb_student_key";
const enrollmentRequests = new Map<string, Promise<void>>();

/** Reading slides never requires a name form; persist the browser identity lazily. */
export function ensureStudentEnrollment(input: {
  seriesId: string; seriesTitle: string; lectureId: string;
  source: "direct_live_link" | "direct_learn_link";
}): Promise<void> {
  // A visit to another lecture must still validate/touch its enrollment; titles
  // and series-wide promise caching must never suppress that server check.
  const key = `${getOrCreateStudentKey()}:${input.seriesId}:${input.lectureId}`;
  const existing = enrollmentRequests.get(key);
  if (existing) return existing;
  const operation = (async () => {
    const profile = await saveProfile();
    if (!profile.ok) throw new Error(profile.error);
    let displayName: string | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch("/api/student/enrollments", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...input, displayName })
      });
      const data = await response.json() as { code?: string; suggestions?: string[]; error?: string };
      if (response.ok) return;
      if (data.code !== "pseudonym_taken" || !data.suggestions?.[0]) throw new Error(data.error ?? "Teilnahme konnte nicht gespeichert werden.");
      displayName = data.suggestions[0];
    }
    throw new Error("Teilnahme konnte nicht gespeichert werden. Bitte erneut versuchen.");
  })();
  enrollmentRequests.set(key, operation);
  operation.catch(() => enrollmentRequests.delete(key));
  return operation;
}

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

export async function fetchPseudonymSuggestions(seriesId?: string): Promise<string[]> {
  try {
    const query = seriesId ? `?seriesId=${encodeURIComponent(seriesId)}` : "";
    const response = await fetch(`/api/student/pseudonyms${query}`, { cache: "no-store" });
    if (!response.ok) return suggestPseudonyms({ count: 3 });
    const data = (await response.json()) as { suggestions?: string[] };
    if (Array.isArray(data.suggestions) && data.suggestions.length > 0) {
      return data.suggestions.slice(0, 3);
    }
  } catch {
    // fall through to local generation
  }
  return suggestPseudonyms({ count: 3 });
}

export type SaveProfileResult =
  | { ok: true; profile: StudentProfile }
  | { ok: false; error: string; suggestions?: string[] };

export async function saveProfile(pseudonym?: string): Promise<SaveProfileResult> {
  const anonymousKey = getOrCreateStudentKey();
  try {
    const response = await fetch("/api/student/profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ anonymousKey, pseudonym })
    });
    const data = (await response.json().catch(() => ({}))) as {
      profile?: StudentProfile;
      error?: string;
      suggestions?: string[];
    };
    if (!response.ok || !data.profile) {
      return {
        ok: false,
        error: data.error ?? "Profil konnte nicht gespeichert werden.",
        suggestions: Array.isArray(data.suggestions) ? data.suggestions : undefined
      };
    }
    return { ok: true, profile: data.profile };
  } catch {
    return { ok: false, error: "Netzwerkfehler. Eingabe bleibt stehen — bitte erneut versuchen." };
  }
}

export async function claimSeriesDisplayName(
  seriesId: string,
  displayName: string
): Promise<SaveProfileResult & { displayName?: string }> {
  try {
    const response = await fetch("/api/student/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seriesId, displayName })
    });
    const data = (await response.json().catch(() => ({}))) as {
      claim?: { displayName?: string };
      error?: string;
      suggestions?: string[];
    };
    if (!response.ok || !data.claim?.displayName) {
      return {
        ok: false,
        error: data.error ?? "Name konnte nicht gespeichert werden.",
        suggestions: Array.isArray(data.suggestions) ? data.suggestions : undefined
      };
    }
    const profile = await fetchCurrentProfile();
    if (!profile) {
      return { ok: false, error: "Profil konnte nicht geladen werden." };
    }
    return { ok: true, profile, displayName: data.claim.displayName };
  } catch {
    return { ok: false, error: "Netzwerkfehler. Eingabe bleibt stehen — bitte erneut versuchen." };
  }
}
