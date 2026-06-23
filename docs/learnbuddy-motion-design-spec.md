# LearnBuddy Motion- und Design-Aufbau-Spezifikation

Stand: 18. Juni 2026

Dieses Dokument beschreibt, wie LearnBuddy visuell weiterentwickelt werden soll, ohne die bestehende Produktlogik zu verwässern. Der Fokus liegt nicht auf neuen Farben oder dekorativer Oberfläche, sondern auf einem app-weiten Motion-System: Elemente sollen sich definiert aufbauen, Zustände sollen räumlich ineinander übergehen, und wichtige Objekte sollen beim Wechsel zwischen Modi erkennbar dieselben Objekte bleiben.

Grundlage dieser Spezifikation:

- Aktueller Projektstand in `src/app/globals.css`, `src/components/LecturerDashboard.tsx`, `src/components/SlideCanvas.tsx`, `src/components/LearnExperience.tsx`, `src/components/LecturerLiveExperience.tsx`, `src/components/QuizDrawer.tsx` und `src/components/LeaderboardModal.tsx`.
- Browser-Screenshots des aktuellen Stands: Start, Referentenlogin, Referentenstudio, Student Live, Learn-Modus, geöffneter Fragen-Drawer und geöffnete Evaluation.
- Frame-Auswertung des bereitgestellten Pinterest-HLS-Videos: 23,54 s, 1280 x 960 px, 60 fps, zusätzlich 10-fps-Zeitstreifen und Keyframes in voller Auflösung.

## 1. Zielbild

LearnBuddy soll weiter ruhig, präzise und werkzeugartig wirken. Das gewisse Etwas soll aus Bewegungsqualität entstehen:

1. Die App baut Screens nicht statisch auf, sondern in einer klaren Reihenfolge.
2. Große Zustandswechsel nutzen Masken, Sheets und Shared-Element-Transitions statt harter Mount/Unmount-Sprünge.
3. Kleine Elemente erscheinen mit Staggering, aber ohne Show-Effekt.
4. Panels, Drawer, Bottom-Bars und Popover haben konsistente Radien, Bewegungsachsen und Timings.
5. Folie, Frage, Quelle, Auswertung und Evaluation bleiben als fachliche Objekte verständlich verankert.

Das Referenzvideo ist eine Food-Delivery-Mobile-App. LearnBuddy soll nicht deren Farben, Illustrationen oder Mobile-App-Look kopieren. Übernommen werden nur die Bewegungsprinzipien:

- Bottom-Layer expandiert zu einem neuen Screen.
- Ein Cover-Layer maskiert den alten Zustand.
- Neue Inhalte werden unter der Maske freigelegt.
- Wichtige Objekte skalieren und wandern weiter, statt zu verschwinden.
- Inhalte erscheinen in einer zeitlich gestaffelten, aber kurzen Sequenz.

## 2. Aktueller LearnBuddy-Zustand

### 2.1 Bestehende visuelle Struktur

LearnBuddy hat bereits eine brauchbare räumliche Grundlage:

- Start und Login nutzen `.mode-screen` mit zentrierter `.mode-card`.
- Referentenstudio nutzt eine fullscreen-nahe Stage mit großem Slide und kompakten Steuerelementen.
- Learn-Modus nutzt `.slide-screen`, Folieninhalt, Hotspots, `.learn-bar`, `.slide-nav`, `.action-stack`, `.question-drawer` und `.overlay-panel`.
- Fragen, Evaluation, Chat und Leaderboard erscheinen als Drawer oder Overlay.
- Die meisten Controls haben bereits kleine Radien zwischen 8 und 14 px.

### 2.2 Aktuelle Schwächen

Der Stand wirkt noch unspektakulär, weil die Zustandswechsel überwiegend nur React-Mounting sind:

- Start/Login erscheinen als fertige Karte ohne Aufbau.
- Folienwechsel ersetzen Inhalt hart.
- Der Fragen-Drawer erscheint sofort an seiner Endposition.
- Overlay-Panels erscheinen als fertige Kästen, nicht aus einem Anker heraus.
- Hotspots, Bottom-Bar, Slide-Nav und Action-Buttons stehen sofort im Bild.
- Listen und Antwortoptionen haben kaum zeitliche Ordnung.
- Es gibt einzelne `transition: opacity 160ms ease-out`, aber kein app-weites Timing-System.

Das Problem ist nicht fehlende Farbe. Das Problem ist fehlende Zustandskontinuität.

## 3. Videoanalyse: gemessene Bewegungsstruktur

### 3.1 Rohdaten

- Quelle: HLS-Manifest mit Varianten bis 1280 x 960 px.
- Dauer: 23,54 s.
- Framerate: 60 fps.
- Komposition: 4:3-Social-Video, zentrale Phone-Mockups auf hellem Grund.
- Ein einzelnes Phone im Originalframe misst je nach Zustand ca. 378 x 782 px.
- Sichtbarer Phone-Radius: ca. 32 px bei 378 px Breite, also ca. 8,5% der Breite.
- Innere Panels: ca. 14 bis 18 px Radius bei Phone-Breite 378 px.
- Bottom- und Top-Sheets: ca. 20 bis 24 px Radius, nur an den freiliegenden Kanten.

Diese Werte sind aus den Frames abgeleitet, nicht aus dem Original-Designfile. Sie sind aber stabil genug, um sie in CSS-Tokens zu übersetzen.

### 3.2 Wichtige Übergangsfenster im Video

