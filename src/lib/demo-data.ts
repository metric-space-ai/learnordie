import type { Lecture } from "./types";
import { defaultEvaluationConfig } from "./evaluation";

export const demoLecture: Lecture = {
  id: "lecture_gleitlagerung",
  publicToken: "gleitlagerung-demo",
  title: "Gleitlagerung",
  seriesTitle: "Maschinenelemente I",
  language: "de",
  status: "learn_active",
  liveAt: "2026-06-17T10:00:00.000Z",
  examDate: "2027-07-23",
  aiAccessUntil: "2027-07-23T21:59:59.999Z",
  aiDailyLimit: 20,
  aiDailyTokenLimit: 12000,
  seriesAiDailyLimit: 20,
  seriesAiDailyTokenLimit: 12000,
  tenantAiDailyLimit: 20,
  tenantAiDailyTokenLimit: 12000,
  tenantBudgetKey: "demo-tenant",
  leaderboardEnabled: true,
  learnQuestionDensity: 4,
  evaluationConfig: defaultEvaluationConfig,
  slides: [
    {
      id: "slide_1",
      eyebrow: "Folie 1",
      title: "Hydrodynamische Gleitlagerung",
      topic: "Stribeck-Kurve",
      copy: [
        "Ein tragender Schmierfilm entsteht durch Relativbewegung und einen keilförmigen Spalt.",
        "Mischreibung ist kritisch, weil Schmierfilm und Festkörperkontakt gleichzeitig auftreten."
      ],
      diagram: "bearing"
    },
    {
      id: "slide_2",
      eyebrow: "Folie 2",
      title: "Sommerfeldzahl",
      topic: "Betriebsparameter",
      copy: [
        "Die Sommerfeldzahl verbindet Viskosität, Drehzahl, Belastung und Lagerspiel.",
        "Sie beschreibt, ob sich ein stabiler hydrodynamischer Schmierfilm ausbilden kann."
      ],
      diagram: "formula"
    },
    {
      id: "slide_3",
      eyebrow: "Folie 3",
      title: "Auslegung beim Anfahren",
      topic: "Transfer",
      copy: [
        "Beim Start ist die Relativgeschwindigkeit noch gering. Der tragende Schmierfilm baut sich erst auf.",
        "Konstruktive Maßnahmen müssen die kurze Phase erhöhten Verschleißes abfangen."
      ],
      diagram: "ramp"
    }
  ],
  questions: [
    {
      level: "4.0",
      points: 1,
      text: "Was kennzeichnet Mischreibung?",
      explanation: "Bei Mischreibung trägt ein Schmierfilm einen Teil der Last. Zugleich berühren sich die festen Oberflächen direkt.",
      answers: [
        { key: "A", text: "Der Schmierstoff hat keine Viskosität.", correct: false },
        { key: "B", text: "Schmierfilm und direkter Kontakt treten zugleich auf.", correct: true },
        { key: "C", text: "Ein Schmierfilm trennt die Oberflächen vollständig.", correct: false },
        { key: "D", text: "Die Reibung ist unabhängig von Drehzahl und Last.", correct: false }
      ]
    },
    {
      level: "3.0",
      points: 2,
      text: "Ein Gleitlager arbeitet in Mischreibung. Welche Änderung fördert am ehesten einen vollständig tragenden Schmierfilm?",
      explanation: "Bei höherer Drehzahl bewegen sich die Lagerflächen schneller gegeneinander. Das unterstützt den Aufbau des tragenden Schmierfilms.",
      answers: [
        { key: "A", text: "Höhere Drehzahl bei sonst gleichen Bedingungen.", correct: true },
        { key: "B", text: "Höhere Last bei gleicher Drehzahl.", correct: false },
        { key: "C", text: "Mehr direkter Kontakt zwischen den Oberflächen.", correct: false },
        { key: "D", text: "Trockener Betrieb ohne Schmierstoff.", correct: false }
      ]
    },
    {
      level: "2.0",
      points: 3,
      text: "Warum ist Mischreibung bei einem Gleitlager besonders kritisch?",
      explanation: "Der Schmierfilm trägt bereits einen Teil der Last. Direkter Kontakt zwischen den Oberflächen führt zugleich zu Wärme und Verschleiß.",
      answers: [
        { key: "A", text: "Der Druck im Schmierfilm trägt die gesamte Last.", correct: false },
        { key: "B", text: "Ein Schmierfilm trägt teilweise; zugleich berühren sich die Oberflächen.", correct: true },
        { key: "C", text: "Die Drehzahl hat in diesem Bereich keinen Einfluss.", correct: false },
        { key: "D", text: "Die Reibung ist kleiner als bei Flüssigkeitsreibung.", correct: false }
      ]
    },
    {
      level: "1.0",
      points: 4,
      text: "Eine stark belastete Welle läuft häufig langsam an. Welche Maßnahme schützt das Gleitlager beim Start am besten?",
      explanation: "Beim langsamen Anfahren trägt der Schmierfilm noch nicht stabil. Eine geringere Startlast oder zusätzliche Schmierfilmversorgung hilft in dieser Phase.",
      answers: [
        { key: "A", text: "Die Startlast senken oder eine zusätzliche Schmierfilmversorgung vorsehen.", correct: true },
        { key: "B", text: "Nur die Enddrehzahl erhöhen und den Start unverändert lassen.", correct: false },
        { key: "C", text: "Das Lagerspiel beliebig verkleinern, um Schmierstoff zurückzuhalten.", correct: false },
        { key: "D", text: "Den Schmierstoff entfernen, um Mischreibung zu vermeiden.", correct: false }
      ]
    }
  ]
};
