# Design

## Register

product

## Visual Direction

learnordie.app folgt der ruhigen Excalidraw-Sprache: Die Folie ist der Anker. Das Studio hat genau einen Header für Navigation, Speichern, Theme und Präsentieren; darunter eine einzige kombinierte Editierleiste. Es gibt keinen Studio-Footer. Zusätzliche Werkzeuge, Hotspots und fachliche Sheets beanspruchen nur geöffnet Platz und überdecken die Arbeitsfläche, statt weitere feste Leisten zu bilden.

Die Wortmarke nutzt die Domain selbst als Hook. Offiziell ist die Lesart "Lernen im Norden"; visuell darf `nord` minimal hervortreten. Der versteckte "learn or die"-Eindruck bleibt ein Easter Egg der URL, nicht die sichtbare Tonalität der App. Das Markenzeichen ist ein ruhiger Loop mit Nordpunkt: Orientierung, Feedbackkreislauf und Lernsystem, ohne Totenkopf-, Warn- oder Survival-Ästhetik.

Der Präsentationsmodus hat weder Header noch Footer. Die Folie füllt den Viewport; oben links liegt lediglich der kleine Teilnahmelink auf der Folie. Die Steuerung öffnet sich auf Wunsch als Overlay. Jede Präsentation beginnt mit großem QR-Code und ausgeschriebener URL. Die geschlossene Folienleiste kostet keinen Platz; auf kleinen Bildschirmen öffnet sie als Drawer und schließt nach der Auswahl wieder.

## Motion System

Der verbindliche UI-Vertrag steht direkt in diesem Dokument und wird durch `npm run motion:contract` gegen die Produktoberflächen geprüft. Die wichtigsten Regeln:

1. Navigation erfolgt direkt, ohne vorgeschaltete dekorative Übergangscover oder Wartezeiten.
2. Inhalte erscheinen nach ihren Containern, Listen und Antworten gestaffelt.
3. Folienwechsel halten die Folie stabil und bewegen nur den Inhalt kontrolliert.
4. Drawer, Popover und Inspector-Panels nutzen gemeinsame Dauer-, Easing- und Radius-Tokens.
5. Motion muss eine fachliche Beziehung klären: Quelle der Frage, Bezug zur Folie, geöffneter Zustand oder Ergebnisfeedback.
6. Keine dauerhaften Pulses, keine Bounce-Animation, keine dekorativen Loops.
7. `prefers-reduced-motion` ist Pflicht: reduzierte Bewegung muss dieselbe Struktur ohne kaputte Zwischenzustände zeigen.

## Motion Acceptance

- Keine Food-App-Optik.
- Keine Hotspots, die dauerhaft pulsieren.
- Playwright-Screenshots muessen zentrale Learn-, Live-, Studio- und Mobile-Zustaende belegen.
- Die Startseite bietet direkten Code-Einstieg; ein Vorlesungslink führt ohne Namenspflicht in die Live-Sitzung.
- Der Frage-Drawer oeffnet nicht hart.
- Das Referentenstudio öffnet zusätzliche Tools aus dem Header oder der kombinierten Editierleiste.
- Live-Fragen verschwinden spätestens nach Ablauf ihrer serverseitigen Frist; eine Exit-Animation darf die Frist nicht verlängern.

## Tokens

Die Motion- und Radius-Tokens liegen in `src/app/globals.css` unter `--lb-*`.

- Controls: 8-10 px Radius.
- Zeilen, Antwortoptionen, kleine Panels: 12 px Radius.
- Drawer, Evaluation, Chat, Leaderboard, Studio-Overlays: 18 px Radius.
- Übergangscover: 22 px Radius.
- Press: 120 ms.
- Control-State: 220 ms.
- Row-Stagger: 52 ms.
- Drawer/Inspector: 420 ms.
- Route-/Maskenwechsel: 560-720 ms.

## Component Vocabulary

- `lb-enter-stage`: Hauptbühne oder Folienfläche.
- `lb-enter-sheet`: Bottom-Drawer und größere fachliche Sheets.
- `lb-enter-overlay`: rechte Inspector-Panels.
- `lb-enter-panel`: Popover, kleinere Werkzeugflächen.
- `lb-enter-row`: Antwortoptionen, Listen, Chatzeilen, Quellen, Analytics-Signale.
- `lb-enter-control`: Tool-Buttons, Navigation und optionale Lernsteuerung; keine feste Präsentationsleiste.
- `lb-enter-hotspot`: foliennahe Frage- und Werkzeuganker.

## Interaction Principles

Studierende sollen mit einem Link teilnehmen können. Referenten sollen Folien wie in einem Foliendeck direkt bearbeiten, nicht in einer losgelösten Formularliste. Alle Aktionen gehören nah an das Objekt, das sie verändern. Die Oberfläche bleibt deutsch robust: längere Labels dürfen nicht überlaufen, und reduzierte Bewegung muss die gleiche Informationsstruktur behalten.