| Zeitfenster | Beobachtung | Mechanik |
|---:|---|---|
| 0,0-1,6 s | Zwei Screens stehen nebeneinander. Produktobjekt pulsiert zwischen Detail-Phone und Home-Liste. | Shared Object mit Scale- und X-Translation. Kein Screen-Wechsel. |
| 1,6-2,0 s | Detail-Phone fährt hinter Home-Phone weg. | Layer-Depth: hinteres Objekt sinkt in z-Order und verschwindet seitlich. |
| 2,0-3,3 s | Home-Liste filtert oder lädt neu. Einzelne Zeilen verschwinden und kommen wieder. | Row-Stagger, je Zeile ca. 50-70 ms Versatz. |
| 5,0-6,0 s | Bottom-Navigation wird dominant, dann wächst ein dunkler Layer von unten zur Vollfläche. | Bottom-origin Wipe, `scaleY` oder `clip-path`, Dauer ca. 520-620 ms. |
| 6,0-7,0 s | Neuer Store-Screen wird aus dem dunklen Layer freigelegt. Hero-Bild erscheint oben, Content-Sheet danach. | Zweiphasiger Reveal: erst Medienfläche, dann weißes Content-Sheet. |
| 7,0-8,0 s | Produktliste baut sich auf. | Zeilen-Stagger, ca. 45-65 ms Versatz, nach dem Hauptpanel. |
| 10,0-10,7 s | Store-Screen wird mit dunkler Fläche überdeckt. | Cover-Maske, alte Liste verschwindet unter der Maske. |
| 10,8-11,8 s | Detail-Screen erscheint, großes Objekt kommt aus der alten Listenposition. | Shared-Element-Transition plus Detail-Panel-Reveal. |
| 12,5-13,3 s | CTA und Bottom-Bar reagieren auf `Add to cart`. | Button-Press 100-140 ms, Icon-Pulse 180-220 ms. |
| 14,3-15,4 s | Detail geht in Cart über. Dunkler Layer wächst, dann peachfarbene Fläche und Cart-Panel. | Bottom-Wipe, dann Gegen-Reveal des neuen Inhalts. |
| 15,3-16,0 s | Cart-Items erscheinen nacheinander. | Row-Stagger, ca. 50 ms. |
| 17,4-18,5 s | Cart wird zu Delivery-Screen. Helle Fläche übernimmt die Vollhöhe. | Top/bottom Sheet-Morph, alter Header bleibt kurz als Anker. |
| 18,4-19,0 s | Delivery-Icon und Text erscheinen. | Center-build: Icon, Titel, Toast nacheinander. |
| 20,3-21,0 s | Delivery-Screen wird durch weißen und peachfarbenen Wipe geleert. | Vertikales Maskieren, keine harte Navigation. |
| 21,0-22,2 s | Home-Screen baut von oben und seitlich wieder auf. | Header zuerst, dann Kategorieleiste, dann Listenzeilen. |
| 22,2-23,5 s | Zweiter Detail-Screen kommt wieder als Tiefenlayer dazu. Produktobjekt pulsiert. | Rückkehr zur Intro-Komposition mit Shared Object. |

### 3.3 Bewegungslogik des Videos

Das Video nutzt fast nie einen klassischen `slide-left`-Page-Wechsel. Es arbeitet mit diesen Bausteinen:

1. **Persistent shell**: Phone-Rahmen und Screen-Bounds bleiben stabil.
2. **Cover layer**: Eine Vollflächenmaske deckt den alten Zustand ab.
3. **Origin-based reveal**: Neue Inhalte entstehen aus der Richtung der Aktion. Bottom-Bar wird zu Cart, Liste wird zu Detail, Delivery wird zu Home.
4. **Shared element**: Das Produktbild bleibt als dasselbe Objekt sichtbar.
5. **Staggered content**: Inhalte erscheinen erst nach dem Container, nie davor.
6. **Corner continuity**: Der Radius bleibt während eines Morphs verwandt. Eine Bottom-Bar mit 12-16 px Radius wird nicht plötzlich ein eckiges Panel.
7. **Short hold**: Zwischen Cover und Reveal gibt es oft ca. 80-140 ms Vollflächen-Halt. Dadurch fühlt sich der Wechsel kontrolliert an.

## 4. LearnBuddy-Motion-Prinzipien

### 4.1 Es gibt drei Motion-Ebenen

**Ebene 1: App- und Moduswechsel**

Beispiele:

- Start/Login zu Referentenstudio.
- Pseudonym-Gate zu Student Live.
- Learn-Modus öffnet Evaluation oder Chat.
- Studio öffnet Werkzeuge, Planung, Fragen, Quellen oder Auswertung.

Diese Wechsel dürfen 520-760 ms dauern und mit Masken arbeiten.

**Ebene 2: Arbeitsflächenwechsel**

Beispiele:

- Folie 1 zu Folie 2.
- Frage-Drawer öffnet.
- Studio-Fragenlayer ersetzt die normale Folienansicht teilweise.
- Quellenlayer öffnet zur aktuellen Folie.

Diese Wechsel sollen 320-520 ms dauern.

**Ebene 3: Mikrointeraktion**

Beispiele:

- Button-Press.
- Hotspot-Feedback.
- Antwort richtig/falsch.
- Save-State.
- Zeilen in einer Liste erscheinen.

Diese Bewegungen sollen 100-240 ms dauern.

### 4.2 Motion muss an fachlichen Objekten hängen

LearnBuddy soll nicht animieren, weil es hübsch ist. Jede Bewegung beantwortet eine räumliche Frage:

