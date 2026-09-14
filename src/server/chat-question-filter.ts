import type { Lecture } from "@/lib/types";

const STOP_WORDS = new Set(["einer", "einen", "einem", "eines", "diese", "dieser", "diesem", "dieses", "werden", "welche", "welcher", "welches", "warum", "durch", "nicht", "kann", "konnen", "wird", "sind", "eine", "dass", "auch", "beim", "nach", "unter", "vorlesung", "thema"]);

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss");
}

function lectureTerms(lecture: Lecture, currentTranscript: string) {
  const text = [
    lecture.title,
    lecture.seriesTitle,
    currentTranscript,
    ...lecture.slides.flatMap((slide) => [slide.title, slide.topic, ...slide.copy]),
    ...lecture.questions.flatMap((question) => [question.text, question.explanation]),
    ...(lecture.materials ?? []).flatMap((material) => [material.originalName, material.extractedTextPreview ?? ""])
  ].join(" ");

  return new Set(
    normalize(text)
      .split(/[^a-z0-9äöü]+/i)
      .filter((term) => term.length >= 4 && !STOP_WORDS.has(term))
  );
}

export function evaluateStudentChatQuestion(lecture: Lecture, text: string, currentTranscript = "") {
  const clean = text.replace(/\s+/g, " ").trim();
  const normalized = normalize(clean);
  const terms = lectureTerms(lecture, currentTranscript);
  const lectureMatches = [...terms].filter((term) => normalized.includes(term)).slice(0, 4);

  if (clean.length < 12) {
    return {
      status: "ignored" as const,
      reason: "Zu kurz für eine fachliche Einordnung.",
      sourceTopic: undefined,
      matches: []
    };
  }

  if (lectureMatches.length === 0) {
    return {
      status: "ignored" as const,
      reason: "Kein Bezug zu den verfügbaren Vorlesungsinhalten oder dem aktuellen Live-Text erkannt.",
      sourceTopic: undefined,
      matches: []
    };
  }

  const sourceTopic = lectureMatches[0] ?? lecture.title;
  const matches = lectureMatches;
  return {
    status: "accepted" as const,
    reason: `Fachbezug erkannt: ${matches.slice(0, 3).join(", ") || lecture.title}.`,
    sourceTopic,
    matches
  };
}
