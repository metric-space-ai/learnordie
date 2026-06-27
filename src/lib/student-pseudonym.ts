const BASE_PSEUDONYMS = [
  "Stribeck-Scout",
  "Lagerpunkt-7",
  "Reibwert-Pilot",
  "Gleitkeil",
  "Oelfilm-42",
  "Wellenblick",
  "Keilspalt",
  "Drehmoment"
];

function hashSeed(seed: string) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export function suggestPseudonyms(seed = "learnordie", count = 3): string[] {
  const start = hashSeed(seed) % BASE_PSEUDONYMS.length;
  return Array.from({ length: count }, (_, index) => BASE_PSEUDONYMS[(start + index) % BASE_PSEUDONYMS.length]);
}