- Woher kommt diese Frage?
- Zu welcher Folie gehört dieses Panel?
- Welche Aktion hat diesen Zustand geöffnet?
- Was bleibt gleich, obwohl der Modus gewechselt hat?
- Was ist neu hinzugekommen?

Wenn eine Bewegung diese Frage nicht beantwortet, wird sie gestrichen.

### 4.3 Keine Layout-Animationen

Nicht animieren:

- `height`
- `width`
- `top`
- `left`
- `margin`
- `padding`
- CSS Grid Tracks

Stattdessen:

- `transform`
- `opacity`
- `clip-path`
- `filter` nur sparsam und kurz
- View Transitions API oder FLIP für echte Positionswechsel

## 5. Exakte Motion-Tokens

Diese Tokens sollen in `:root` in `src/app/globals.css` ergänzt werden.

```css
:root {
  --lb-ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --lb-ease-mask: cubic-bezier(0.22, 1, 0.36, 1);
  --lb-ease-standard: cubic-bezier(0.2, 0.8, 0.2, 1);
  --lb-ease-in: cubic-bezier(0.55, 0, 1, 0.45);

  --lb-dur-press: 120ms;
  --lb-dur-fade: 180ms;
  --lb-dur-control: 220ms;
  --lb-dur-row: 260ms;
  --lb-dur-panel: 420ms;
  --lb-dur-mask: 560ms;
  --lb-dur-route: 720ms;
  --lb-dur-shared: 620ms;

  --lb-stagger-tight: 32ms;
  --lb-stagger-row: 52ms;
  --lb-stagger-panel: 76ms;
}
```

### 5.1 Warum diese Werte

Die Referenz liegt bei großen Screen-Morphs oft zwischen 900 und 1100 ms inklusive Pause, weil sie als Social-Video inszeniert ist. LearnBuddy ist ein Arbeitsprodukt. Deshalb werden die Bewegungen komprimiert:

- Video-Cover ca. 520-620 ms wird in LearnBuddy als `--lb-dur-mask: 560ms` übernommen.
- Video-Gesamtwechsel ca. 900-1100 ms wird in LearnBuddy auf `--lb-dur-route: 720ms` reduziert.
- Video-Row-Stagger ca. 45-70 ms wird als `--lb-stagger-row: 52ms` übernommen.
- Press-Feedback bleibt kurz bei 120 ms.
- Standard-Control-Reaktion liegt bei 180-220 ms.

Damit fühlt sich die App definiert an, ohne die Arbeit zu verlangsamen.

## 6. Exakte Radius-Tokens

Aktuell liegen LearnBuddy-Radien verteilt zwischen 8, 10, 12, 14 und 18 px. Das ist grundsätzlich passend, aber nicht konsequent hierarchisiert. Die neue Staffelung:

```css
:root {
  --lb-radius-control: 8px;
  --lb-radius-control-lg: 10px;
  --lb-radius-panel: 12px;
  --lb-radius-panel-lg: 16px;
  --lb-radius-sheet: 18px;
  --lb-radius-stage: 18px;
  --lb-radius-cover: 22px;
  --lb-radius-pill: 999px;
}
```

### 6.1 Anwendung der Radien

| Elementtyp | Radius | Begründung |
|---|---:|---|
| Input, Select, kleine Buttons | 8 px | Bereits im Bestand etabliert, funktional. |
| Icon-Buttons, Segmented Controls | 10 px | Etwas weicher, bleibt präzise. |
| Kleine Karten, Listenreihen, Antwortoptionen | 12 px | Aktuell meist 8-10 px, künftig etwas eigenständiger. |
| Popover, Tool-Menüs, Mini-Panels | 16 px | Genug Fläche für einen wahrnehmbaren Aufbau. |
| Drawer, Evaluation, Chat, Leaderboard | 18 px | Entspricht der größeren Sheet-Hierarchie. |
| Slide-Stage im Studio | 18 px | Die Folie wird als Hauptobjekt lesbar. |
| Temporäre Cover-/Morph-Layer | 22 px | Nur für Übergangssheets, nicht für normale Karten. |
| Hotspots, Badges, Pills | 999 px | Runde Zielpunkte und Statusmarker. |

### 6.2 Radius-Kontinuität

Bei Morphs darf der Radius höchstens eine Stufe springen:

- Bottom-Bar 12 px zu Drawer 18 px ist erlaubt.
- Button 8 px zu Vollscreen-Sheet 22 px ist zu viel, außer es gibt eine Cover-Maske dazwischen.
- Hotspot 999 px zu Frage-Drawer 18 px braucht einen Zwischenzustand: erst Kreis-Pulse, dann Sheet-Reveal aus der unteren Bar.

## 7. Globale CSS-Architektur

### 7.1 Motion-Root

Die App braucht keine Animation-Library als Pflicht. Es reicht zunächst eine CSS-Schicht:

```css
.lb-motion-root {
  isolation: isolate;
}

.lb-build > * {
  opacity: 0;
  transform: translateY(10px) scale(0.985);
  animation: lb-build-in var(--lb-dur-row) var(--lb-ease-out) both;
  animation-delay: calc(var(--lb-i, 0) * var(--lb-stagger-row));
}

@keyframes lb-build-in {
  from {
    opacity: 0;
    transform: translateY(10px) scale(0.985);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
```

Alle wiederholten Inhalte erhalten `--lb-i` als Inline-Style oder über nth-child-Regeln. Beispiele:

- `.mode-list a`
- `.slide-copy p`
- `.answers .answer`
- `.leader-row`
- `.studio-slide-strip button`
- `.studio-tool-choice`
- `.source-row`
- `.review-live-answer`

