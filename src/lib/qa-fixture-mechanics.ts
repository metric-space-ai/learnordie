import type { Lecture } from "./types";
import { defaultEvaluationConfig } from "./evaluation";

export const QA_MECHANICS_SERIES_TITLE =
  "Technische Mechanik – kombinierte Belastungen und mehrstufige Berechnungsaufgaben";

export const QA_MECHANICS_JOIN_CODE = "TM-KB-2026";

const longOptionA =
  "Die Vergleichsspannung nach der Gestaltänderungsenergiehypothese erfasst den gesamten Spannungszustand über die Differenzen der Hauptspannungen und bleibt damit für kombinierte Zug-, Biege- und Torsionsanteile anwendbar.";
const longOptionB =
  "Eine rein lineare Addition von Normal- und Schubspannung ohne Hypothese reicht aus, weil beide Anteile unabhängig voneinander zum Bruch führen und sich nicht überlagern.";
const longOptionC =
  "Nur die größte Normalspannung entscheidet, unabhängig davon, ob gleichzeitig Torsion, Kerbwirkung oder eine schwellende Lastamplitude vorliegt.";
const longOptionD =
  "Sicherheiten dürfen bei kombinierten Beanspruchungen entfallen, sobald der Querschnitt plastisch umlagert und die Fließgrenze lokal überschritten wird.";

const longExplanation =
  "Bei kombinierter Beanspruchung müssen Normal- und Schubspannungen über eine Festigkeitshypothese zusammengeführt werden. Die Gestaltänderungsenergiehypothese (von Mises) bildet den mehrachsigen Zustand auf eine Vergleichsspannung ab. Kerbwirkung, Lastkollektiv und Dauerfestigkeit ändern die zulässige Amplitude, ersetzen die Hypothese aber nicht.";

function baseLecture(partial: Pick<Lecture, "id" | "publicToken" | "title" | "status" | "liveAt"> & Partial<Lecture>): Lecture {
  return {
    id: partial.id,
    publicToken: partial.publicToken,
    title: partial.title,
    seriesTitle: QA_MECHANICS_SERIES_TITLE,
    language: "de",
    status: partial.status,
    liveAt: partial.liveAt,
    examDate: partial.examDate ?? "2026-09-18",
    aiAccessUntil: partial.aiAccessUntil ?? "2026-09-18T21:59:59.999Z",
    aiDailyLimit: 20,
    aiDailyTokenLimit: 12000,
    seriesAiDailyLimit: 20,
    seriesAiDailyTokenLimit: 12000,
    tenantAiDailyLimit: 20,
    tenantAiDailyTokenLimit: 12000,
    tenantBudgetKey: "qa-tenant",
    leaderboardEnabled: true,
    learnQuestionDensity: 4,
    evaluationConfig: defaultEvaluationConfig,
    slides: partial.slides ?? qaMechanicsSlides,
    questions: partial.questions ?? qaMechanicsQuestions
  };
}

