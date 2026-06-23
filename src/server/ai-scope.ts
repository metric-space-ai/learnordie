import type { Lecture } from "@/lib/types";

const MIN_TOKEN_LENGTH = 4;

const STOPWORDS = new Set([
  "aber",
  "alle",
  "auch",
  "beim",
  "bitte",
  "dann",
  "dass",
  "deine",
  "diese",
  "dieser",
  "dieses",
  "doch",
  "eine",
  "einer",
  "eines",
  "frage",
  "fragen",
  "gibt",
  "habe",
  "hier",
  "kann",
  "kannst",
  "macht",
  "mein",
  "meine",
  "nicht",
  "noch",
  "oder",
  "sich",
  "sind",
  "über",
  "uber",
  "und",
  "was",
  "weil",
  "wenn",
  "wie",
  "wird",
  "wurde",
  "zur"
]);

const DOMAIN_TERMS = [
  "anlauf",
  "belastung",
  "drehzahl",
  "festkoerperkontakt",
  "festkorperkontakt",
  "gleitlager",
  "gleitlagerung",
  "hydrodynamisch",
  "keilspalt",
  "lager",
  "lagerspiel",
  "maschinenbau",
  "maschinenelemente",
  "mischreibung",
  "reibung",
  "relativbewegung",
  "schmier",
  "schmierfilm",
  "schmierstoff",
  "sommerfeld",
  "spalt",
  "stribeck",
  "tribologie",
  "verschleiss",
  "viskositaet",
  "viskositat",
  "waerme",
  "warme",
  "welle"
];

const OFF_TOPIC_TERMS = [
  "aktie",
  "bitcoin",
  "casino",
  "flug",
  "fussball",
  "hotel",
  "medizin",
  "pizza",
  "rezept",
  "steuererklaerung",
  "urlaub",
  "wetter"
];

const LEARNING_INTENT_PATTERNS = [
  /anwend/,
  /bedeut/,
  /beispiel/,
  /berechn/,
  /einfach/,
  /erklaer/,
  /erklar/,
  /folie/,
  /formel/,
  /frage/,
  /hilf/,
  /kontext/,
  /loes/,
  /losung/,
  /nochmal/,
  /praxis/,
  /rechne/,
  /thema/,
  /transfer/,
  /unterschied/,
  /versteh/,
  /vertief/,
  /warum/,
  /zusammenfass/
];

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string) {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length >= MIN_TOKEN_LENGTH && !STOPWORDS.has(token));
}

function lectureScopeTerms(lecture: Lecture) {
  const textParts = [
    lecture.title,
    lecture.seriesTitle,
    ...lecture.slides.flatMap((slide) => [slide.eyebrow, slide.title, slide.topic, ...slide.copy]),
    ...lecture.questions.flatMap((question) => [
      question.text,
      question.explanation,
      question.learningObjective ?? "",
      question.sourceRef ?? "",
      ...question.answers.map((answer) => answer.text)
    ]),
    ...(lecture.materials ?? []).flatMap((material) => [
      material.originalName,
      material.extractedTextPreview ?? "",
      ...(material.sourceRefs ?? [])
    ])
  ];

  return new Set([...DOMAIN_TERMS.map(normalizeText), ...tokens(textParts.join(" "))].filter(Boolean));
}

function hasTermMatch(messageToken: string, scopeTerms: Set<string>) {
  if (scopeTerms.has(messageToken)) return true;
  if (messageToken.length < 6) return false;

  for (const term of scopeTerms) {
    if (term.length < 6) continue;
    if (term.includes(messageToken) || messageToken.includes(term)) return true;
  }

  return false;
}

export function evaluateLectureAiScope(input: { lecture: Lecture; message: string }) {
  const normalizedMessage = normalizeText(input.message);
  const messageTokens = tokens(input.message);
  const scopeTerms = lectureScopeTerms(input.lecture);
  const matchedTerms = [...new Set(messageTokens.filter((token) => hasTermMatch(token, scopeTerms)))].slice(0, 8);
  const offTopicTerms = OFF_TOPIC_TERMS.filter((term) => normalizedMessage.includes(normalizeText(term)));
  const hasLearningIntent = LEARNING_INTENT_PATTERNS.some((pattern) => pattern.test(normalizedMessage));

  if (offTopicTerms.length > 0) {
    return {
      allowed: false,
      reason: "off_topic",
      matchedTerms,
      offTopicTerms
    };
  }

  if (matchedTerms.length > 0 || hasLearningIntent) {
    return {
      allowed: true,
      reason: matchedTerms.length > 0 ? "matched_scope_terms" : "learning_intent",
      matchedTerms,
      offTopicTerms
    };
  }

  return {
    allowed: false,
    reason: "no_lecture_scope",
    matchedTerms,
    offTopicTerms
  };
}
