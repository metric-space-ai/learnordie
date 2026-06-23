const PUBLIC_LECTURE_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/;
const MAX_PUBLIC_ANONYMOUS_KEY_LENGTH = 160;

export function isValidPublicLectureToken(token: string | undefined): token is string {
  if (!token) return false;
  return PUBLIC_LECTURE_TOKEN_PATTERN.test(token);
}

export type PublicAnonymousKeyParse =
  | { ok: true; value?: string }
  | { ok: false };

export function parsePublicAnonymousKey(value: string | null | undefined): PublicAnonymousKeyParse {
  const trimmed = value?.trim();
  if (!trimmed) return { ok: true };
  if (trimmed.length > MAX_PUBLIC_ANONYMOUS_KEY_LENGTH) return { ok: false };
  return { ok: true, value: trimmed };
}
