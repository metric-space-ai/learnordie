import type { AnswerOption, QuestionLevel, QuestionVariant } from "./types";

// Newly authored and editorially reviewed against originalModelSlides (1–8),
// their notes and companion chapters 1–8. These are NOT imported source questions.
// Independent lecturer approval remains separate from this editorial review.
type AuthoredQuestion = {
  text: string;
  /** Correct answer first, then three distractors; output positions rotate below. */
  choices: readonly [string, string, string, string];
  explanation: string;
};

type AuthoredFamily = {
  id: string;
  slide: string;
  objective: string;
  variants: Record<QuestionLevel, AuthoredQuestion>;
};

const LEVELS: readonly QuestionLevel[] = ["4.0", "3.0", "2.0", "1.0"];
const KEYS: readonly AnswerOption["key"][] = ["A", "B", "C", "D"];

// Order is the authored source order, not a title match or a scene-name lookup.
const FAMILIES: readonly AuthoredFamily[] = [
  {
    id: "model-reviewed-begriffsgang-v1",
    slide: "Begriffsgang",
    objective: "Den Modellbegriff als Erweiterung verstehen; Entstehung und Verwendung unterscheiden.",
    variants: {
      "4.0": {
        text: "Wie beschreibt die Vorlesung den Wandel des Modellbegriffs?",
        choices: [
          "Neue Bedeutungen ergänzen die bisherigen Modellformen.",
          "Gelernte Modelle lösen mathematische Modellformen ab.",
          "Ausführbare Modelle entstehen immer durch ein Training.",
          "Alle Modellformen bilden die äußere Form der Dinge ab."
        ],
        explanation: "Der Begriff wird erweitert. Abbilder und Gleichungen bleiben nutzbar, auch wenn gelernte Modelle hinzukommen."
      },
      "3.0": {
        text: "Warum unterscheidet die Vorlesung zwischen „gelernt“ und „ausführbar“?",
        choices: [
          "Lernen betrifft die Entstehung, Ausführung die Verwendung.",
          "Lernen betrifft die Verwendung, Ausführung die Entstehung.",
          "Lernen betrifft Sprachmodelle, Ausführung betrifft Naturgesetze.",
          "Lernen betrifft die Darstellung, Ausführung prüft ihre Gültigkeit."
        ],
        explanation: "Auch eine von Hand festgelegte Funktion lässt sich ausführen. Ausführbarkeit belegt daher kein Lernen."
      },
      "2.0": {
        text: "Ein Programm berechnet Federkräfte mit einer von Hand festgelegten Formel. Wie lässt sich dieses Modell einordnen?",
        choices: [
          "Es wird ausgeführt; dafür ist kein Lernen nötig.",
          "Es wird gelernt, sobald eine neue Eingabe vorliegt.",
          "Es bleibt ein Abbild und kann nicht ausgeführt werden.",
          "Es ersetzt durch die Ausführung das verwendete Naturgesetz."
        ],
        explanation: "Das Programm verwendet eine vorgegebene Beziehung. Eine neue Eingabe wertet diese aus, statt Parameter zu lernen."
      },
      "1.0": {
        text: "Ein Team nutzt ein Bauteilmodell, eine Bewegungsgleichung und ein LLM im selben Projekt. Welche Folgerung passt zum Begriffsgang?",
        choices: [
          "Die Modelle können je nach Aufgabe verschiedene Rollen erfüllen.",
          "Das LLM macht die beiden älteren Modellformen fachlich überflüssig.",
          "Alle drei müssen aus Daten gelernt sein, um als Modell zu gelten.",
          "Der gemeinsame Begriff sichert ihnen denselben Geltungsbereich."
        ],
        explanation: "Verschiedene Modellformen können nebeneinander sinnvoll sein. Ihr gemeinsamer Name bedeutet keine gleiche Aufgabe oder Gültigkeit."
      }
    }
  },
  {
    id: "model-reviewed-gedankenminiatur-v1",
    slide: "Gedankenminiatur",
    objective: "Vereinfachungen danach beurteilen, welche Beziehungen für die jeweilige Aufgabe erhalten bleiben.",
    variants: {
      "4.0": {
        text: "Was meint „Gedankenminiatur“ in der Vorlesung?",
        choices: [
          "Einen vereinfachten gedanklichen Stellvertreter.",
          "Eine maßstabsgetreue Kopie sämtlicher Bauteile.",
          "Eine vollständige Beschreibung aller Eigenschaften.",
          "Eine aus Messdaten automatisch gelernte Funktion."
        ],
        explanation: "Die Miniatur macht ausgewählte Zusammenhänge handhabbar. Sie muss weder maßstäblich noch vollständig sein."
      },
      "3.0": {
        text: "Warum kann ein Modell mit weniger Details für eine Aufgabe gut geeignet sein?",
        choices: [
          "Die für die Aufgabe wichtigen Beziehungen können erhalten bleiben.",
          "Mit jedem entfernten Detail wächst der Geltungsbereich des Modells.",
          "Die äußere Ähnlichkeit reicht für jede Art von Untersuchung aus.",
          "Vereinfachte Darstellungen benötigen keine Modellannahmen mehr."
        ],
        explanation: "Entscheidend ist der Zweck. Weniger Details können genügen, erweitern aber nicht automatisch den Geltungsbereich."
      },
      "2.0": {
        text: "Du untersuchst die Schwingungsdauer einer idealen Feder mit Masse. Welches Detail kannst du dafür weglassen?",
        choices: [
          "Die Farbe des Gestells.",
          "Die Größe der Masse.",
          "Die Steifigkeit der Feder.",
          "Die Verbindung von Feder und Masse."
        ],
        explanation: "Die Gestellfarbe geht nicht in die Schwingungsbeziehung ein. Masse, Federsteifigkeit und ihre Verbindung sind dagegen relevant."
      },
      "1.0": {
        text: "Ein vereinfachtes Federmodell zeigt keine Befestigungsform. Nun soll damit die Montage geplant werden. Was ist zu tun?",
        choices: [
          "Die für die Montage nötigen Befestigungsdetails ergänzen.",
          "Die bisherige Schwingungsdauer genauer berechnen.",
          "Die Federsteifigkeit für die Montage neu anpassen.",
          "Die vorhandene Darstellung nur maßstäblich vergrößern."
        ],
        explanation: "Mit der Aufgabe ändern sich die nötigen Informationen. Eine gute Schwingungsdarstellung liefert noch keine Montagegeometrie."
      }
    }
  },
  {
    id: "model-reviewed-naturgesetz-v1",
    slide: "Naturgesetz",
    objective: "Mathematische Beziehungen für quantitative Aussagen im idealen Feder-Masse-Modell nutzen.",
    variants: {
      "4.0": {
        text: "Was steht beim Modell als mathematischer Beziehung im Mittelpunkt?",
        choices: [
          "Der Zusammenhang zwischen ausgewählten Größen.",
          "Die äußere Ähnlichkeit mit dem realen Gegenstand.",
          "Die vollständige Darstellung aller Bauteildetails.",
          "Die automatische Anpassung an neue Messdaten."
        ],
        explanation: "Eine Gleichung beschreibt Beziehungen zwischen Größen. Dafür muss sie dem Gerät nicht ähnlich sehen."
      },
      "3.0": {
        text: "Warum lässt sich mit einer Federgleichung eine Bewegung vorhersagen, obwohl sie nicht wie eine Feder aussieht?",
        choices: [
          "Sie verknüpft die Größen, die die Bewegung im Modell bestimmen.",
          "Sie bildet die räumliche Form der Feder in ihren Zeichen ab.",
          "Sie bestimmt allein aus ihrer Schreibweise alle Anfangswerte.",
          "Sie passt ihre Parameter bei jeder Berechnung selbstständig an."
        ],
        explanation: "Die Vorhersage beruht auf erfassten Beziehungen. Für einen konkreten Verlauf braucht es auch passende Anfangsbedingungen."
      },
      "2.0": {
        text: "Für die ideale Feder gilt ω = √(k/m). Die Masse bleibt gleich, k steigt auf das Vierfache. Wie ändert sich ω?",
        choices: [
          "ω steigt auf das Doppelte.",
          "ω steigt auf das Vierfache.",
          "ω sinkt auf die Hälfte.",
          "ω bleibt unverändert."
        ],
        explanation: "Unter der Wurzel steht das Vierfache. Daher wird ω mit √4 = 2 multipliziert, nicht mit 4."
      },
      "1.0": {
        text: "Eine neue Halterung wird als ideale Feder mit Masse modelliert. Bei doppelter Masse soll ω = √(k/m) gleich bleiben. Welche Steifigkeit k ist nötig?",
        choices: [
          "Die doppelte Steifigkeit.",
          "Die halbe Steifigkeit.",
          "Die vierfache Steifigkeit.",
          "Die unveränderte Steifigkeit."
        ],
        explanation: "Für gleiches ω muss k/m gleich bleiben. Verdoppelt sich m, muss sich im gewählten Modell auch k verdoppeln."
      }
    }
  },
  {
    id: "model-reviewed-modellgrenzen-v1",
    slide: "Modellgrenzen",
    objective: "Modellaussagen an Aufgabe und Geltungsbereich binden; ergänzende Beschreibungen unterscheiden.",
    variants: {
      "4.0": {
        text: "Was bezeichnet der Geltungsbereich eines Modells?",
        choices: [
          "Die Bedingungen und Fragen, für die seine Aussagen gelten sollen.",
          "Die Anzahl der Größen, die in seinen Gleichungen vorkommen.",
          "Die Zeitspanne, in der ein Computer seine Gleichungen ausführt.",
          "Die Ähnlichkeit zwischen seiner Darstellung und dem Gegenstand."
        ],
        explanation: "Ein Modell trägt unter bestimmten Bedingungen und für bestimmte Fragen. Die Zahl seiner Größen legt diese Grenzen nicht fest."
      },
      "3.0": {
        text: "Warum können Kraft- und Energiebeschreibung zur selben idealen Federbewegung passen?",
        choices: [
          "Sie erfassen unterschiedliche Aspekte desselben Geschehens.",
          "Sie beschreiben zwangsläufig verschiedene reale Bewegungen.",
          "Jede Energiebeschreibung liefert allein den ganzen Zeitverlauf.",
          "Mit zwei Beschreibungen entfallen die Annahmen des Modells."
        ],
        explanation: "Kraft und Energie bieten ergänzende Sichtweisen. Die skalare Energiegleichung allein bestimmt noch keinen vollständigen Zeitverlauf."
      },
      "2.0": {
        text: "Eine reale Federschwingung klingt durch Reibung ab. Das Modell nimmt keine Dämpfung an. Welche Grenze wird hier sichtbar?",
        choices: [
          "Das Modell erfasst den Energieverlust durch Reibung nicht.",
          "Das Modell benötigt lediglich eine andere Anfangsauslenkung.",
          "Das Modell beschreibt Reibung bereits durch die Masse allein.",
          "Das Modell wird durch eine genauere Zeichnung ausreichend."
        ],
        explanation: "Ohne Dämpfung bleibt die Energie im Lehrmodell konstant. Ein anderer Anfangswert ergänzt den fehlenden Energieverlust nicht."
      },
      "1.0": {
        text: "Ein Halterungsmodell stimmt bei kleinen Lasten mit Messungen überein. Es soll nun große Lasten bewerten. Welcher nächste Schritt ist begründet?",
        choices: [
          "Die Modellannahmen mit Messungen bei großen Lasten prüfen.",
          "Die bisherigen Ergebnisse allein auf große Lasten hochrechnen.",
          "Die Übereinstimmung bei kleinen Lasten als Freigabe verwenden.",
          "Die Rechengenauigkeit erhöhen und damit die Prüfung ersetzen."
        ],
        explanation: "Erfolg bei kleinen Lasten belegt die Eignung für große Lasten nicht. Dort können andere Beziehungen relevant werden."
      }
    }
  },
  {
    id: "model-reviewed-ausfuehrung-v1",
    slide: "Ausführung",
    objective: "Ausführung und Schnittstellen als Voraussetzung technischer Wirkung erklären, ohne Lernen zu unterstellen.",
    variants: {
      "4.0": {
        text: "Was geschieht in einer Laufzeitumgebung?",
        choices: [
          "Eine implementierte Funktion wird ausgeführt.",
          "Eine Modellstruktur wird aus Beispielen gelernt.",
          "Der Geltungsbereich wird automatisch nachgewiesen.",
          "Das Lernverfahren bestimmt passende Modellparameter."
        ],
        explanation: "Die Laufzeitumgebung führt die Funktion aus. Daraus folgt weder ein Training noch ein Nachweis ihrer Eignung."
      },
      "3.0": {
        text: "Warum braucht eine berechnete Ausgabe eine Schnittstelle, um einen Motor gezielt zu steuern?",
        choices: [
          "Der Wert muss als passendes Signal an den Motor übergeben werden.",
          "Der Wert muss zuvor aus möglichst vielen Beispielen gelernt sein.",
          "Die Gleichung muss die äußere Form des Motors sichtbar abbilden.",
          "Die Berechnung muss ihre eigenen Modellannahmen neu bestimmen."
        ],
        explanation: "Eine Zahl wirkt erst durch ihre technische Einbindung, etwa als Sollwinkel. Eine gelernte Funktion ist dafür keine Voraussetzung."
      },
      "2.0": {
        text: "In der laufenden Stellwinkel-Demo gilt y = 60° · x. Welcher Sollwinkel wird bei x = 0,5 ausgegeben?",
        choices: [
          "Ein Sollwinkel von 30°.",
          "Ein Sollwinkel von 60°.",
          "Ein Sollwinkel von 0,5°.",
          "Ein Sollwinkel von 120°."
        ],
        explanation: "60° · 0,5 ergibt 30°. Die Demo wertet eine festgelegte Funktion aus; sie lernt dabei keine Parameter."
      },
      "1.0": {
        text: "Ein Modell liefert Winkel in Grad. Eine neue Motorsteuerung erwartet Radiant. Welche Anpassung macht die Ausgabe passend?",
        choices: [
          "Die Winkel an der Schnittstelle von Grad in Radiant umrechnen.",
          "Die Zahlen unverändert mit der neuen Einheit beschriften.",
          "Die Berechnung mit denselben Eingaben häufiger ausführen.",
          "Den zulässigen Wertebereich ohne Umrechnung erweitern."
        ],
        explanation: "Zur Schnittstelle gehört die Bedeutung der Werte. Eine andere Einheit verlangt eine Umrechnung, nicht nur eine neue Beschriftung."
      }
    }
  },
  {
    id: "model-reviewed-lernen-v1",
    slide: "Lernen",
    objective: "Parameteranpassung von Auswertung unterscheiden und die Aussagekraft des Trainingsfehlers begrenzen.",
    variants: {
      "4.0": {
        text: "Was verändert das Lernverfahren in der Polynom-Demo?",
        choices: [
          "Die drei Parameter des vorgegebenen Polynoms.",
          "Den Grad des Polynoms bei jedem Lernschritt.",
          "Die festen Beispieldaten statt der Parameter.",
          "Den Eingaberegler statt der Modellfunktion."
        ],
        explanation: "Die Struktur a₀ + a₁x + a₂x² bleibt fest. Gelernt werden die drei Parameter a₀, a₁ und a₂."
      },
      "3.0": {
        text: "Warum ist das Verschieben des Eingabereglers nach dem Training kein weiterer Lernschritt?",
        choices: [
          "Die Funktion wird mit unveränderten Parametern ausgewertet.",
          "Die Funktion wählt dabei selbst einen neuen Polynomgrad.",
          "Die Funktion ersetzt dabei die bisherigen Trainingsdaten.",
          "Die Funktion passt ihre Parameter nun ohne Fehlermaß an."
        ],
        explanation: "Eine andere Eingabe kann eine andere Ausgabe liefern. Lernen liegt hier erst vor, wenn das Verfahren die Parameter anpasst."
      },
      "2.0": {
        text: "Nach dem Training gilt ŷ = 1 + 2x + x². Du setzt x = 2 ein und lässt die Parameter fest. Welches Ergebnis liefert die Auswertung?",
        choices: [
          "Die Vorhersage ŷ = 9.",
          "Die Vorhersage ŷ = 7.",
          "Die Vorhersage ŷ = 5.",
          "Die Vorhersage ŷ = 16."
        ],
        explanation: "Einsetzen ergibt 1 + 2 · 2 + 2² = 9. Die Parameter bleiben fest; diese Rechnung ist Auswertung, nicht Training."
      },
      "1.0": {
        text: "Ein gelerntes Temperaturmodell hat einen kleinen Trainingsfehler. Es soll Werte in einem neuen Bereich vorhersagen. Was ist daraus zu folgern?",
        choices: [
          "Seine Eignung im neuen Bereich muss gesondert geprüft werden.",
          "Sein kleiner Trainingsfehler belegt die Eignung im neuen Bereich.",
          "Seine Parameter passen sich schon durch neue Eingaben passend an.",
          "Seine vorgegebene Struktur sichert die Eignung für jeden Bereich."
        ],
        explanation: "Der Trainingsfehler bewertet die Anpassung an bekannte Daten. Neue Eingaben trainieren das Modell nicht automatisch weiter."
      }
    }
  },
  {
    id: "model-reviewed-llm-v1",
    slide: "LLM",
    objective: "Sprachliche Fortsetzung aus Kontext von Parametertraining und fachlichem Nachweis unterscheiden.",
    variants: {
      "4.0": {
        text: "Was bestimmt das betrachtete LLM aus dem bisherigen sprachlichen Kontext?",
        choices: [
          "Wahrscheinlichkeiten für mögliche nächste Tokens.",
          "Die fest gespeicherte Antwort auf denselben Wortlaut.",
          "Eine geprüfte Aussage über den beschriebenen Sachverhalt.",
          "Neue Modellgewichte für die nächste Textausgabe."
        ],
        explanation: "Das Modell berechnet mögliche Fortsetzungen. Tokens sind sprachliche Verarbeitungseinheiten, nicht zwingend ganze Wörter."
      },
      "3.0": {
        text: "Warum kann ein LLM bei unveränderten Gewichten auf eine neue Anweisung anders antworten?",
        choices: [
          "Die Anweisung verändert den verarbeiteten Kontext.",
          "Die Anweisung führt zwangsläufig ein Gewichtstraining aus.",
          "Die Anweisung ersetzt die gelernte Modellstruktur.",
          "Die Anweisung weist die fachliche Richtigkeit nach."
        ],
        explanation: "Auch mit festen Gewichten hängt die Ausgabe vom Kontext ab. Ein verändertes Verhalten belegt noch keine Parameteränderung."
      },
      "2.0": {
        text: "Du ergänzt Beispiele im LLM-Kontext; die Gewichte bleiben fest. Nun folgt die Antwort dem Muster. Welcher Vorgang erklärt das?",
        choices: [
          "Die Ausführung mit einem veränderten Kontext.",
          "Ein Training mit neu angepassten Gewichten.",
          "Eine Messung der beschriebenen realen Situation.",
          "Ein Umbau der verwendeten Modellarchitektur."
        ],
        explanation: "Die Beispiele wirken hier als Eingabe. Da die Gewichte fest bleiben, handelt es sich nicht um Parametertraining."
      },
      "1.0": {
        text: "Ein LLM schlägt überzeugend vor: „Die Halterung muss steif sein.“ Was braucht das Entwicklungsteam für eine prüfbare Anforderung?",
        choices: [
          "Einen aus Aufgabe und Lastfall begründeten Verformungsgrenzwert.",
          "Eine sprachlich noch überzeugendere Formulierung desselben Satzes.",
          "Eine längere Antwort bei unverändertem technischen Informationsstand.",
          "Eine mehrfach wiederholte Bestätigung durch dieselbe Sprachfunktion."
        ],
        explanation: "Sprachliche Plausibilität liefert keinen technischen Grenzwert. Dieser muss aus der Entwicklungsaufgabe begründet werden."
      }
    }
  },
  {
    id: "model-reviewed-produktentwicklung-v1",
    slide: "Produktentwicklung",
    objective: "Aufgabe, Daten, Lernen, Prüfung und Einsatz als zusätzliche Gestaltungsaufgaben der Produktentwicklung einordnen.",
    variants: {
      "4.0": {
        text: "Welche Aufgabe kommt bei der Entwicklung gelernter Funktionen hinzu?",
        choices: [
          "Daten, Modellstruktur, Lernen und Prüfung gestalten.",
          "Die direkte Formulierung technischer Beziehungen abschaffen.",
          "Die Wahl der Entwicklungsaufgabe dem Training überlassen.",
          "Die fachliche Prüfung durch den Trainingsfehler ersetzen."
        ],
        explanation: "Das Team gestaltet auch die Entstehung der Funktion. Explizite Modelle und die fachliche Prüfung bleiben Teil der Entwicklung."
      },
      "3.0": {
        text: "Warum muss das Team die Entwicklungsaufgabe klären, bevor es Daten und Lernkriterium auswählt?",
        choices: [
          "Die Aufgabe bestimmt, welche Beispiele und Fehler relevant sind.",
          "Die Aufgabe ergibt sich eindeutig aus der größten Datenmenge.",
          "Ein kleiner mittlerer Fehler passt zu jeder Entwicklungsaufgabe.",
          "Das Lernverfahren legt die spätere Verwendung selbstständig fest."
        ],
        explanation: "Die nötige Modellgüte hängt vom Zweck ab. Für eine grobe Vorauswahl und einen belastbaren Nachweis gelten unterschiedliche Anforderungen."
      },
      "2.0": {
        text: "Ein Halterungsmodell soll mehrere Lastfälle bewerten. Die Daten enthalten bisher nur einen Lastfall. Welche Maßnahme passt zur Aufgabe?",
        choices: [
          "Passende Daten für die weiteren Lastfälle beschaffen und prüfen.",
          "Die Daten desselben Lastfalls häufiger im Training wiederholen.",
          "Die Zahl der Lernschritte mit denselben Daten allein erhöhen.",
          "Den mittleren Fehler im bekannten Lastfall als Gesamtbeleg nutzen."
        ],
        explanation: "Daten zu einem Lastfall belegen keine Leistung in weiteren Lastfällen. Die Datenbasis und Prüfung müssen zum vorgesehenen Einsatz passen."
      },
      "1.0": {
        text: "Ein Modell soll kritische Bauteile erkennen. Seltene starke Unterschätzungen sind besonders problematisch. Welcher Prüfplan passt?",
        choices: [
          "Unabhängige Fälle prüfen und starke Unterschätzungen eigens bewerten.",
          "Den mittleren Trainingsfehler als einziges Freigabekriterium nutzen.",
          "Nur häufige Fälle prüfen, damit die mittlere Leistung stabil bleibt.",
          "Alle Prüffälle zum Anpassen nutzen und denselben Fehler erneut prüfen."
        ],
        explanation: "Ein Mittelwert kann seltene große Fehler verdecken. Der Prüfplan muss diese Fehler erfassen und unabhängige Fälle enthalten."
      }
    }
  }
];