### 7.2 Masken-Layer

Für größere Moduswechsel wird ein absoluter Layer benötigt:

```css
.lb-cover {
  position: absolute;
  inset: 0;
  z-index: 40;
  pointer-events: none;
  border-radius: inherit;
  transform: scaleY(0);
  transform-origin: bottom;
  background: var(--stage);
}

.lb-cover[data-state="entering"] {
  animation: lb-cover-up var(--lb-dur-mask) var(--lb-ease-mask) both;
}

@keyframes lb-cover-up {
  from {
    transform: scaleY(0);
  }
  to {
    transform: scaleY(1);
  }
}
```

Für LearnBuddy darf diese Maske nicht als dunkle Showfläche wahrgenommen werden. Sie soll aus bestehenden Flächen entstehen:

- Learn-Modus: aus `.learn-bar` oder `.action-stack`.
- Fragen-Drawer: aus dem `?`-Hotspot oder der Bottom-Bar.
- Evaluation: aus dem `✓`-Action-Button rechts unten.
- Studio-Werkzeuge: aus der unteren Steuerleiste.
- Quellen: aus dem Quellen-Tool-Button oder Material-Dropzone.

### 7.3 Sheet-Reveal

```css
.lb-sheet-enter {
  clip-path: inset(100% 0 0 0 round var(--lb-radius-sheet));
  transform: translateY(14px);
  opacity: 0.96;
  animation: lb-sheet-enter var(--lb-dur-panel) var(--lb-ease-out) both;
}

@keyframes lb-sheet-enter {
  to {
    clip-path: inset(0 0 0 0 round var(--lb-radius-sheet));
    transform: translateY(0);
    opacity: 1;
  }
}
```

Für rechte Inspector-Panels:

```css
.lb-inspector-enter {
  clip-path: inset(0 0 0 100% round var(--lb-radius-sheet));
  transform: translateX(18px);
  opacity: 0.98;
  animation: lb-inspector-enter var(--lb-dur-panel) var(--lb-ease-out) both;
}
```

## 8. Shared-Element-Transitions für LearnBuddy

Das wichtigste Video-Prinzip ist nicht der Wipe, sondern die Objektkontinuität. Für LearnBuddy sollten folgende Objekte als Shared Elements behandelt werden:

| Objekt | Ausgang | Ziel | Umsetzung |
|---|---|---|---|
| Folienminiatur | `.studio-slide-strip button` | große Stage-Folie | FLIP oder View Transition `view-transition-name: slide-{id}`. |
| Frage-Hotspot | `.hotspot` oder Tool-Menü `Fragen` | `.question-drawer` | Kreis pulst 120 ms, Sheet wächst aus unterem Bereich. |
| Fragekarte | Review-Vorschau | Live-/Learn-Frage | Gleiche Card-Radien, gleiche Antwortreihen, nur andere Dichte. |
| Quelle | Quellen-Chip oder Dropzone | Quellen-Layer | Chip skaliert zu einer Quellenliste. |
| Evaluation-Icon | `✓`-Action | `.overlay-panel.evaluation-panel` | Inspector-Reveal von rechts, kein harter Mount. |
| KI-Chat-Button | `KI fragen` | `.overlay-panel.tall` | Button wird zu Header-Anker, Panel folgt von rechts. |
| Speichern-Button | `.studio-save-inline` | Save-Feedback | Button-Press, kurzer Status-Pill-Aufbau, kein Layoutsprung. |

### 8.1 FLIP-Minimalpattern

Für echte Objektbewegung reicht eine kleine Utility:

```ts
function animateFlip(element: HTMLElement, first: DOMRect, last: DOMRect) {
  const dx = first.left - last.left;
  const dy = first.top - last.top;
  const sx = first.width / last.width;
  const sy = first.height / last.height;

  element.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
      { transform: "translate(0, 0) scale(1, 1)" }
    ],
    {
      duration: 620,
      easing: "cubic-bezier(0.16, 1, 0.3, 1)",
      fill: "both"
    }
  );
}
```

Wenn die View Transitions API verwendet wird, sollten die Namen stabil und fachlich sein:

```css
.slide[data-slide-id="slide_1"] {
  view-transition-name: lb-slide-slide-1;
}

.question-drawer {
  view-transition-name: lb-question-drawer;
}
```

Für Next/React-Client-State-Wechsel ist FLIP meist berechenbarer als reine Route-View-Transitions.

## 9. Konkrete Anpassungen nach Oberfläche

### 9.1 Startseite und Login

Aktuell:

- `.mode-card` steht fertig zentriert im Raum.
- `.mode-list a` erscheinen gleichzeitig.

Soll:

1. Hintergrund ist sofort da.
2. `.mode-card` erscheint in 420 ms mit `translateY(16px) scale(0.985)`.
3. Eyebrow nach 80 ms.
4. H1 nach 130 ms.
5. Copy nach 180 ms.
6. Links gestaffelt ab 260 ms, je 52 ms.

CSS:

```css
.mode-card {
  border-radius: var(--lb-radius-sheet);
  animation: lb-card-arrive var(--lb-dur-panel) var(--lb-ease-out) both;
}

.mode-list a {
  animation: lb-build-in var(--lb-dur-row) var(--lb-ease-out) both;
  animation-delay: calc(260ms + var(--lb-i, 0) * var(--lb-stagger-row));
}

@keyframes lb-card-arrive {
  from {
    opacity: 0;
    transform: translateY(16px) scale(0.985);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
```

Keine zusätzliche Illustration. Die Qualität entsteht aus Ankunft und Ordnung.

