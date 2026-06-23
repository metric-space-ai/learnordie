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
  examDate: "2026-07-24",
  aiAccessUntil: "2026-07-24T21:59:59.999Z",
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
      text: "Welche Aussage beschreibt Mischreibung korrekt?",
      explanation: "Mischreibung bedeutet, dass Schmierfilmanteile und direkter Festkörperkontakt gleichzeitig auftreten.",
      answers: [
        { key: "A", text: "Der Schmierstoff hat keine Viskosität.", correct: false },
        { key: "B", text: "Schmierfilm und Festkörperkontakt wirken gleichzeitig.", correct: true },
        { key: "C", text: "Das Lager läuft vollständig flüssigkeitsgeschmiert.", correct: false },
        { key: "D", text: "Die Reibung ist unabhängig von Drehzahl und Last.", correct: false }
      ]
    },
    {
      level: "3.0",
      points: 2,
      text: "Welche Änderung verschiebt ein Gleitlager am ehesten aus der Mischreibung in Richtung Flüssigkeitsreibung?",
      explanation: "Eine höhere Relativgeschwindigkeit unterstützt den Aufbau des hydrodynamischen Schmierfilms.",
      answers: [
        { key: "A", text: "Höhere Drehzahl bei sonst gleichen Bedingungen.", correct: true },
        { key: "B", text: "Höhere Last bei gleicher Drehzahl.", correct: false },
        { key: "C", text: "Größerer Festkörperkontakt im Spalt.", correct: false },
        { key: "D", text: "Trockener Betrieb ohne Schmierstoff.", correct: false }
      ]
    },
    {
      level: "2.0",
      points: 3,
      text: "Warum ist Mischreibung bei einem Gleitlager besonders kritisch?",
      explanation: "Direkter Kontakt erzeugt lokale Erwärmung und Verschleiß, obwohl gleichzeitig schon Schmierfilmanteile tragen.",
      answers: [
        { key: "A", text: "Der hydrodynamische Druck trägt die Last vollständig.", correct: false },
        { key: "B", text: "Es treten gleichzeitig Schmierfilmanteile und direkter Kontakt auf.", correct: true },
        { key: "C", text: "Die Drehzahl hat in diesem Bereich keinen Einfluss.", correct: false },
        { key: "D", text: "Die Reibung ist kleiner als bei Flüssigkeitsreibung.", correct: false }
      ]
    },
    {
      level: "1.0",
      points: 4,
      text: "Eine schwer belastete Welle läuft häufig langsam an. Welche Maßnahme adressiert das eigentliche Gleitlagerproblem am besten?",
      explanation: "Die Startphase ist kritisch, weil der hydrodynamische Film noch nicht stabil trägt.",
      answers: [
        { key: "A", text: "Startphase entlasten oder eine zusätzliche Schmierfilmversorgung vorsehen.", correct: true },
        { key: "B", text: "Nur die Enddrehzahl erhöhen, ohne den Startvorgang zu verändern.", correct: false },
        { key: "C", text: "Das Lagerspiel beliebig verkleinern, damit kein Schmierstoff entweicht.", correct: false },
        { key: "D", text: "Den Schmierstoff entfernen, um Mischreibung zu vermeiden.", correct: false }
      ]
    }
  ]
};