const qaMechanicsSlides: Lecture["slides"] = [
  {
    id: "tm_s1",
    eyebrow: "Folie 1",
    title: "Kombinierte Beanspruchung",
    topic: "Überlagerung",
    copy: [
      "Welle, Bolzen und Rahmen tragen gleichzeitig Normal- und Schubspannungen.",
      "Die Auslegung trennt die Anteile, führt sie aber über eine Vergleichsspannung wieder zusammen."
    ],
    diagram: "bearing"
  },
  {
    id: "tm_s2",
    eyebrow: "Folie 2",
    title: "Schnittgrößen am Wellenabschnitt",
    topic: "Schnittreaktionen",
    copy: [
      "N, Q, M_b und M_t treten im selben Querschnitt auf.",
      "Vorzeichen und Bezugssystem müssen vor jeder Zahlenrechnung festliegen."
    ],
    diagram: "ramp"
  },
  {
    id: "tm_s3",
    eyebrow: "Folie 3",
    title: "Normal- und Schubspannung",
    topic: "Spannungsbild",
    copy: [
      "Biegung erzeugt eine linear verteilte Normalspannung, Torsion eine Schubspannung am Rand.",
      "Kritisch ist fast immer der Randfaserpunkt mit beiden Anteilen."
    ],
    diagram: "formula"
  },
  {
    id: "tm_s4",
    eyebrow: "Folie 4",
    title: "Gestaltänderungsenergiehypothese",
    topic: "von Mises",
    copy: [
      "σ_v = √(σ² + 3τ²) für den ebenen Fall mit einer Normal- und einer Schubspannung.",
      "Die Formel ist die Brücke von der Schnittgröße zur zulässigen Werkstoffkennzahl."
    ],
    diagram: "formula"
  },
  {
    id: "tm_s5",
    eyebrow: "Folie 5",
    title: "Kerbwirkung und Formzahl",
    topic: "Kerbwirkung",
    copy: [
      "Absätze, Nuten und Presssitze vervielfachen die lokale Spannung.",
      "K_t und K_f gehören in dieselbe Rechnung wie die Vergleichsspannung, nicht danach."
    ],
    diagram: "bearing"
  },
  {
    id: "tm_s6",
    eyebrow: "Folie 6",
    title: "Mehrstufiges Lastkollektiv",
    topic: "Betriebsfestigkeit",
    copy: [
      "Ein Block aus Anfahrzug, Nennbetrieb und Überlast wird nicht durch den Spitzenwert allein beschrieben.",
      "Schadensakkumulation setzt eine geordnete Zählung der Amplituden voraus."
    ],
    diagram: "ramp"
  },
  {
    id: "tm_s7",
    eyebrow: "Folie 7",
    title: "Sicherheit und Nachweis",
    topic: "Nachweis",
    copy: [
      "Statischer Nachweis und Dauerfestigkeitsnachweis sind getrennte Schritte.",
      "Die kleinere Sicherheit gilt; Mischen der Nachweise verbietet sich."
    ],
    diagram: "formula"
  },
  {
    id: "tm_s8",
    eyebrow: "Folie 8",
    title: "Beispiel: Keilwelle unter Biegung und Torsion",
    topic: "Anwendung",
    copy: [
      "Zuerst Schnittgrößen, dann Spannungen, dann Hypothese, dann Kerbwirkung, dann Sicherheit.",
      "Ein übersprungener Schritt macht die restliche Rechnung wertlos."
    ],
    diagram: "bearing"
  },
  {
    id: "tm_s9",
    eyebrow: "Folie 9",
    title: "Typische Fehlerbilder",
    topic: "Fehler",
    copy: [
      "Schub- und Normalspannung addieren, ohne Hypothese.",
      "Kerbwirkung nur auf einen Anteil anwenden oder die Einheit der Sicherheit vergessen."
    ],
    diagram: "ramp"
  },
  {
    id: "tm_s10",
    eyebrow: "Folie 10",
    title: "Transfer in die Klausur",
    topic: "Transfer",
    copy: [
      "Lange Aufgabentexte trennen zuerst Geometrie, Lasten und Werkstoff.",
      "Die Reihenfolge der Rechnung bleibt dieselbe, auch wenn Zahlen und Skizzen wechseln."
    ],
    diagram: "formula"
  }
];