### 9.2 Pseudonym-Gate zu Student Live

Aktuell:

- Student Live startet mit `.mode-card`.
- Nach Teilnahme entsteht später der Slide-Modus.

Soll:

- Die Pseudonym-Karte ist kein isolierter Login-Screen, sondern ein Eingang in die Vorlesungsbühne.
- Nach Klick auf `Teilnehmen` expandiert die Karte nicht selbst, sondern eine `lb-cover`-Maske wächst aus der Card-Fläche.
- Die Slide-Bühne wird darunter aufgebaut.

Timing:

| Phase | Dauer | Delay |
|---|---:|---:|
| Button press | 120 ms | 0 ms |
| Card compress `scale(0.992)` | 120 ms | 0 ms |
| Cover aus Card-Bounds | 560 ms | 80 ms |
| Slide-Meta und Titel | 320 ms | 320 ms |
| Copy-Zeilen und Diagramm | 260 ms | 430 ms, gestaffelt |
| Controls | 220 ms | 560 ms |

### 9.3 Learn-Modus: initialer Aufbau

Aktuell:

- Slide, Hotspots, Bottom-Bar und Action-Buttons sind sofort sichtbar.

Soll:

1. `.slide` kommt zuerst.
2. `.slide-meta` und `.slide h1` erscheinen als typografische Sequenz.
3. `.slide-copy p` erscheinen nacheinander.
4. `.diagram` erscheint nach dem Text, nicht gleichzeitig.
5. Hotspots erscheinen zuletzt als kurze Scale-Ins.
6. `.learn-bar`, `.slide-nav`, `.action-stack` kommen als Controls nach der Bühne.

Timing:

| Element | Animation | Dauer | Delay |
|---|---|---:|---:|
| `.slide` | opacity 0 -> 1 | 180 ms | 0 ms |
| `.slide-meta` | translateY(8), opacity | 260 ms | 80 ms |
| `.slide h1` | translateY(12), opacity | 320 ms | 120 ms |
| erste `.slide-copy p` | translateY(10), opacity | 260 ms | 260 ms |
| zweite `.slide-copy p` | translateY(10), opacity | 260 ms | 312 ms |
| `.diagram` | scale(0.985), opacity | 320 ms | 360 ms |
| Hotspots | scale(0.82), opacity | 220 ms | 480 ms + 32 ms je Hotspot |
| `.slide-nav`, `.learn-bar`, `.action-stack` | translateY(12), opacity | 260 ms | 560 ms |

Hotspots sollen keinen dauerhaften Pulse bekommen. Nur beim Eintritt und bei gezielter Interaktion.

### 9.4 Folienwechsel

Aktuell:

- `SlideCanvas` wechselt den State hart. Der neue Inhalt ersetzt den alten sofort.

Soll:

- Der Slide selbst bleibt als Fläche stabil.
- Text und Diagramm wechseln per kurzer Cross-Fade/Translate.
- Die Richtung der Foliennavigation bestimmt die Bewegung: `next` leicht von rechts, `previous` leicht von links.

Timing:

| Phase | Dauer |
|---|---:|
| alter Text raus | 180 ms |
| neuer Titel rein | 260 ms |
| neue Copy gestaffelt | 260 ms + 52 ms je Zeile |
| Diagramm FLIP oder Scale-In | 320 ms |

CSS-Pattern:

```css
.slide-content-enter-next {
  animation: lb-slide-content-next 320ms var(--lb-ease-out) both;
}

@keyframes lb-slide-content-next {
  from {
    opacity: 0;
    transform: translateX(18px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}
```

Nicht die ganze Folie horizontal schieben. Das würde Präsentationssoftware imitieren. LearnBuddy soll eher ein lebendiges Arbeitsdeck sein.

### 9.5 Frage-Drawer im Learn-Modus

Aktuell:

- `.question-drawer` erscheint unten direkt an der Endposition.
- `KI fragen` ist fixed mit Inline-Style.

Soll:

- Der Drawer entsteht aus der unteren Steuerzone.
- Zuerst reagiert der Hotspot oder `?`-Button.
- Dann wächst eine Sheet-Maske von unten.
- Erst danach erscheinen Level-Switch, Frage, Antworten und Timer.

Timing:

| Element | Dauer | Delay |
|---|---:|---:|
| Hotspot/Button press | 120 ms | 0 ms |
| Drawer-Sheet aus Bottom | 420 ms | 60 ms |
| Level-Switch | 220 ms | 220 ms |
| Frage | 260 ms | 260 ms |
| Antwort A-D | 260 ms | 320 ms + 52 ms je Antwort |
| Timer | 220 ms | 420 ms |
| `KI fragen` | 220 ms | 500 ms |

CSS:

```css
.question-drawer {
  border-radius: var(--lb-radius-sheet);
  transform-origin: bottom center;
}

.question-drawer[data-state="opening"] {
  animation: lb-question-drawer-in var(--lb-dur-panel) var(--lb-ease-out) both;
}

@keyframes lb-question-drawer-in {
  from {
    opacity: 0;
    transform: translate(-50%, 18px) scaleY(0.86);
    clip-path: inset(100% 0 0 0 round var(--lb-radius-sheet));
  }
  to {
    opacity: 1;
    transform: translate(-50%, 0) scaleY(1);
    clip-path: inset(0 0 0 0 round var(--lb-radius-sheet));
  }
}
```

Die Antwortoptionen sollen nicht alle gleichzeitig erscheinen. Sie sind die beste Stelle, um den "definierten Aufbau" sichtbar zu machen.

