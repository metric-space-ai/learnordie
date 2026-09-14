import { parseSlideDocument, type SlideDocument } from "@learnordie/slide-engine/schema";

export const MODEL_DEMO_KEY = "learnordie:model-demo:v1";
export const MODEL_DEMO_TITLE = "Der Modellbegriff im Wandel – Beispielsatz";
export const MODEL_DEMO_SERIES_TITLE = "Modell-Slides · Beispiele";
export const MODEL_DEMO_NOTICE = "Neu erstellter Beispielsatz zu den vorhandenen Modell-Szenen; keine wiederhergestellte Originalvorlesung.";

// Teaching text authored for this example. Scene IDs and descriptions are based
// on modell-factories.ts and modell-state.ts at source commit 9d34ea6.
const lessons = [
  {
    key: "morph", title: "Was ein Modell leistet",
    text: "Ein Modell hebt Eigenschaften hervor, die für eine Aufgabe wichtig sind. Es kann ein Abbild, eine mathematische Beziehung oder eine ausführbare Funktion sein.",
    task: "Wechsle zwischen Abbild, Beziehung, Ausführung, Lernen und Sprache. Welche Information bleibt erhalten, welche kommt hinzu?",
    alt: "Punktwolke im Übergang zwischen fünf Darstellungen des Modellbegriffs.",
    note: "Die Formen sind eine visuelle Analogie, keine Messdaten. Diskutiert, weshalb die Aufgabe darüber entscheidet, welche Darstellung nützlich ist."
  },
  {
    key: "miniature", title: "Auswählen, vereinfachen, weglassen",
    text: "Aus einem detaillierten Feder-Masse-Aufbau wird ein idealisiertes System mit Masse m und Federsteifigkeit k. Die Vereinfachung richtet sich nach der untersuchten Bewegung.",
    task: "Erhöhe die Abstraktion. Welche Bauteile verschwinden, obwohl das Modell die Schwingung weiterhin beschreiben soll?",
    alt: "Feder-Masse-Aufbau mit stufenlosem Übergang von Bauteilen zu Massepunkt und Feder.",
    note: "Reibung, Feder-Masse und Führungsspiel werden im idealisierten Modell vernachlässigt. Für andere Fragen können gerade diese Eigenschaften wesentlich sein."
  },
  {
    key: "law", title: "Vom Aufbau zur Beziehung",
    text: "Für den idealen ungedämpften Oszillator gilt m · ẍ + k · x = 0. Die Periodendauer beträgt T = 2π · √(m/k): Eine steifere Feder schwingt bei gleicher Masse schneller.",
    task: "Verändere k und vergleiche die angezeigte Periodendauer. Was erwartest du, wenn k vervierfacht wird?",
    alt: "Feder-Masse-Oszillator neben dem Zeitverlauf der Auslenkung mit veränderlicher Federsteifigkeit.",
    note: "Die Szene verwendet eine normierte Masse m = 1. Bei vierfachem k halbiert sich T. Die Darstellung zeigt ein ideales System, keine vermessene Maschine."
  },
  {
    key: "limits", title: "Eine Bewegung, zwei Beschreibungen",
    text: "Die Kraftbilanz F = −k · x und der Austausch zwischen kinetischer Energie und Federenergie beschreiben denselben idealen Oszillator. Ohne Dämpfung bleibt die Gesamtenergie konstant.",
    task: "Wechsle von Kraft zu Energie. Wo ist die Federenergie maximal, wo die Bewegungsenergie? Welche Annahme würde Reibung verletzen?",
    alt: "Schwingendes Feder-Masse-System mit umschaltbarer Kraftgerade und Energiebalken.",
    note: "An den Umkehrpunkten ist die Geschwindigkeit null; beim Durchgang durch die Gleichgewichtslage ist sie maximal. Bei Dämpfung nimmt die mechanische Energie ab."
  },
  {
    key: "runtime", title: "Ein Modell wird wirksam",
    text: "Eine ausführbare Funktion bildet einen Eingang x auf einen Stellwinkel y ab. Damit daraus eine Wirkung entsteht, braucht sie Schnittstellen und eine Laufzeitumgebung.",
    task: "Ändere den Eingang und schalte die Ausführung um. Unterscheide berechneten Ausgang und sichtbare Bewegung des Stellglieds.",
    alt: "Eingangssignal, Modellchip und Stellglied mit animiertem Signalfluss.",
    note: "Die Szene veranschaulicht Ausführung und Schnittstellen. Sie ist keine geprüfte Regelung oder Sicherheitsfunktion für ein reales Stellglied."
  },
  {
    key: "learning", title: "Parameter aus Beispielen lernen",
    text: "Das Lernmodell y = a₀ + a₁x + a₂x² besitzt drei veränderliche Parameter. Gradientenabstieg passt sie an 21 synthetische Beispiele an und verringert den mittleren quadratischen Fehler.",
    task: "Starte das Training und beobachte Kurve und Fehler. Prüfe anschließend eine neue Eingabe: Worin unterscheiden sich Lernen und Anwenden?",
    alt: "Synthetische Datenpunkte und eine quadratische Lernkurve mit markierter Vorhersage.",
    note: "Die Beispiele stammen aus modell-state.ts, nicht von Personen. Ein kleiner Trainingsfehler belegt noch keine Güte auf unabhängigen Daten oder außerhalb des Trainingsbereichs."
  },
  {
    key: "language", title: "Sprache als Folge von Vorhersagen",
    text: "Tokens werden in Repräsentationen überführt und über Attention und weitere Verarbeitungsschritte verknüpft. Aus dem Kontext entsteht eine Verteilung für das nächste Token.",
    task: "Wechsle den Kontext zwischen Halterung und Akku. Verfolge die Verarbeitung und die Rückführung eines ergänzten Tokens.",
    alt: "Schematische Verarbeitung von Tokens über Repräsentation, Attention und FFN zu einer Wahrscheinlichkeitsverteilung.",
    note: "Die Wahrscheinlichkeiten sind fest hinterlegte Illustrationen; hier läuft kein Sprachmodell. Wahrscheinliche Fortsetzungen sind weder Wahrheitsbelege noch technische Freigaben."
  },
  {
    key: "transfer", title: "Vom Beispiel zum Einsatz",
    text: "Ein Modellprojekt verbindet Aufgabe, Daten, Lernen, Prüfen und Einsetzen. Die Prüfung an unabhängigen Fällen liefert Rückmeldungen für Datenwahl, Modell und Einsatzgrenzen.",
    task: "Wähle einen technischen Anwendungsfall. Formuliere für jede der fünf Stationen eine konkrete Entscheidung und ein überprüfbares Erfolgskriterium.",
    alt: "Fünf Stationen Aufgabe, Daten, Lernen, Prüfen und Einsetzen mit Rückkopplung.",
    note: "Beispiel: Stellwinkel aus Sensordaten vorhersagen. Vor dem Einsatz müssen unabhängige Testfälle, zulässiger Eingabebereich und Verhalten bei Fehlern feststehen."
  }
] as const;

