import type { Lecture } from "@/lib/types";

const DOMAIN_TERMS = [
  "gleitlager",
  "lager",
  "mischreibung",
  "stribeck",
  "viskos",
  "schmier",
  "schmierfilm",
  "reibung",
  "welle",
  "drehzahl",
  "last",
  "belastung",
  "sommerfeld",
  "anlauf",
  "hydrodynam",
  "festkörperkontakt",
  "festkoerperkontakt",
  "verschleiß",
  "verschleiss"
];

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss");
}

function lectureTerms(lecture: Lecture) {
  const text = [
    lecture.title,
    lecture.seriesTitle,
    ...lecture.slides.flatMap((slide) => [slide.title, slide.topic, ...slide.copy]),
    ...lecture.questions.flatMap((question) => [question.text, question.explanation]),
    ...(lecture.materials ?? []).flatMap((material) => [material.originalName, material.extractedTextPreview ?? ""])
  ].join(" ");

  return new Set(
    normalize(text)
      .split(/[^a-z0-9äöü]+/i)
      .filter((term) => term.length >= 5)
  );
}

export function evaluateStudentChatQuestion(lecture: Lecture, text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  const normalized = normalize(clean);
  const terms = lectureTerms(lecture);
  const domainMatches = DOMAIN_TERMS.filter((term) => normalized.includes(normalize(term)));
  const lectureMatches = [...terms].filter((term) => normalized.includes(term)).slice(0, 4);

  if (clean.length < 12) {
    return {
      status: "ignored" as const,
      reason: "Zu kurz für eine fachliche Einordnung.",
      sourceTopic: undefined,
      matches: []
    };
  }

  if (domainMatches.length === 0 && lectureMatches.length === 0) {
    return {
      status: "ignored" as const,
      reason: "Kein Bezug zu Gleitlagerung, Schmierung oder den aktuellen Vorlesungsbegriffen erkannt.",
      sourceTopic: undefined,
      matches: []
    };
  }

  const sourceTopic = domainMatches[0] ?? lectureMatches[0] ?? lecture.title;
  const matches = [...domainMatches, ...lectureMatches].slice(0, 4);
  return {
    status: "accepted" as const,
    reason: `Fachbezug erkannt: ${matches.slice(0, 3).join(", ") || lecture.title}.`,
    sourceTopic,
    matches
  };
}