### 9.6 Antwortfeedback

Aktuell:

- `.answer.correct` und `.answer.wrong` ändern Hintergrund und Rand.

Soll:

- Auswahl bekommt zuerst 120 ms Press.
- Danach färbt die gewählte Option in 220 ms.
- Die richtige Option bekommt eine kurze Scale-Betonung `scale(1.012)` für 160 ms.
- Falsche Antwort darf nicht wackeln, sondern nur kontrolliert den State wechseln.

Timing:

| Zustand | Dauer |
|---|---:|
| Press | 120 ms |
| State-Fill | 220 ms |
| Correct emphasis | 160 ms |
| Explanation-Aufbau | 260 ms mit 80 ms Delay |

### 9.7 Evaluation, Chat, Leaderboard

Aktuell:

- `.overlay-panel` erscheint rechts fertig.
- Evaluation kann über dem geöffneten Frage-Drawer liegen.

Soll:

- Rechte Panels sind Inspector-Sheets.
- Sie öffnen aus dem jeweiligen Action-Button heraus.
- Die Stage im Hintergrund bleibt sichtbar und wird nicht stark abgedunkelt.
- Bei gleichzeitig offenem Frage-Drawer muss das rechte Sheet räumlich übergeordnet sein, nicht zufällig darübergelegt.

Timing:

| Panel | Richtung | Dauer | Radius |
|---|---|---:|---:|
| Evaluation | rechts -> links | 420 ms | 18 px |
| KI-Chat | rechts -> links | 420 ms | 18 px |
| Leaderboard | rechts unten -> rechts | 360 ms | 18 px |
| Transcript | rechts -> links | 360 ms | 18 px |

CSS:

```css
.overlay-panel {
  border-radius: var(--lb-radius-sheet);
  transform-origin: right center;
}

.overlay-panel[data-state="opening"] {
  animation: lb-overlay-in var(--lb-dur-panel) var(--lb-ease-out) both;
}

@keyframes lb-overlay-in {
  from {
    opacity: 0;
    transform: translateX(22px) scale(0.985);
    clip-path: inset(0 0 0 100% round var(--lb-radius-sheet));
  }
  to {
    opacity: 1;
    transform: translateX(0) scale(1);
    clip-path: inset(0 0 0 0 round var(--lb-radius-sheet));
  }
}
```

Panel-Inhalt:

- Header sofort mit dem Panel.
- Body-Zeilen ab 160 ms.
- Inputs ab 220 ms.
- Primary-Button ab 320 ms.

### 9.8 Referentenstudio

Aktuell:

- Das Studio ist fullscreen-nah und auf die Folie fokussiert.
- Es hat eine untere Bar, rechte Icon-Objektleiste und optionale Popover/Drawer.
- Der Screenshot zeigt noch kaum Bewegungsqualität.

Soll:

Das Referentenstudio ist der wichtigste Kandidat für app-weites Motion-Design. Die Folie ist das stabile Objekt. Alles andere entsteht an ihr:

1. Studio lädt mit der Folie als Hauptfläche.
2. Bottom-Bar kommt nach der Folie.
3. Tool-Menü baut sich aus der Bottom-Bar auf.
4. Fragen-/Quellen-/Analytics-/Evaluation-Layer entstehen nicht als getrennte Adminflächen, sondern als Sheet aus der Folie oder Bottom-Bar.
5. Die Folie bleibt dabei sichtbar oder wird nur teilweise überlagert.

#### Studio-Initialaufbau

| Element | Dauer | Delay |
|---|---:|---:|
| Stage-Background | 180 ms | 0 ms |
| Slide-Fläche | 420 ms | 80 ms |
| Slide-Typografie | 320 ms | 220 ms |
| Diagramm | 320 ms | 320 ms |
| rechte Tool-Buttons | 220 ms | 480 ms + 32 ms je Button |
| Bottom-Bar | 320 ms | 560 ms |
| Mini-Folien/Planung/Speichern | 220 ms | 650 ms + 32 ms je Element |

#### Studio-Tool-Menü

`.studio-tool-popover` soll sich nicht einfach öffnen. Es soll aus dem `Werkzeuge`-Button wachsen:

- `transform-origin: bottom right`.
- `scale(0.96) translateY(8px)` zu normal.
- 260 ms Panel.
- Choices je 32 ms Stagger.
- Radius 16 px.

#### Studio-Kontextdrawer

`.studio-context-drawer` soll je nach Tool eine Herkunft haben:

- Fragen: aus der Frage-Schaltfläche, eher von unten/rechts.
- Quellen: aus Quellen-Schaltfläche oder Dropzone.
- Auswertung: von rechts als Inspector.
- Evaluation: aus `✓` oder Planungsbereich.
- Assistent: von rechts, aber mit Message-Body-Stagger.

Für alle:

```css
.studio-context-drawer {
  border-radius: var(--lb-radius-sheet);
}
```

Öffnung:

- Drawer-Sheet 420 ms.
- Header 180 ms nach 120 ms.
- Inhalt 260 ms ab 220 ms.
- Listen/Antworten/Quellen je 52 ms Stagger.

### 9.9 Quellen und Material

Quellen wirken aktuell wie Listen/Rows. Sie sollten als fachliche Objekte entstehen:

- Dropzone oder Quellen-Button pulst 120 ms.
- Quellen-Sheet öffnet 420 ms.
- Composer-Modus erscheint zuerst.
- Bestehende Quellen erscheinen danach zeilenweise.
- Verarbeitungslauf oder Statuschip animiert nur Status, nicht Layout.