export function createModelDemoDocument(lectureId: string, slideIds: readonly string[]): SlideDocument {
  if (slideIds.length !== lessons.length || new Set(slideIds).size !== lessons.length) {
    throw new Error("The model example requires eight distinct slide IDs.");
  }
  return parseSlideDocument({
    schemaVersion: "learnordie.slide.v1",
    id: `lecture:${lectureId}:deck`, title: MODEL_DEMO_TITLE, language: "de",
    aspect: "16:9", theme: "learnordie-technical",
    deckSettings: { defaultTransition: "fade", showSlideNumbers: true, allowFragments: false, mobileMode: "reflow" },
    assets: [], createdBy: { mode: "manual", promptVersion: MODEL_DEMO_KEY },
    slides: lessons.map((lesson, index) => ({
      id: slideIds[index], title: lesson.title, layout: "technical_figure_right", intent: "explanation",
      blocks: [
        { id: `${lesson.key}-text`, type: "paragraph", text: lesson.text },
        { id: `${lesson.key}-task`, type: "paragraph", text: `Erkunden: ${lesson.task}` },
        { id: `${lesson.key}-scene`, type: "scene3d", sceneId: `modell.${lesson.key}`, altText: lesson.alt, caption: `Modell-Beispiel · ${lesson.title}` }
      ],
      speakerNotes: [
        { id: `${lesson.key}-origin`, kind: "source", text: MODEL_DEMO_NOTICE },
        { id: `${lesson.key}-teaching`, kind: "talkingPoint", text: lesson.note }
      ],
      sourceRefs: [{
        id: `${lesson.key}-source`, sourceType: "manual", label: "Vorhandene Modell-Szene; neuer Beispiel-Lehrtext",
        locator: `9d34ea6:packages/slide-engine/src/scenes/modell-factories.ts#${lesson.key}`
      }]
    }))
  });
}
