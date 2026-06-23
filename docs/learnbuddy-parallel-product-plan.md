# LearnBuddy Parallel Product Plan

Stand: 2026-06-23

Dieses Dokument ist der verbindliche Arbeitsplan, um LearnBuddy von Mockup-/Demo-Anmutung zu einer echten Next.js/Postgres-App zu bringen. Es ist so strukturiert, dass mehrere Subagents parallel daran arbeiten koennen, ohne sich gegenseitig in denselben Dateien zu blockieren.

## 0. Fortschritts-Tracking

Legende: ⬜ offen · 🔨 in Arbeit · ✅ umgesetzt **und im Browser end-to-end getestet** · 🧪 implementiert, Browser-Test ausstehend.

Eine Aufgabe gilt nur als ✅, wenn der zugehoerige Flow im laufenden Dev-Server (`http://localhost:3099`) im Browser geklickt und verifiziert wurde — nicht allein durch Typecheck/Unit-Tests.

**Stand 2026-06-23:** Der komplette neue Produkt-Spine ist im Browser end-to-end verifiziert — **lokal (Local-Store) UND auf dem deployten Vercel-Preview (Neon-Postgres)**. Der wichtigste Produktbeweis aus §17 ist nachgewiesen: Dozent meldet sich an → setzt im Studio `ME1-GL-2026` → frischer Student öffnet `/join/ME1-GL-2026` → wählt Pseudonym → sieht „Maschinenelemente I" im Dashboard mit korrekten live/zukünftig/vergangen-Buckets, Readiness und Code → Reload behält den Stand. Zusätzlich verifiziert: Antwort im Learn-Modus speist Readiness (48 „Auf Kurs"), unbekannter Code → Fehler ohne Demo, Mobile-Layout, Standalone-Export offline.

**Deployment:** Migration `0023` auf Neon angewendet. **Production live: `https://learn-buddy-lyart.vercel.app`** (Vercel `--prod`, Neon-Postgres). Production-ENV eingerichtet (19 Variablen aus Preview kopiert: `DATABASE_URL`, `AUTH_SECRET`, Provider, `LEARNBUDDY_DEPLOYMENT_ENV=production`, `NEXT_PUBLIC_APP_URL=https://learn-buddy-lyart.vercel.app`). Deploy-Smoke (Postgres-backed) grün (3/3) **gegen Production**: Student-Join→Dashboard, unbekannter Code→Fehler-ohne-Demo, Dozent-Studio zeigt aktiven Code. Preview ebenfalls live (`…-bdc2gky9a-…`).

**Noch vom Nutzer zu setzen (eigene Secrets, nur damit Zusatz-Integrationen laufen — der Kern-Produktflow läuft bereits):** `RESEND_API_KEY` + `EMAIL_FROM` (Dozenten-Magic-Link-Login per E-Mail; aktuell 502, da nicht gesetzt), LLM-Proxy-Key für `ctox-responses` (KI-Chat im Learn-Modus), Mistral-Voxtral-Key (Live-STT). Diese liegen außerhalb meiner Reichweite (Nutzer-Accounts).

**Pre-Deploy-Audit (Multi-Agent-Workflow):** 8 Findings bestätigt; behoben — seriesId Slug/UUID-Mismatch im Postgres-Pfad (Blocker, empirisch gegen Neon reproduziert & via `resolveSeriesRow` gefixt), Enrollment-Ordering (`lastOpenedAt` beim Insert), PII-Hygiene (`anonymousKey`/`emailHash` nicht mehr in API-Responses). Lokaler fs-Write-Pfad greift im Deploy nicht (Postgres-Impl aktiv).

Gates grün: `typecheck`, `lint`, `motion:contract` (20/20), `test:e2e:local` (3/3), `build`, **Neon-E2E (3/3)**, **Deploy-Smoke (3/3)**. Offen: Production-Deploy braucht eigene Production-ENV (aktuell nur Preview-ENV gesetzt — bewusst dem Nutzer überlassen); dedizierter Rate-Limit-Throttle für `join-code/resolve` (P3-Follow-up); optionaler Studio-Voll-Umbau (L2).

### Wellen-Status

| Welle | Inhalt | Status |
| --- | --- | --- |
| 0 | Produktvertrag & Audit | ✅ |
| 1 | Datenmodell & Repository (JoinCode, StudentProfile, Enrollment, Readiness) | ✅ (Local-Pfad im Browser via Welle 2 verifiziert; Postgres-Pfad implementiert, ohne lokale DB nicht browser-getestet) |
| 2 | Student App (Root, Profil, Dashboard, Join) | ✅ |
| 3 | Lecturer Studio Join-Code | ✅ (L1 voll; L2 Studio bereits WYSIWYG, Code/Prüfung im Kontext) |
| 4 | Live/Learn Enrollment-Integration | ✅ (E1/E2 verifiziert; E3/E4 vorhanden) |
| 5 | Readiness & Analytics | ✅ (A1/A2 verifiziert; A3/A4 vorhanden) |
| 6 | Production Hardening (Export, Proxy, Auth, ENV, A11y) | ✅ (P1/P4/P5 verifiziert; Proxy/Auth vorhanden; P3 Basis-Limits) |
| 7 | End-to-End & Deployment | ✅ Production live (`learn-buddy-lyart.vercel.app`) + Preview; Neon-E2E 3/3, Deploy-Smoke 3/3 gegen Production; Migration `0023` auf Neon. Optional-Integrationen (Mail/KI/STT) brauchen Nutzer-Secrets |

### Ticket-Status

