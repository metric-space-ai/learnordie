const NOUNS = [
  "Zahnrad",
  "Lager",
  "Keilspalt",
  "Welle",
  "Bolzen",
  "Nabe",
  "Feder",
  "Riemen",
  "Kette",
  "Nocken",
  "Kolben",
  "Ventil",
  "Spindel",
  "Scheibe",
  "Passfeder",
  "Gleitkeil",
  "Oelfilm",
  "Reibwert",
  "Sommerfeld",
  "Stribeck"
];

const TAGS = [
  "Joe",
  "Max",
  "Kim",
  "Liv",
  "Ben",
  "Pia",
  "Kai",
  "Mo",
  "Tess",
  "Nia",
  "Scout",
  "Pilot",
  "Nova",
  "Rex",
  "Ivy",
  "Lux"
];

export const PSEUDONYM_MAX_LENGTH = 40;
export const PSEUDONYM_MIN_LENGTH = 2;

const RESERVED_PSEUDONYM_KEYS = new Set(["anonymisiert", "pseudonym", "anonym"]);

export function normalizePseudonym(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/g, " ").slice(0, PSEUDONYM_MAX_LENGTH);
}

export function pseudonymKey(value: string): string {
  return normalizePseudonym(value).toLocaleLowerCase("de-DE");
}

export function isReservedPseudonym(value: string): boolean {
  return RESERVED_PSEUDONYM_KEYS.has(pseudonymKey(value));
}

export function validateClaimablePseudonym(value: string): string | null {
  const normalized = normalizePseudonym(value);
  if (normalized.length < PSEUDONYM_MIN_LENGTH) return null;
  if (isReservedPseudonym(normalized)) return null;
  return normalized;
}

function randomIndex(length: number, random: () => number) {
  return Math.min(length - 1, Math.floor(random() * length));
}

export function generatePseudonym(random: () => number = Math.random): string {
  const noun = NOUNS[randomIndex(NOUNS.length, random)]!;
  const tag = TAGS[randomIndex(TAGS.length, random)]!;
  const number = 2 + randomIndex(98, random);
  const pattern = randomIndex(3, random);
  if (pattern === 0) return `${noun}-${tag}`;
  if (pattern === 1) return `${noun}-${number}`;
  return `${tag}-${noun}`;
}

export function suggestPseudonyms(options: {
  count?: number;
  exclude?: Iterable<string>;
  random?: () => number;
} = {}): string[] {
  const count = Math.max(1, options.count ?? 3);
  const exclude = new Set(Array.from(options.exclude ?? []).map(pseudonymKey));
  const picked: string[] = [];
  const pickedKeys = new Set<string>();
  const random = options.random ?? Math.random;

  for (let attempt = 0; attempt < 400 && picked.length < count; attempt += 1) {
    const next = generatePseudonym(random);
    const key = pseudonymKey(next);
    if (exclude.has(key) || pickedKeys.has(key)) continue;
    picked.push(next);
    pickedKeys.add(key);
  }

  return picked;
}

export function stableSuffix(profileId: string): string {
  const compact = profileId.replace(/[^a-zA-Z0-9]/g, "").slice(-3).toUpperCase();
  return compact || "X";
}

function uniqueSuffixedName(stemSource: string, profileId: string, takenKeys: Set<string>): string {
  const suffix = stableSuffix(profileId);
  const stem = stemSource.slice(0, Math.max(PSEUDONYM_MIN_LENGTH, PSEUDONYM_MAX_LENGTH - suffix.length - 1));
  let candidate = `${stem}·${suffix}`.slice(0, PSEUDONYM_MAX_LENGTH);
  let index = 2;
  while (takenKeys.has(pseudonymKey(candidate))) {
    const extra = `${index}`;
    const nextStem = stemSource.slice(
      0,
      Math.max(PSEUDONYM_MIN_LENGTH, PSEUDONYM_MAX_LENGTH - suffix.length - extra.length - 1)
    );
    candidate = `${nextStem}·${suffix}${extra}`.slice(0, PSEUDONYM_MAX_LENGTH);
    index += 1;
  }
  return candidate;
}

/** Deterministic unique label for migration. Repeating with the same inputs yields the same name. */
export function migratedDisplayName(base: string, profileId: string, taken: Iterable<string>): string {
  const takenKeys = new Set(Array.from(taken).map(pseudonymKey));
  const preferred = validateClaimablePseudonym(base);
  if (preferred && !takenKeys.has(pseudonymKey(preferred))) return preferred;
  return uniqueSuffixedName(preferred ?? "Teilnehmer", profileId, takenKeys);
}

export function anonymizedDisplayName(profileId: string, taken: Iterable<string>): string {
  const takenKeys = new Set(Array.from(taken).map(pseudonymKey));
  return uniqueSuffixedName("Anonym", profileId, takenKeys);
}

export function suggestionsWithoutRejected(suggestions: string[], rejected: string): string[] {
  const key = pseudonymKey(rejected);
  if (!key) return suggestions;
  return suggestions.filter((item) => pseudonymKey(item) !== key);
}
