// Join Code product object helpers.
//
// A join code is a deliberately communicated, human-readable code (e.g. "ME1-GL-2026").
// It is NOT the technical `publicToken`. Codes are normalized case-insensitively and
// must be URL-safe: letters, digits and single dashes only.

export const JOIN_CODE_MAX_LENGTH = 40;
export const JOIN_CODE_MIN_LENGTH = 3;

/**
 * Normalize a join code for storage and lookup.
 * - upper-cases
 * - trims
 * - collapses any run of non-alphanumeric characters to a single dash
 * - strips leading/trailing dashes
 *
 * The normalized form is what uniqueness and resolution are based on, so
 * "me1 gl 2026", "ME1/GL/2026" and "ME1-GL-2026" all resolve to "ME1-GL-2026".
 */
export function normalizeJoinCode(input: string): string {
  return input
    .toUpperCase()
    .normalize("NFKD")
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, JOIN_CODE_MAX_LENGTH)
    .replace(/-+$/g, "");
}

/** A code is valid if its normalized form is long enough and only contains URL-safe chars. */
export function isValidJoinCode(input: string): boolean {
  const normalized = normalizeJoinCode(input);
  return normalized.length >= JOIN_CODE_MIN_LENGTH && /^[A-Z0-9-]+$/.test(normalized);
}

/** Returns the normalized, display-friendly code, or null if invalid. */
export function sanitizeJoinCode(input: string): string | null {
  if (!isValidJoinCode(input)) return null;
  return normalizeJoinCode(input);
}

/**
 * Extract a join code from arbitrary user input that may be a bare code, a `/join/<code>`
 * path or a full URL. Returns the normalized code or null.
 */
export function joinCodeFromInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  let candidate = trimmed;
  try {
    const url = new URL(trimmed);
    const parts = url.pathname.split("/").filter(Boolean);
    const joinIndex = parts.findIndex((part) => part === "join");
    candidate = joinIndex >= 0 && parts[joinIndex + 1] ? parts[joinIndex + 1] : parts.at(-1) ?? trimmed;
  } catch {
    candidate = trimmed.replace(/^\/+/, "").split("/").filter(Boolean).at(-1) ?? trimmed;
  }

  return sanitizeJoinCode(decodeURIComponent(candidate));
}