const qaMechanicsQuestions: Lecture["questions"] = [
  {
    level: "4.0",
    points: 1,
    text: "Warum reicht es bei kombinierter Biegung und Torsion nicht, nur die größte Normalspannung mit der Zugfestigkeit zu vergleichen?",
    explanation: longExplanation,
    answers: [
      { key: "A", text: longOptionA, correct: true },
      { key: "B", text: longOptionB, correct: false },
      { key: "C", text: longOptionC, correct: false },
      { key: "D", text: longOptionD, correct: false }
    ]
  },
  {
    level: "3.0",
    points: 2,
    text: "Welche Reihenfolge beschreibt den mehrstufigen Nachweis einer gekerbten Welle unter Biegung und Torsion korrekt?",
    explanation: longExplanation,
    answers: [
      { key: "A", text: "Zuerst Sicherheit wählen, dann Spannungen schätzen, Kerben ignorieren, Hypothese am Ende ergänzen.", correct: false },
      { key: "B", text: "Schnittgrößen bestimmen, Spannungen berechnen, Vergleichsspannung bilden, Kerbwirkung einrechnen, Sicherheit nachweisen.", correct: true },
      { key: "C", text: "Nur die Torsionsspannung mit der Schubfließgrenze vergleichen, weil sie am Rand am größten wirkt.", correct: false },
      { key: "D", text: "Biegung und Torsion getrennt nachweisen und die größere der beiden Sicherheiten als Ergebnis nehmen.", correct: false }
    ]
  },
  {
    level: "2.0",
    points: 3,
    text: "Ein Lastkollektiv enthält Anfahrzug, Nennbetrieb und seltene Überlast. Was folgt für die Auslegung?",
    explanation: longExplanation,
    answers: [
      { key: "A", text: "Nur die Überlast zählt, weil sie die größte Spannung erzeugt und alle kleineren Lasten überdeckt.", correct: false },
      { key: "B", text: "Die Anteile müssen nach Amplitude und Häufigkeit gewichtet werden; eine einzelne Spitze ersetzt das Kollektiv nicht.", correct: true },
      { key: "C", text: "Nennbetrieb darf entfallen, sobald die Überlast im elastischen Bereich bleibt.", correct: false },
      { key: "D", text: "Lastkollektive gelten nur für Schweißnähte, nicht für Wellen mit Kreisquerschnitt.", correct: false }
    ]
  },
  {
    level: "1.0",
    points: 4,
    text: "Welche Aussage zur Kerbwirkung in einer mehrstufigen Berechnung ist zutreffend?",
    explanation: longExplanation,
    answers: [
      { key: "A", text: "Die Formzahl darf nach dem Sicherheitsnachweis optional als Kommentar ergänzt werden.", correct: false },
      { key: "B", text: "Kerbwirkung vervielfacht lokale Spannungen und gehört vor den Vergleich mit zulässigen Werten in dieselbe Rechnung.", correct: true },
      { key: "C", text: "Bei Torsion entfällt die Kerbwirkung, weil Schubspannungen sich am Umfang gleichmäßig verteilen.", correct: false },
      { key: "D", text: "Kerbwirkung ersetzt die Festigkeitshypothese vollständig, sobald K_t größer als 2 ist.", correct: false }
    ]
  }
];

export const qaMechanicsLearnLecture = baseLecture({
  id: "lecture_tm_combined",
  publicToken: "tm-kombiniert-demo",
  title: "Kombinierte Belastungen und mehrstufige Nachweise",
  status: "learn_active",
  liveAt: "2026-05-12T08:00:00.000Z"
});

export const qaMechanicsUpcomingLecture = baseLecture({
  id: "lecture_tm_upcoming",
  publicToken: "tm-kollektiv-live",
  title: "Betriebsfestigkeit: Kollektiv und Nachweisgespräch",
  status: "ready_for_live",
  liveAt: "2026-11-04T07:00:00.000Z",
  slides: qaMechanicsSlides.slice(5, 10),
  questions: qaMechanicsQuestions
});

export const qaMechanicsArchivedLecture = baseLecture({
  id: "lecture_tm_archived",
  publicToken: "tm-abschluss-archiv",
  title: "Abgeschlossene Reihe: Klausurvorbereitung kombinierte Beanspruchung",
  status: "archived",
  liveAt: "2026-02-03T08:00:00.000Z",
  aiAccessUntil: "2026-03-01T21:59:59.999Z",
  slides: qaMechanicsSlides.slice(0, 4),
  questions: qaMechanicsQuestions
});

export const qaMechanicsLectures: Lecture[] = [
  qaMechanicsLearnLecture,
  qaMechanicsUpcomingLecture,
  qaMechanicsArchivedLecture
];