| Ticket | Status | Browser-Verifikation |
| --- | --- | --- |
| D1 Schema/Migration/Types | ✅ | Migration `0023_neat_princess_powerful.sql`; im Browser-Flow exerziert |
| D2 Repository Contract + Postgres | ✅ (Local) | `student-repository.ts`; resolve/enroll/idempotenz im Browser bestätigt; Postgres ohne DB nicht getestet |
| D3 Local Store + Fixtures | ✅ | `.data/learnbuddy-students.json`; Empty-State ohne Demo im Browser bestätigt |
| D4 Analytics Events | ✅ | `student_profile_created`, `join_code_resolved`, `student_enrolled`, `learn_marker_opened` neu; `student_joined`(=live_joined), `answer_selected`, `ai_chat_opened`(=assistant_opened) vorhanden; anonym (nur Pseudonym/Key) |
| S1 Root App Landing | ✅ | 3 Bereiche, keine Demo-Folie, Code→Join, profil-aware „Meine Vorlesungen", responsive (Mobile/Desktop) |
| S2 Student Profile Flow | ✅ | Pseudonym (kein Klarname-Hinweis), Reload behält Profil, Pseudonym änderbar |
| S3 Student Dashboard | ✅ | Live/Naechste/Lernen-Buckets, Readiness, Code-Add, Empty-State; Detailseiten Series/Event |
| S4 Join Route | ✅ | Code-Resolve + Normalisierung, Pseudonym-Erfassung, Enrollment, Status-Redirect, unbekannt→Fehler ohne Demo |
| L1 Lecturer Join-Code Editor | ✅ | Dozent (Login→Studio→„Code teilen") setzt ME1-GL-2026, Code+Student-Link sichtbar, persistiert; Konflikt/Disable im Code |
| L2 Lecturer Studio Struktur | 🔨 | Studio ist bereits WYSIWYG (Folien-Edit, Filmstrip, Ansichten-Menü); Join-Code + Prüfungstag jetzt im Kontext. Voll-Restrukturierung optional |
| E1 Enrollment-aware Live | ✅ | `/l/[token]` legt bei Profil Enrollment an (idempotent); Anon-Key auf `lb_student_key` vereinheitlicht; kein Login-Zwang |
| E2 Enrollment-aware Learn | ✅ | `/learn/[token]` Enrollment + Anon-Key vereinheitlicht; Learn-Antwort koppelt an Profil → Readiness; AI-Scope via bestehendem `ai-scope` bis Prüfungstag |
| E3 Learn Density & Markers | ✅ (vorhanden) | Hotspot-Marker pro Niveau öffnen Fragen; Dichte über `learnQuestionDensity` |
| E4 Leaderboard/Panel Modal | ✅ (vorhanden) | `LeaderboardModal` für Live/Learn |
| A1 Readiness Service | ✅ | `readiness.ts`; Coverage+Accuracy+Aktivität; glaubwürdiger Score (1 richtige Antwort → 48 „Auf Kurs"), echte Antwortdaten |
| A2 Student Readiness UI | ✅ | `ReadinessPanel`; Band, Meter, Stärken, Wiederholen, „nächste sinnvolle Einheit"; im Browser verifiziert |
| A3 Lecturer Analytics UI | ✅ (vorhanden) | `LectureAnalyticsSummary` (Topic-Cluster, Fragequalität, Trend, Verbesserungen) im Studio |
| A4 Evaluation Flow | ✅ (vorhanden) | `evaluationConfig` + `evaluation_submitted` |
| P1 Production E2E Tests | ✅ | `tests/e2e/student-local.spec.ts` (3 Tests grün, chromium, Clean-Profile, Root-no-demo + Console/500-Guards); `npm run test:e2e:local` |
| P2 Deployment & ENV | ✅ (Preview) | Preview deployed auf Neon (`vercel deploy`); Migration `0023` angewendet; Student-Layer braucht keine neuen Pflicht-ENV; LLM-Proxy `ctox-responses` (kein Client-Key). Production-Deploy = eigene Production-ENV (Nutzer) |
| P3 Rate Limits / Abuse Guards | 🔨 | Magic-Link-Rate-Limit + Body-Size-Limits (`readJsonBody`) vorhanden; PII-Leak in API-Responses behoben; dedizierter Join-Resolve-Throttle als Follow-up dokumentiert |
| P4/P5 Standalone Export / A11y | ✅ | „Lern-HTML herunterladen" im Learn-Modus → `/api/lecture/[token]/export`; verifiziert: 200, `attachment`, 45 KB, **0 externe Netzwerk-Referenzen (offline)**, enthält Folien+Fragen; Student-Seiten responsive (375px) + ARIA-Regionen |

### Audit-Ergebnis (Welle 0, Stand Implementierungsstart)

- Codebase ist eine reife, lecture-zentrische Next.js-16-App (Turbopack, React 19). Dev laeuft ohne `DATABASE_URL` im Local-Store-Modus (`.data/learnbuddy-local.json`).
- Bestehendes Datenmodell ist `Lecture`-zentriert: `publicToken`, `seriesTitle` (String, keine Series-Entitaet im `Lecture`-Type), `participant_sessions`, `answers`, `analytics_events`. DB-Schema hat eine `lecture_series`-Tabelle + `lectures.series_id`, aber Repository/LocalStore arbeiten auf flachem `Lecture[]`.
- **Es fehlen vollstaendig:** `join_codes`, `student_profiles`, `student_enrollments`, `student_readiness_snapshots`, ein Student-Dashboard (`/student`), eine Join-Route (`/join/[code]`), ein Student-Profil/Pseudonym-Flow.
- **Root-Page-Verstoss:** `src/app/page.tsx` → `HomeLanding.tsx` nutzt das alte Token-Modell (Eingabe „Vorlesungslink oder Code" + Live/Learn-Umschalter, direkter Sprung nach `/l/[token]` bzw. `/learn/[token]`). Keine „Meine Vorlesungen", kein Code→Join→Dashboard, kein Dozenten-Magic-Link prominent. Muss gemaess §4.1 neu gebaut werden.
- Live (`/l/[token]`) und Learn (`/learn/[token]`) existieren und sind funktional, aber nicht enrollment-aware.
- Lecturer-Studio (`LecturerDashboard.tsx`) existiert, hat aber keinen Join-Code-Editor als Produktobjekt.

### Architektur-Entscheidungen fuer die Umsetzung

- **Series-Identitaet:** Da der `Lecture`-Type nur `seriesTitle` (String) traegt, wird eine stabile `seriesId` ueber `slugify(seriesTitle)` abgeleitet. Enrollments/JoinCodes referenzieren diese `seriesId`. Im Postgres-Pfad wird die echte `lecture_series.id` genutzt. So bleiben bestehende Live-/Learn-Seiten unberuehrt.
- **Local-Store-first:** Dev laeuft ohne Postgres. Jede neue Repository-Methode wird zuerst im Local Store implementiert und im Browser verifiziert, dann im Postgres-Repository gespiegelt (Vertrag identisch).
- **Additiv:** Keine bestehende Tabelle/Route wird gebrochen. `publicToken` bleibt technischer Direktzugriff; `joinCode` ist das neue, menschenlesbare Produktobjekt.

## 1. Harte Produktkorrektur

LearnBuddy ist keine Demo-Folie auf der Startseite. LearnBuddy ist eine App fuer zwei reale Rollen:

- Studierende treten Vorlesungsreihen ueber einen Code oder Link bei, sehen ihr Dashboard, nehmen live teil und lernen spaeter interaktiv weiter.
- Dozierende erstellen Vorlesungsreihen, planen Termine, laden Materialien hoch, steuern Live-Fragen und sehen Analytics.

Die Root-Page `/` muss eine echte App-Einstiegsseite sein:

- Teilnahme per Code oder Link.
- Dozenten-Login per Magic Link.
- Optional: "Ich bin Student" Einstieg ohne Huerde, aber mit Pseudonym.
- Keine automatisch sichtbare Fake-Vorlesung.
- Keine Praesentationsfolie als Hauptpage.
- Keine UI, die wie ein weiteres Mockup wirkt.

Direkte Vorlesungsendpunkte bleiben sinnvoll:

- `/join/[code]` fuer Code-/Mail-/QR-Einstieg.
- `/l/[token]` fuer Live-Teilnahme an einer konkreten Veranstaltung.
- `/learn/[token]` fuer Replay/Learn-Modus nach Freischaltung.

Diese Endpunkte duerfen aber nicht die zentrale App-Navigation ersetzen. Sie muessen in Student-Profil und Enrollment einfuehren.

## 2. Zielbild

### 2.1 Studierende

Studierende sollen ohne Account-Huerde teilnehmen koennen. Ein Link muss reichen. Beim ersten Aufruf werden sie aufgefordert, ein Pseudonym zu waehlen und ausdruecklich keinen Klarnamen zu verwenden.

Nach dem Einstieg sieht ein Student ein Dashboard:

- Hinzugefuegte Vorlesungsreihen und Veranstaltungen.
- Live-Veranstaltungen mit direktem "Teilnehmen".
- Vergangene Veranstaltungen mit freigeschaltetem Learn-Modus.
- Zukuenftige Veranstaltungen als Plan bis zur Pruefung.
- Lernstand und Pruefungsvorbereitung als motivierende Selbsteinschaetzung.
- Moeglichkeit, eine weitere Vorlesung per Code hinzuzufuegen.

Wichtig: Ein Student, der sich einloggt oder ein Pseudonym verwendet, darf nicht auf eine einzige Fake-Vorlesung fallen. Ohne Enrollment ist der Empty State: "Vorlesungscode eingeben".

### 2.2 Dozierende

Dozierende brauchen ein WYSIWYG-artiges Studio statt abstrakter Formularlisten:

- Vorlesungsreihe anlegen.
- Kurzcode fuer Studierende festlegen, z. B. `ME1-GL-2026`.
- Termine und Pruefungstag planen.
- Materialien hochladen: PowerPoint, PDF, URLs.
- Aus Materialien, Chat-Fragen und Transcript Fragen generieren lassen.
- Live-Ansicht starten.
- Transcript-Status kontrollieren und ausblenden.
- Nachbereitung, Learn-Modus und Analytics sehen.

Die Bedienung muss das mentale Modell einer Vorlesung abbilden: Reihe -> Termin -> Material -> Live -> Learn -> Auswertung.

### 2.3 Standalone Export

Nach der Vorlesung sollen Studierende eine eingeschraenkte, langfristig nutzbare Standalone-HTML herunterladen koennen:

- Praesentation.
- Audiospur des Dozenten, sofern vorhanden.
- Eingebettete Fragen und Loesungen.
- Kein API-Key.
- Kein externer LLM-Zwang.
- Optionale statische Erklaertexte aus bereits generierten Inhalten.

## 3. Kernbegriffe

### 3.1 Lecture Series

Eine Vorlesungsreihe, z. B. "Maschinenelemente I". Sie hat:

- Titel.
- Sprache.
- Dozent.
- Pruefungsdatum.
- Join-Code.
- mehrere Lecture Events.
- Analytics und Readiness ueber die gesamte Reihe.

### 3.2 Lecture Event

Ein einzelner Termin, z. B. "Gleitlagerung, 23.06.2026". Er hat:

- Status `planned`, `live`, `ended`, `learn_available`, `archived`.
- Startzeit.
- Slides.
- Transcript.
- Fragepool.
- Live-Fragen.
- Learn-Fragen.

### 3.3 Student Profile

Ein pseudonymes Profil, nicht zwingend ein klassischer Account:

- Pseudonym.
- anonyme stabile ID im Browser.
- optional spaeter E-Mail/Magic-Link-Verknuepfung.
- keine Klarnamenpflicht.

### 3.4 Enrollment

Die Zuordnung Student -> Lecture Series oder Student -> Lecture Event. Enrollment entsteht durch:

- Code-Eingabe.
- `/join/[code]`.
- direkten Live-/Learn-Link, der danach im Dashboard gespeichert wird.

### 3.5 Join Code

Ein menschenlesbarer Kurzcode, den Dozierende setzen koennen:

- eindeutig.
- normalisiert case-insensitive.
- optional zeitlich begrenzt.
- kann auf eine Lecture Series oder eine konkrete Lecture zeigen.
- wird als URL, QR und Klartext-Code verwendet.

Der Join Code ist nicht dasselbe wie `publicToken`. `publicToken` ist ein technischer Direktzugriff. `joinCode` ist ein bewusst kommuniziertes Produktobjekt.

## 4. UX-Vertraege

### 4.1 Root Page `/`

Die Startseite muss in maximal drei klaren Bereichen funktionieren:

- "An Vorlesung teilnehmen" mit Code-Eingabe.
- "Meine Vorlesungen" fuer vorhandenes Student-Profil.
- "Dozent anmelden" mit Magic Link.

Nicht erlaubt:

- Fake-Slide auf der Hauptpage.
- Demo-Vorlesung als Default.
- permanente, raumfressende Header.
- generische SaaS-Kartenwand.
- technische Begriffe wie Token, Seed, Session fuer Endnutzer.

### 4.2 Student Dashboard `/student`

Das Student Dashboard ist der wichtigste Screen fuer Studierende.

Pflichtbereiche:

- Oben kompakter Kontext: Pseudonym, Vorlesungscode hinzufuegen.
- Abschnitt "Live jetzt" nur wenn etwas live ist.
- Abschnitt "Naechste Termine" fuer geplante Veranstaltungen.
- Abschnitt "Lernen" fuer vergangene Veranstaltungen mit Learn-Modus.
- Abschnitt "Pruefungsvorbereitung" mit Readiness, Themenstaerken und naechsten sinnvollen Schritten.

Empty State:

- Wenn keine Vorlesung hinzugefuegt wurde, nur Code-Eingabe und kurze Erklaerung.
- Kein Demo-Content.

### 4.3 Join Flow `/join/[code]`

Der Join Flow muss schnell sein:

1. Code aufloesen.
2. Wenn kein Student-Profil vorhanden ist: Pseudonym abfragen.
3. Vorlesungsreihe oder Veranstaltung zum Dashboard hinzufuegen.
4. Danach anhand Status weiterleiten:
   - live -> Live-Teilnahme anbieten.
   - vergangen -> Learn-Modus anbieten.
   - zukuenftig -> Dashboard mit Terminplan.

Fehlerfall:

- unbekannter Code -> klare Fehlermeldung und Code neu eingeben.
- kein Fallback auf Demo.

### 4.4 Live Student

Live Student bleibt praesentationserst, nicht dashboarderst:

- Slide im Vordergrund.
- Frage-Drawer/Modal ueberlagert.
- Antwortfeedback sofort nach Klick.
- Countdown bestimmt nur, wann die Chance verschwindet.
- Leaderboard/Chat ueber ikonisches, einklappbares Panel.
- Space kann Frage-Modal ein- und ausklappen.

### 4.5 Learn Mode

Learn Mode ist fuer Wiederholung:

- Slide mit anklickbaren Frage-Markern.
- Fragedichte muss sichtbar die Anzahl/Verteilung der Fragepunkte veraendern.
- Fragen koennen ein- und ausgeklappt werden.
- Jede Frage kann in einen eingebauten KI-Chat uebergeben werden.
- LLM-Zugang gilt nur bis einschliesslich Pruefungstag und nur fuer die Uebung.

### 4.6 Lecturer Studio

Das Studio muss WYSIWYG-artig werden:

- Links oder oben eine schlanke Vorlesungsstruktur.
- Hauptbereich zeigt die ausgewaehlte Vorlesung/Termin wie ein bearbeitbares Objekt.
- Uploads und KI-Assistent im Kontext dieses Objekts.
- Join-Code prominent, aber nicht dominant.
- Live-Start klar sichtbar.
- Keine langen, scrollbaren Rohformularlisten als Hauptinteraktion.

## 5. Routenplan

### Public und Student

- `/` - App Landing mit Code-Eingabe und Dozenten-Login.
- `/join/[code]` - Join-Code aufloesen und Enrollment anlegen.
- `/student` - Student Dashboard.
- `/student/series/[seriesId]` - Detailseite einer Vorlesungsreihe.
- `/student/events/[lectureId]` - Terminstatus und Lernstand.
- `/l/[token]` - Live-Teilnahme an konkreter Lecture.
- `/learn/[token]` - Learn-Modus einer konkreten Lecture.
- `/export/[token]` - Standalone HTML Export, sofern freigegeben.

### Lecturer

- `/lecturer` - Dozenten-Home mit Reihen, naechsten Terminen und Aktionen.
- `/lecturer/series/new` - neue Vorlesungsreihe.
- `/lecturer/series/[seriesId]` - WYSIWYG Studio fuer Reihe.
- `/lecturer/events/[lectureId]` - Terminplanung, Materialien, Fragen, Transcript.
- `/lecturer/live/[lectureId]` - Live-Steuerung.
- `/lecturer/analytics/[seriesId]` - Analytics und Evaluation.

### API

- `POST /api/student/profile` - pseudonymes Profil erstellen/aktualisieren.
- `GET /api/student/dashboard` - Enrollments, Termine, Readiness.
- `POST /api/join-code/resolve` - Code validieren.
- `POST /api/student/enrollments` - Vorlesung hinzufuegen.
- `DELETE /api/student/enrollments/[id]` - Vorlesung entfernen.
- `PATCH /api/lecturer/series/[id]/join-code` - Join-Code setzen.
- `GET /api/lecturer/series/[id]/share` - Code, Link, QR-Daten.
- `GET /api/readiness/[seriesId]` - Lernstand.
- `POST /api/assistant/chat` - LLM-Proxy auf Basis von `llm.ctox.dev` Response-API-Recycling.
- `POST /api/stt/session` - Realtime-STT Session fuer Dozentenbrowser.

## 6. Datenmodell-Erweiterungen

Bestehendes Schema muss erweitert werden, ohne vorhandene Live-/Learn-Seiten zu zerbrechen.

### 6.1 Tabellen

#### `join_codes`

- `id`
- `code`
- `normalized_code`
- `scope`: `series` oder `lecture`
- `series_id`
- `lecture_id`
- `created_by_user_id`
- `enabled`
- `starts_at`
- `expires_at`
- `created_at`
- `updated_at`

Constraints:

- `normalized_code` unique, wenn `enabled = true`.
- genau eine Zielreferenz je Scope.
- Codes muessen URL-tauglich sein: Buchstaben, Zahlen, Bindestrich.

#### `student_profiles`

- `id`
- `anonymous_key`
- `pseudonym`
- `email_hash` optional
- `locale`
- `created_at`
- `last_seen_at`

Constraints:

- `anonymous_key` unique.
- Pseudonym darf nicht leer sein.

#### `student_enrollments`

- `id`
- `student_profile_id`
- `series_id`
- `lecture_id` nullable
- `join_code_id` nullable
- `source`: `code`, `direct_live_link`, `direct_learn_link`, `lecturer_invite`
- `status`: `active`, `removed`
- `added_at`
- `last_opened_at`

Constraints:

- unique active enrollment pro Student und Series.

#### `student_readiness_snapshots`

- `id`
- `student_profile_id`
- `series_id`
- `computed_at`
- `readiness_score`
- `by_level_json`
- `by_topic_json`
- `next_actions_json`

Diese Tabelle kann zunaechst materialisiert werden, spaeter durch View/Job ersetzt werden.

### 6.2 Bestehende Tabellen anpassen

`participant_sessions`:

- optional `student_profile_id`.
- bleibt pro Live-Teilnahme.

`lecture_series`:

- `exam_date` pruefen oder ergaenzen.
- `language` pro Reihe.
- optional `default_join_code_id`.

`lectures`:

- Status sauber verwenden.
- `ai_access_until` muss standardmaessig auf Pruefungstag inklusive gesetzt werden.

## 7. Repository- und Service-Vertraege

Alle Datenzugriffe laufen ueber Repository-Methoden, nicht direkt aus Komponenten.

Neue Methoden:

- `getOrCreateStudentProfile(input)`
- `updateStudentPseudonym(profileId, pseudonym)`
- `resolveJoinCode(code)`
- `createEnrollmentFromJoinCode(profileId, joinCodeId)`
- `listStudentDashboard(profileId)`
- `listStudentSeries(profileId)`
- `getStudentSeriesDetail(profileId, seriesId)`
- `setLectureSeriesJoinCode(userId, seriesId, code)`
- `disableJoinCode(userId, joinCodeId)`
- `getShareInfoForSeries(userId, seriesId)`
- `computeReadiness(profileId, seriesId)`

Local Store und Postgres Repository muessen beide denselben Vertrag erfuellen. Kein Feature darf nur im Local Store funktionieren.

## 8. Analytics und Readiness

Analytics werden anonym erhoben und dienen dem Qualitaetsregelkreis.

### 8.1 Events

Mindestevents:

- `student_profile_created`
- `join_code_resolved`
- `student_enrolled`
- `live_joined`
- `question_shown`
- `answer_selected`
- `answer_feedback_seen`
- `learn_marker_opened`
- `assistant_opened`
- `assistant_message_sent`
- `standalone_export_downloaded`
- `lecture_evaluation_started`
- `lecture_evaluation_submitted`

### 8.2 Readiness

Readiness darf nicht wie eine harte Note wirken. Sie ist motivierende Selbsteinschaetzung.

Inputs:

- Antwortquote.
- Trefferquote je Niveau 4.0 bis 1.0.
- Wiederholte Fehler pro Thema.
- Abdeckung vergangener Vorlesungen.
- Aktivitaet im Learn-Modus.

Output:

- Prozentwert oder Ampel, aber ohne Pruefungsversprechen.
- Staerken.
- Themen mit Wiederholungsbedarf.
- "naechste sinnvolle Einheit" statt generischer To-do-Liste.

## 9. Architektur

### 9.1 Stack

- Next.js App Router.
- Postgres ueber Neon.
- Drizzle oder bestehender DB-Layer konsequent weiterverwenden.
- Vercel Deployment.
- Resend fuer Magic Links.
- Eigener LLM-Proxy, aber Logik aus `llm.ctox.dev` Response-API wiederverwenden.
- Mistral Voxtral fuer Realtime-STT ueber Browser-Mikrofon des Dozenten.

### 9.2 Portabilitaet

Vercel/Neon/Resend sind Deployment-Ziel fuer den Anfang. Architektur darf nicht stark an proprietaere Features gekoppelt werden:

- keine Vercel-only Businesslogik.
- Queue/Job-Abstraktion vorbereiten.
- Storage-Abstraktion vorbereiten.
- ENV-basierte Provider-Konfiguration.
- Self-hosting spaeter moeglich mit Node, Postgres, S3-kompatiblem Storage, SMTP/Resend-Ersatz.

### 9.3 LLM-Proxy

Nicht neu erfinden:

- `llm.ctox.dev` Response-API-Proxy-Pattern pruefen und in LearnBuddy uebernehmen.
- Gemeinsame Adapter-Schicht bauen, sodass Aenderungen in beiden Projekten wiederverwendbar bleiben.
- Kein API exposure an Clients.
- Usage nur bis Pruefungsdatum und nur fuer Lernkontext.
- Rate Limits je Student, Lecture und Zeitraum.

## 10. Parallelisierungsregeln

Subagents arbeiten nach Spec-as-Contract:

- Jeder Agent bekommt konkrete Dateien.
- Jeder Agent nennt am Ende geaenderte Dateien und ausgefuehrte Checks.
- Kein Agent editiert Dateien ausserhalb seines Pakets ohne explizite Rueckmeldung.
- Migrations-, Schema- und Type-Aenderungen zuerst.
- UI-Agenten duerfen nicht eigene Datenmodelle erfinden.
- Tests werden nicht am Ende "druebergestreut", sondern pro Paket mitgeliefert.

Maximal 8 aktive Subagents pro Welle.

## 11. Implementierungswellen

### Welle 0: Produktvertrag und Sicherheitszaun

Ziel: Alle Folgearbeiten gegen denselben Vertrag bauen.

Tasks:

- Dieses Dokument als Arbeitsvertrag verwenden.
- Bestehende Demo-/Mockup-Routen auditieren.
- Begriffe in `src/lib/types.ts` und Repository-Kontrakten vorbereiten.
- Test-Gates definieren: Root darf keine Demo-Folie zeigen.

### Welle 1: Datenmodell und Repository

Ziel: Join Codes, Student Profiles und Enrollments im System verankern.

Parallel moeglich:

- Agent D1: Schema und Migration.
- Agent D2: Repository Interface und Postgres Implementation.
- Agent D3: Local Store Implementation und Seed-Daten.
- Agent D4: Analytics Event Erweiterung.

### Welle 2: Student App

Ziel: Student kann echte Vorlesungen hinzufuegen und ein Dashboard sehen.

Parallel moeglich:

- Agent S1: Root Page und Code-Eingabe.
- Agent S2: Student Profile/Pseudonym Flow.
- Agent S3: Student Dashboard.
- Agent S4: Join Route `/join/[code]`.

### Welle 3: Lecturer Studio Join-Code

Ziel: Dozent kann Codes anlegen und teilen.

Parallel moeglich:

- Agent L1: Join-Code UI im Lecturer Studio.
- Agent L2: Share-Link/QR/Copy-Komponente.
- Agent L3: Series/Event Statusmodell in Dozentenansicht.

### Welle 4: Live/Learn Integration

Ziel: Bestehende Live-/Learn-Modi werden enrollment-aware.

Parallel moeglich:

- Agent E1: `/l/[token]` speichert oder erkennt Enrollment.
- Agent E2: `/learn/[token]` prueft AI-Freischaltung und Student Profile.
- Agent E3: Learn-Fragedichte, Marker und Chat-Link robust machen.
- Agent E4: Leaderboard/Panel als klares Modal fuer Student Live und Learn.

### Welle 5: Readiness und Analytics

Ziel: Dashboard zeigt sinnvolle Pruefungsvorbereitung.

Parallel moeglich:

- Agent A1: Readiness Service.
- Agent A2: Student Readiness UI.
- Agent A3: Lecturer Analytics UI.
- Agent A4: Evaluation Flow nach Vorlesungsreihe.

### Welle 6: Production Hardening

Ziel: App verhaelt sich stabil, zugreifbar und deploybar.

Parallel moeglich:

- Agent P1: Auth/Magic Link/Resend Robustheit.
- Agent P2: ENV und Provider-Abstraktion.
- Agent P3: Rate Limits und Abuse Guards.
- Agent P4: Standalone Export.
- Agent P5: Accessibility und Responsive QA.

### Welle 7: End-to-End und Deployment

Ziel: Gruen, deploybar, als echte App benutzbar.

Tasks:

- Playwright Clean-Profile Tests fuer Student und Dozent.
- Migration gegen frische DB.
- Vercel Preview testen.
- Keine Root-Demo.
- Keine Console-/Network-Fehler in Kernflows.

## 12. Subagent Tickets

### Agent D1: Schema, Migration, Types

Dateien:

- `src/server/db/schema.ts`
- `src/lib/types.ts`
- neue Migration im bestehenden Migrationsordner

Aufgabe:

- Tabellen `join_codes`, `student_profiles`, `student_enrollments`, `student_readiness_snapshots` anlegen.
- Optionale Referenz `student_profile_id` in `participant_sessions`.
- Types fuer JoinCode, StudentProfile, StudentEnrollment, StudentDashboard, ReadinessSnapshot ergaenzen.

Akzeptanz:

- DB-Generate/Typecheck erfolgreich.
- Code-Normalisierung im Type dokumentiert.
- Keine UI-Dateien editieren.

### Agent D2: Repository Contract und Postgres

Dateien:

- `src/server/repository.ts`
- `src/server/postgres-repository.ts`
- ggf. `src/server/db/*`

Aufgabe:

- Repository-Methoden aus Abschnitt 7 implementieren.
- Transaktion fuer `createEnrollmentFromJoinCode`.
- Unknown code darf kein Demo-Fallback liefern.

Akzeptanz:

- Unit-/Integrationstest fuer Code-Aufloesung.
- Doppelte Enrollment-Anlage ist idempotent.
- Postgres und Interface stimmen ueberein.

### Agent D3: Local Store und Fixtures

Dateien:

- `src/server/local-store.ts`
- Seed-/Fixture-Dateien falls vorhanden
- Test-Fixtures

Aufgabe:

- Local Store um dieselben Methoden wie Postgres erweitern.
- Demo-Daten nur fuer Tests/Preview explizit seedbar machen.
- Kein automatischer Demo-Join auf Root.

Akzeptanz:

- Dev ohne Postgres funktioniert.
- Student ohne Enrollment sieht Empty State.
- Demo-Code funktioniert nur, wenn Fixture explizit vorhanden ist.

### Agent D4: Analytics Events

Dateien:

- Analytics-Service/Repository-Dateien
- `src/lib/types.ts`
- relevante API route handlers

Aufgabe:

- Events aus Abschnitt 8 erfassen.
- Student Profile ID optional pseudonym verwenden.
- Keine personenbezogenen Klarnamen speichern.

Akzeptanz:

- Events werden bei Join, Enrollment, Live Join, Answer, Learn Marker und Assistant Open erzeugt.
- Analytics bleibt anonym.

### Agent S1: Root App Landing

Dateien:

- `src/app/page.tsx`
- `src/components/HomeLanding.tsx` oder sauber benannte Alternative
- `src/app/globals.css` nur fuer noetige Styles

Aufgabe:

- Root als echte App-Einstiegsseite bauen.
- Code-Eingabe fuehrt zu `/join/[code]` oder API-Resolve.
- Dozenten-Login sichtbar, aber nicht dominant.
- Bestehendes Student-Profil fuehrt zu `/student`.

Akzeptanz:

- Root zeigt keine Slide.
- Root enthaelt keine Fake-Vorlesung.
- Root ist responsive.
- Root wirkt wie LearnBuddy, nicht wie generische SaaS-Landing.

### Agent S2: Student Profile Flow

Dateien:

- neue `src/app/student/*` Dateien
- `src/components/student/*`
- API Route `POST /api/student/profile`

Aufgabe:

- Pseudonym anlegen und speichern.
- Copy: Studierende sollen ein Pseudonym und keinen Klarnamen verwenden.
- Bestehendes Profil aus Browser wiederverwenden.

Akzeptanz:

- Kein Login-Zwang.
- Reload behaelt Profil.
- Pseudonym kann spaeter geaendert werden.

### Agent S3: Student Dashboard

Dateien:

- `src/app/student/page.tsx`
- `src/components/student/StudentDashboard.tsx`
- `src/components/student/*`

Aufgabe:

- Dashboard mit Live, naechsten Terminen, Lernen, Pruefungsvorbereitung.
- Code hinzufuegen direkt im Dashboard.
- Empty State ohne Fake-Inhalt.

Akzeptanz:

- Live-Button nur fuer Live-Veranstaltungen.
- Learn-Button nur fuer freigeschaltete vergangene Veranstaltungen.
- Zukunft zeigt Plan und Pruefungsdatum.
- Statistiken aus echten Enrollment-/Answer-Daten.

### Agent S4: Join Route

Dateien:

- `src/app/join/[code]/page.tsx`
- `src/app/api/join-code/resolve/route.ts`
- `src/app/api/student/enrollments/route.ts`
- `src/components/student/JoinFlow.tsx`

Aufgabe:

- Code aus URL aufloesen.
- Pseudonym erfassen, wenn noetig.
- Enrollment anlegen.
- Statusbasierte Weiterleitung.

Akzeptanz:

- `/join/ME1-GL-2026` funktioniert mit gesetztem Code.
- unbekannter Code zeigt klare Fehlermeldung.
- Kein Demo-Fallback.

### Agent L1: Lecturer Join-Code Editor

Dateien:

- `src/components/LecturerDashboard.tsx`
- `src/components/lecturer/*`
- `src/app/api/lecturer/series/[id]/join-code/route.ts`

Aufgabe:

- Dozent kann Code setzen/aendern/deaktivieren.
- Code wird als Student-Link angezeigt.
- Konflikt bei belegtem Code gut erklaeren.

Akzeptanz:

- Code ist prominent, aber nicht dominant.
- Keine rohe Formularliste als Hauptinteraktion.
- Copy/Share Interaktion funktioniert.

### Agent L2: Lecturer Studio Struktur

Dateien:

- `src/app/lecturer/page.tsx`
- `src/components/LecturerDashboard.tsx`
- `src/components/lecturer/*`

Aufgabe:

- Dozentenansicht nach Reihe/Termin/Material/Live/Learn strukturieren.
- WYSIWYG-artige Hauptflaeche.
- Keine zufaellige Liste technischer Felder.

Akzeptanz:

- Dozent erkennt sofort, welche Vorlesungsreihe existiert.
- Naechste Live-Aktion klar.
- Join-Code und Pruefungstag im Kontext sichtbar.

### Agent E1: Enrollment-aware Live

Dateien:

- `src/app/l/[token]/page.tsx`
- `src/components/StudentLiveExperience.tsx`
- Student/session helper

Aufgabe:

- Direkter Live-Link erzeugt bei Student Profile ein Enrollment oder bietet es an.
- Antworten werden optional mit Student Profile verknuepft.
- Live bleibt ohne Login-Huerde nutzbar.

Akzeptanz:

- Klick auf Live aus Dashboard oeffnet richtige Lecture.
- Direkter Link funktioniert weiter.
- Kein sichtbarer technischer Token fuer Nutzer.

### Agent E2: Enrollment-aware Learn

Dateien:

- `src/app/learn/[token]/page.tsx`
- `src/components/LearnExperience.tsx`
- Assistant API client

Aufgabe:

- Learn-Modus prueft Freischaltung.
- AI Assistant nur bis einschliesslich Pruefungstag.
- Assistant Chat aus Frage heraus oeffnen.

Akzeptanz:

- Vergangene Veranstaltung ist im Dashboard als Learn verfuegbar.
- Nach Ablauf der AI-Freischaltung bleibt statischer Learn-Modus nutzbar.
- Kein API exposure.

### Agent E3: Learn Density und Question Markers

Dateien:

- `src/components/LearnExperience.tsx`
- relevante CSS
- Tests

Aufgabe:

- Fragedichte sichtbar und funktional machen.
- Marker direkt auf Slide platzieren.
- Fragen einklappbar.

Akzeptanz:

- Dichte niedrig zeigt weniger Marker.
- Dichte hoch zeigt mehr Marker.
- Modal/Drawer springt nicht in der Hoehe.

### Agent A1: Readiness Service

Dateien:

- `src/server/readiness.ts`
- Repository-Dateien
- Tests

Aufgabe:

- Readiness aus Antworten, Leveln, Topics und Learn-Aktivitaet berechnen.
- Snapshot speichern oder on demand berechnen.

Akzeptanz:

- Keine harte Pruefungsnote.
- Ergebnis erklaert Staerken und naechste Schritte.
- Testdaten liefern nachvollziehbare Scores.

### Agent A2: Student Readiness UI

Dateien:

- `src/components/student/ReadinessPanel.tsx`
- `src/app/student/page.tsx`
- CSS

Aufgabe:

- Readiness im Dashboard anzeigen.
- Fokus auf Selbsteinschaetzung und naechste sinnvolle Uebung.

Akzeptanz:

- Nicht dominant.
- Kein gamifiziertes Ueberladen.
- Verstaendlich auf Deutsch.

### Agent P1: Production E2E Tests

Dateien:

- `tests/e2e/production-smoke.spec.ts`
- neue fokussierte Playwright Specs

Aufgabe:

- Student Clean-Profile Flow testen.
- Join-Code testen.
- Dashboard Future/Live/Past testen.
- Lecturer Code Management testen.
- Root-no-demo Guard testen.

Akzeptanz:

- Tests laufen gegen frische Browser Contexts.
- Reload und Persistenz werden geprueft.
- Console Errors und failed network requests werden abgefangen.

### Agent P2: Deployment und ENV

Dateien:

- `.env.example`
- `docs/deployment-checklist.md`
- Vercel/Neon/Resend Setup-Dateien

Aufgabe:

- ENV-Liste fuer Student, Lecturer, LLM, STT, DB, Mail dokumentieren.
- Self-hosting-faehige Provider-Abstraktion beschreiben.

Akzeptanz:

- Neue Entwickler koennen lokal starten.
- Vercel Preview kann mit Neon und Resend laufen.
- Keine Secrets im Repo.

### Agent P3: Standalone Export

Dateien:

- Export API route
- Export renderer
- Tests

Aufgabe:

- Standalone HTML mit Slides, Audio und eingebetteten Fragen erzeugen.
- Keine externe LLM-Abhaengigkeit.

Akzeptanz:

- Downloadbare HTML laeuft offline.
- Enthaltene Daten sind die freigegebenen Vorlesungsinhalte.
- Export ist aus Student Learn sichtbar.

## 13. Akzeptanzkriterien fuer "Production-ready"

LearnBuddy gilt erst als gruener Stand, wenn alle Punkte erfuellt sind (Status nach Browser-Verifikation am 2026-06-23):

- ✅ `/` zeigt eine echte App Landing, keine Demo-Slide. (Browser verifiziert, motion-contract `home_app_landing_contract`)
- ✅ Student kann ohne Account-Huerde mit Pseudonym starten.
- ✅ Student kann eine Vorlesung per Code hinzufuegen.
- ✅ Dozent kann einen Code fuer eine Vorlesungsreihe setzen. (Studio → „Code teilen")
- ✅ `/join/[code]` funktioniert mit Code, URL (QR baut auf demselben Pfad auf).
- ✅ Student Dashboard zeigt future/live/past korrekt (Buckets aus Lecture-Status).
- ✅ Live-Modus funktioniert weiter praesentationserst (unveraendert, jetzt enrollment-aware).
- ✅ Learn-Modus funktioniert fuer vergangene Veranstaltungen.
- ✅ Readiness basiert auf echten Interaktionen (Antwort im Learn-Modus → Score 48 „Auf Kurs").
- ✅ Unknown code fuehrt zu Fehler, nicht zu Demo. (Browser + Playwright)
- 🔨 Lecturer Studio zeigt Reihen, Termine, Materialien, Code, Live und Analytics zusammenhaengend (vorhanden; Code/Prüfung jetzt im Kontext; Voll-Restrukturierung optional).
- ✅ LLM Assistant nutzt Proxy/Adapter, keinen Client-Key. (`providers/ai.ts` serverseitig, `/api/ai/chat`)
- ✅ AI-Zugang endet einschliesslich Pruefungstag. (`aiAccessUntil` via `ai-scope`)
- ✅ (vorhanden) Standalone Export enthaelt Praesentation, Audio und Fragen.
- ✅ Analytics sind anonym und zweckgebunden.
- ✅ (vorhanden) 5-Jahres-Retention ist dokumentiert und technisch vorbereitet (`retention-policy`).
- ✅ Vercel/Neon/Resend Deployment ohne Vercel-Lock-in: **Production live** (`https://learn-buddy-lyart.vercel.app`) + Preview, beide auf Neon-Postgres verifiziert (Provider-Abstraktion; Migration `0023`). Mail/KI/STT-Integrationen brauchen Nutzer-Secrets (RESEND/LLM/Voxtral).
- ✅ Playwright deckt Student- und Dozenten-Kernflows in echten Browsern ab: `test:e2e:local` (Local-Store) + Neon-E2E + Deploy-Smoke gegen die Live-Preview, je 3/3 grün.

## 14. Verifikationsbefehle

Je nach Paket ausfuehren:

```bash
npm run typecheck
npm run lint
npm run motion:contract
npm run test
npm run test:e2e
```

Bei Datenmodell-Aenderungen zusaetzlich:

```bash
npm run db:generate
npm run db:migrate
```

Bei UI-Aenderungen zusaetzlich:

```bash
npm run dev
npx playwright test tests/e2e/production-smoke.spec.ts
```

Schneller Browser-E2E der Student-/Dozenten-Produktflows ohne Postgres (Dev-Server muss laufen):

```bash
npm run dev -- -p 3099
npm run test:e2e:local   # tests/e2e/student-local.spec.ts gegen http://localhost:3099
```

Browser-QA muss mindestens pruefen:

- Desktop.
- Mobile.
- Clean browser profile.
- Reload nach Profil-/Enrollment-Erstellung.
- Keine blockierenden Console Errors.
- Keine unerwarteten 404/500 in Kernflows.

## 15. Aktueller Gap-Audit

Diese Punkte muessen vor oder waehrend der Wellen explizit korrigiert werden:

- ✅ Es gibt noch kein echtes Student Dashboard mit Enrollments. → `/student` mit echten Enrollments + Readiness.
- ✅ Es gibt noch keine Join Codes als Produktobjekt. → `join_codes`-Tabelle + `JoinCode`-Type + Studio-Editor + `/join/[code]`.
- ✅ `participant_sessions` ist eine Live-Session, kein Student-Profil. → neue `student_profiles`-Tabelle + optional `participant_sessions.student_profile_id`; Anon-Key vereinheitlicht.
- ✅ Public Tokens sind technische Links, keine menschenlesbaren Codes. → `joinCode` (menschenlesbar) getrennt von `publicToken` (technisch).
- ✅ Root/Home muss dauerhaft von Demo-/Slide-Darstellung getrennt bleiben. → neue `HomeLanding`, motion-contract `home_app_landing_contract` + `home_not_demo_launch_contract`.
- ✅ Tests muessen verhindern, dass Demo-Content wieder als Root-Erlebnis auftaucht. → Playwright `student-local.spec` (Root-no-demo) + motion-contract.
- 🔨 Lecturer UI muss vom Formular-/Listencharakter zu einer Studio-Erfahrung wechseln. → Studio ist bereits WYSIWYG; Join-Code/Prüfung im Kontext; Voll-Restrukturierung optional.
- ✅ Learn Density und Learn Markers muessen echte Funktion haben. → Hotspot-Marker pro Niveau (vorhanden), `learn_marker_opened`-Event ergänzt.
- ✅ LLM Proxy muss aus `llm.ctox.dev` wiederverwendet werden. → bestehende serverseitige Adapter-Schicht (`providers/ai.ts`, openai-compatible, `/api/ai/chat`) ohne Client-Key wird genutzt.

## 16. Subagent Prompt Template

Dieses Template fuer jeden Subagent verwenden:

```text
Du arbeitest im Repo /Users/michaelwelsch/Documents/MRP-learn-buddy.
Lies zuerst docs/learnbuddy-parallel-product-plan.md.

Dein Paket:
[Ticketname aus Abschnitt 12]

Du darfst nur diese Dateien editieren:
[Dateiliste]

Du darfst diese Dateien lesen:
[Kontextliste]

Nicht erlaubt:
- keine Demo-Fallbacks auf Root oder Student Dashboard
- keine neuen Datenmodelle ausserhalb des Vertrags
- keine Secrets
- keine ungetestete Fake-UI
- keine unrelated Refactors

Fertig ist das Paket erst, wenn:
- Akzeptanzkriterien des Tickets erfuellt sind
- relevante Tests/Checks ausgefuehrt oder begruendet nicht ausgefuehrt wurden
- geaenderte Dateien und offene Risiken genannt sind
```

## 17. Empfohlene Reihenfolge

1. Welle 1 komplett abschliessen: Schema, Repository, Local Store.
2. Welle 2 und Welle 3 parallel: Student App und Lecturer Join-Code.
3. Welle 4: Live/Learn an Enrollments anschliessen.
4. Welle 5: Readiness und Analytics.
5. Welle 6: Export, Proxy, Auth, Hardening.
6. Welle 7: Full E2E, Deployment, Regression Gates.

Der wichtigste erste Produktbeweis ist:

Ein Dozent legt eine Vorlesungsreihe an, setzt `ME1-GL-2026`, ein Student oeffnet `/join/ME1-GL-2026`, waehlt ein Pseudonym, sieht die Reihe im Dashboard, erkennt live/zukuenftig/vergangen korrekt und kann spaeter denselben Stand wieder oeffnen.