/**
 * Bind the reviewed bank to exactly eight distinct, nonblank IDs in original
 * slide order. IDs are preserved byte-for-byte; callers must supply that order.
 * Invalid input fails instead of silently creating lecture-wide questions.
 * Family IDs are stable within a lecture; each call returns fresh answer objects.
 */
export function createModelQuestionBank(slideIds: readonly string[]): QuestionVariant[] {
  if (slideIds.length !== FAMILIES.length
    || Array.from(slideIds).some((id) => typeof id !== "string" || !id.trim())
    || new Set(slideIds).size !== FAMILIES.length) {
    throw new Error("Model question bank requires exactly eight distinct, nonblank slide IDs in original order.");
  }

  return FAMILIES.flatMap((family, familyIndex) => LEVELS.map((level, levelIndex) => {
    const question = family.variants[level];
    const correctPosition = (familyIndex + levelIndex) % KEYS.length;
    return {
      familyId: family.id,
      familySource: "prepared",
      slideId: slideIds[familyIndex],
      level,
      points: levelIndex + 1,
      text: question.text,
      answers: KEYS.map((key, answerIndex) => {
        const choiceIndex = (answerIndex - correctPosition + KEYS.length) % KEYS.length;
        return { key, text: question.choices[choiceIndex], correct: choiceIndex === 0 };
      }),
      explanation: question.explanation,
      learningObjective: family.objective,
      promptVersion: "model-question-bank-reviewed-v1",
      sourceRef: `Neu verfasste Übungsfrage · Grundlage: Originalfolie ${familyIndex + 1} „${family.slide}“, Notizen und Begleitskript Kap. ${familyIndex + 1}`,
      reviewStatus: "reviewed",
      reviewerComment: "Redaktionell auf Quellenbezug, Eindeutigkeit und Lesbarkeit geprüft; keine aus der Vorlage importierte Frage."
    };
  }));
}