Status-Timing:

| Status | Bewegung |
|---|---|
| queued | 180 ms opacity, kein Spinner im Zentrum |
| running | dezenter progress shimmer, 1000 ms loop, nur im Statuschip |
| succeeded | 220 ms Fill zu Success-State |
| failed | 220 ms Fill zu Error-State, Retry-Button 120 ms später |

### 9.10 Analytics und Verbesserungsvorschläge

Analytics soll nicht als Dashboard-Mosaik wirken. Motion kann hier Vergleichbarkeit herstellen:

- Metriken bauen links nach rechts mit 52 ms Stagger auf.
- Zeitverlauf/Cluster erscheinen nach den Metriken.
- Verbesserungsvorschläge erscheinen als priorisierte Liste, nicht alle gleichzeitig.
- Übernehmen-Aktion nutzt Shared-Element: Vorschlagskarte wird zur betroffenen Folien- oder Fragenstelle.

Konkrete Reihenfolge:

1. Header und Scope.
2. Kernmetriken.
3. Cluster oder Verlauf.
4. Vorschläge.
5. Historie.

## 10. App-weite Aufbauklassen

Damit nicht jede Komponente eigene Keyframes erfindet, sollen diese Klassen eingeführt werden:

```css
.lb-enter-stage {}
.lb-enter-panel {}
.lb-enter-sheet {}
.lb-enter-row {}
.lb-enter-control {}
.lb-enter-hotspot {}
.lb-enter-overlay {}
.lb-enter-shared {}
```

Die Klasse definiert nur Bewegung. Layout bleibt in bestehenden Komponentenklassen.

Empfohlene Zuordnung:

| Bestehender Selector | Neue Motion-Klasse |
|---|---|
| `.mode-card` | `.lb-enter-sheet` |
| `.mode-list a` | `.lb-enter-row` |
| `.slide` | `.lb-enter-stage` |
| `.slide-copy p` | `.lb-enter-row` |
| `.diagram` | `.lb-enter-panel` |
| `.hotspot`, `.studio-hotspot` | `.lb-enter-hotspot` |
| `.learn-bar`, `.slide-nav`, `.action-stack` | `.lb-enter-control` |
| `.question-drawer` | `.lb-enter-sheet` |
| `.overlay-panel`, `.transcript-panel` | `.lb-enter-overlay` |
| `.studio-tool-popover`, `.studio-plan-popover` | `.lb-enter-panel` |
| `.studio-context-drawer` | `.lb-enter-sheet` |
| `.answer`, `.review-live-answer` | `.lb-enter-row` |

## 11. React-State-Anforderungen

CSS allein reicht nicht, weil viele Komponenten sofort unmounten. Für saubere Exit-Animationen braucht die UI einen kleinen Presence-Mechanismus.

### 11.1 Mindestanforderung

Statt:

```tsx
{questionOpen && <QuizDrawer />}
```

besser:

```tsx
<Presence show={questionOpen} exitMs={280}>
  {(state) => <QuizDrawer motionState={state} />}
</Presence>
```

`state` ist:

- `entering`
- `open`
- `exiting`
- `closed`

So kann CSS `data-state="exiting"` animieren, bevor React entfernt.

### 11.2 Exit-Timings

| Element | Exit-Dauer |
|---|---:|
| kleine Controls | 140 ms |
| Antwort-/Listenreihen | 160 ms |
| Popover | 200 ms |
| Drawer | 280 ms |
| Overlay/Inspector | 280 ms |
| Route-/Mode-Cover | 360 ms |

Exit ist immer kürzer als Enter.

## 12. Reduced Motion

