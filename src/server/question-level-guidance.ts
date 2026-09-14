/** Shared cognitive contract for authors and the independent family reviewer. */
export const QUESTION_LEVEL_GUIDANCE = [
  "Erstelle vier Fragen zum selben Lernziel mit steigender Denkaufgabe:",
  "4.0 Wiedergeben: einen Begriff oder Zusammenhang erkennen.",
  "3.0 Verstehen: den Zusammenhang erklären oder eine Ursache erkennen.",
  "2.0 Anwenden: den Zusammenhang auf einen konkret beschriebenen Fall anwenden.",
  "1.0 Übertragen/Bewerten: mit dem Zusammenhang eine neue Situation beurteilen oder eine begründete Entscheidung treffen.",
  "Die Unterschiede liegen in der Denkaufgabe, nicht in komplizierter Sprache oder vier Umschreibungen derselben Frage. Qualitative Aufgaben sind auf allen Stufen möglich."
].join(" ");

/** Context sets the topic; it is not a closed inventory of permissible knowledge. */
export const QUESTION_CONTEXT_GUIDANCE = [
  "Skript, Folien und akzeptiertes Live-Transkript legen Thema und Unterrichtskontext fest. Nutze dazu gesichertes Fachwissen, um Zusammenhänge zu erklären und Aufgaben zu bilden; nicht jede Definition oder Herleitung muss im Material stehen.",
  "Ein mündliches Beispiel ist auch ohne passende Folie oder Skriptstelle Vorlesungsstoff. Eine qualitative Aussage genügt als Ausgangspunkt. Ergänze keine erfundenen Messwerte, Quellen oder allgemeingültigen Grenzwerte.",
  "Gib die für eine eindeutige Lösung nötigen Bedingungen im Aufgabentext an. Hypothetische Beispiele sind erlaubt; kennzeichne ihre Annahmen. Prüfe Rechnungen und Geltungsbedingungen."
].join(" ");