Für `prefers-reduced-motion: reduce` muss die App weiterhin klar bleiben:

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 1ms !important;
    animation-delay: 0ms !important;
    transition-duration: 1ms !important;
    scroll-behavior: auto !important;
  }

  .lb-cover {
    display: none;
  }
}
```

Wichtig: Reduced Motion soll nicht zu kaputten Zwischenzuständen führen. Elemente müssen ohne Animation direkt in ihrem Endzustand sichtbar sein.

## 13. Performance-Regeln

1. Nur `transform`, `opacity` und sparsam `clip-path` animieren.
2. `filter: blur()` maximal 4-6 px und nur unter 260 ms einsetzen.
3. Keine dauerhaften Schattenanimationen.
4. Keine Animation großer Textblöcke mit Layout-Veränderung.
5. `will-change` nur während aktiver Animation setzen, nicht global.
6. Stagger-Gruppen auf maximal 12 sichtbare Elemente begrenzen. Lange Listen laden in Gruppen.
7. Keine Endlos-Pulses für Hotspots. Das macht die Lernumgebung unruhig.

## 14. Priorisierte Umsetzung

### Phase 1: Tokens und globale Aufbauklassen

Dateien:

- `src/app/globals.css`

Aufgaben:

- Motion- und Radius-Tokens ergänzen.
- `@keyframes` für `lb-build-in`, `lb-card-arrive`, `lb-sheet-enter`, `lb-overlay-in`, `lb-hotspot-in`, `lb-control-in`.
- Reduced-Motion-Regel ergänzen.

Erfolgskriterium:

- Start/Login, Learn-Modus und Studio können dieselben Klassen nutzen.

### Phase 2: Learn-Modus und Drawer

Dateien:

- `src/components/LearnExperience.tsx`
- `src/components/QuizDrawer.tsx`
- `src/components/LeaderboardModal.tsx`
- `src/app/globals.css`

Aufgaben:

- Presence-State für `questionOpen`, `chatOpen`, `evaluationOpen`, `leaderboardOpen`.
- `QuizDrawer` bekommt `data-state`.
- Antworten bekommen `--lb-i`.
- `KI fragen` verlässt Inline-Positionierung und wird regulärer Bestandteil des Drawer-Aufbaus.

Erfolgskriterium:

- Frage öffnet in definierter Reihenfolge aus der unteren Zone.
- Antwortoptionen bauen nacheinander auf.
- Evaluation öffnet als rechter Inspector.

### Phase 3: Slide-Wechsel

Dateien:

- `src/components/SlideCanvas.tsx`
- `src/components/LearnExperience.tsx`
- `src/components/LecturerLiveExperience.tsx`
- `src/app/globals.css`

Aufgaben:

- Richtung des Folienwechsels speichern: `next` oder `previous`.
- Slide-Inhalt keyed rendern.
- Titel, Copy und Diagramm mit Direction-Klassen animieren.
- Hotspots nach Slide-Wechsel neu, aber kurz aufbauen.

Erfolgskriterium:

- Folie bleibt als Bühne stabil.
- Inhalt wechselt kontrolliert.
- Kein harter Textsprung.

### Phase 4: Referentenstudio

Dateien:

- `src/components/LecturerDashboard.tsx`
- `src/app/globals.css`

Aufgaben:

- Bottom-Bar und Tool-Menü bekommen Aufbau-/Popover-Animationen.
- `studio-context-drawer` bekommt Presence-State.
- Tool-Inhalte bauen intern gestaffelt auf.
- Folienstrip und Stage nutzen Shared-Element- oder FLIP-Vorbereitung.

Erfolgskriterium:

- Studio fühlt sich wie eine echte Arbeitsbühne an.
- Werkzeuge öffnen aus der Foliensteuerung heraus.
- Die Folie bleibt räumlicher Anker.

### Phase 5: Shared-Element-Transitions

Dateien:

- neue kleine Utility möglich: `src/lib/motion.ts`
- betroffene Komponenten nach Bedarf

Aufgaben:

- FLIP für Folienminiatur zu Stage.
- FLIP oder View Transition für Frage-Hotspot zu Drawer.
- Optional: Vorschlagskarte zu Folienänderung.

Erfolgskriterium:

- Mindestens zwei fachliche Objekte bleiben beim Wechsel sichtbar als dasselbe Objekt nachvollziehbar.

## 15. Konkrete Akzeptanzkriterien

Die Anpassung gilt als gelungen, wenn diese Punkte erfüllt sind:

1. Startseite baut Card und Links gestaffelt auf.
2. Login nutzt denselben Aufbau wie Startseite.
3. Learn-Modus baut beim Laden zuerst Folie, dann Inhalte, dann Controls auf.
4. Frage-Drawer öffnet nicht hart, sondern als Sheet von unten.
5. Antwortoptionen erscheinen nacheinander.
6. Evaluation/Chat/Leaderboard öffnen als Inspector-Sheets mit gleichem Timing.
7. Folienwechsel ersetzt Text und Diagramm kontrolliert, ohne ganze Page zu verschieben.
8. Referentenstudio öffnet Tools aus der unteren Steuerung.
9. Popover und Drawer nutzen dieselben Radius-Tokens.
10. Alle Animationen respektieren `prefers-reduced-motion`.
11. Kein dauerhafter Pulse, kein dekorativer Loop, keine Bounce-Animation.
12. Mobile 390 px bleibt ohne horizontalen Overflow.
13. Desktop 1440 px bleibt ohne störenden Page-Scroll in fullscreen-nahen Modi.
14. Playwright-Screenshots prüfen mindestens Learn geschlossen, Learn Frage offen, Learn Evaluation offen, Studio, Studio Tool offen und Mobile.

## 16. Was ausdrücklich nicht gemacht werden soll

- Keine Food-App-Optik übernehmen.
- Keine pinken Produktobjekte, keine Illustration nur wegen des Videos.
- Keine globalen Page-Load-Choreografien über 1 s.
- Keine starken Blur-/Glassmorphism-Flächen.
- Keine Bounce-/Elastic-Eases.
- Keine animierten Layoutgrößen.
- Keine Hotspots, die dauerhaft pulsieren.
- Keine Drawer, die den fachlichen Ursprung verlieren.
- Keine zusätzlichen erklärenden UI-Texte nur wegen Motion.

## 17. Kurzfassung für die Implementierung

LearnBuddy braucht ein kleines Motion-System, kein Redesign der Informationsarchitektur. Die wichtigsten CSS-Werte:

```css
--lb-ease-out: cubic-bezier(0.16, 1, 0.3, 1);
--lb-ease-mask: cubic-bezier(0.22, 1, 0.36, 1);
--lb-dur-press: 120ms;
--lb-dur-control: 220ms;
--lb-dur-row: 260ms;
--lb-dur-panel: 420ms;
--lb-dur-mask: 560ms;
--lb-dur-route: 720ms;
--lb-stagger-row: 52ms;
--lb-radius-control: 8px;
--lb-radius-panel: 12px;
--lb-radius-sheet: 18px;
--lb-radius-cover: 22px;
```

Die wichtigsten Produktentscheidungen:

- Die Folie ist der Anker.
- Bottom-Bar und Tool-Buttons sind Ursprünge für neue Sheets.
- Frage, Quelle, Evaluation und Analytics bauen als fachliche Layer auf.
- Inhalte erscheinen nach Containern.
- Exit ist schneller als Enter.
- Alles bleibt ruhig genug für einen Vorlesungs- und Lernkontext.
