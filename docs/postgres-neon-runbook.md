# LearnBuddy Postgres/Neon Runbook

Stand: 19. Juni 2026

Dieses Runbook beschreibt den aktuellen Datenbankpfad für Vercel/Neon und die lokale Postgres-kompatible Entwicklung. Ziel ist Provider-Portabilität: Neon ist der primäre Managed-Postgres-Anbieter, aber der Code erwartet nur eine normale Postgres-Connection über `DATABASE_URL`.

## Repository-Auswahl

Die App wählt das Repository serverseitig:

- Mit `DATABASE_URL`: Drizzle/Postgres-Repository.
- Ohne `DATABASE_URL`: lokaler JSON-Store in `.data/learnbuddy-local.json`.
- Mit `LEARNBUDDY_REPOSITORY=local`: JSON-Store erzwingen, auch wenn `DATABASE_URL` gesetzt ist.

Damit bleiben lokale UI-Prototypen leichtgewichtig, während Preview/Production über dieselbe Repository-Schnittstelle mit Postgres laufen.

## Demo-Seed und Admin-CLI

Produktions- und Preview-Umgebungen sollen Demo-Daten nicht implizit über normale Requests erzeugen. Die App seeded die Demo-Vorlesung nur automatisch, wenn `LEARNBUDDY_AUTO_SEED=1|true|yes` gesetzt ist; ohne explizite Einstellung bleibt Auto-Seed nur in `NODE_ENV !== "production"` aktiv.

Für reproduzierbare Postgres-Setups gibt es ein separates CLI:

```bash
DATABASE_URL="postgres://..." npm run admin -- seed-demo --owner referent@example.com
DATABASE_URL="postgres://..." npm run admin -- set-ai-budget --email referent@example.com --questions 20 --tokens 12000
DATABASE_URL="postgres://..." npm run admin -- retention-report --years 5 --lecture-token gleitlagerung-demo
DATABASE_URL="postgres://..." npm run admin -- retention-cleanup --years 5 --lecture-token gleitlagerung-demo
DATABASE_URL="postgres://..." npm run admin -- retention-cleanup --years 5 --lecture-token gleitlagerung-demo --apply --confirm-retention-cleanup
DATABASE_URL="postgres://..." npm run admin -- backup-sql --out backups/learnbuddy.sql
DATABASE_URL="postgres://..." npm run admin -- restore-sql --file backups/learnbuddy.sql
DATABASE_URL="postgres://..." RESTORE_DATABASE_URL="postgres://..." npm run smoke:backup-restore
DATABASE_URL="postgres://..." npm run admin -- status
```

`seed-demo` ist idempotent und erzeugt die Demo-Reihe `Maschinenelemente I`, die Vorlesung `gleitlagerung-demo`, drei Folien und vier Fragevarianten.
`retention-report` ist nicht-destruktiv: Das Kommando zählt Altbestände außerhalb der Aufbewahrungsfrist, blendet bereits redigierte Lernsignale aus und trennt bereinigbare Lernsignale von Kurs-/Archivbeständen.
`retention-cleanup` ist ohne `--apply` ebenfalls ein Dry-Run. Mit `--apply --confirm-retention-cleanup` anonymisiert es alte pseudonyme Lernsignale: Sitzungen werden auf `Anonymisiert` gesetzt, Antwort- und Analyticszeilen verlieren den Sessionbezug, alte Chatfragen und Transkriptsegmente werden redigiert. Materialien, Fragen, Reviews, Jobs und Standalone-Exporte werden nur als `skippedContent` berichtet, weil diese Inhalte wegen des Langzeit-/Standalone-Ziels nicht automatisch gelöscht werden.
`backup-sql` nutzt `pg_dump` und schreibt einen normalen SQL-Dump. `restore-sql` nutzt `psql`, erwartet standardmäßig eine leere Ziel-Datenbank und bricht bei vorhandenen Tabellen ab; `--allow-nonempty` ist nur für bewusst geplante Sonderfälle gedacht. `smoke:backup-restore` bündelt diesen Runbook-Pfad maschinenlesbar: Source-Status lesen, Dump schreiben, in eine explizite leere Restore-DB einspielen, Statuscounts und erwarteten Public Token vergleichen und den Nonempty-Schutz prüfen. Falls die Binaries nicht im `PATH` liegen, können `PG_DUMP_BIN` und `PSQL_BIN` gesetzt werden.

## Erforderliche Postgres-Funktionen

- Postgres 16 oder neuer empfohlen.
- Extension `pgvector` für `asset_chunks.embedding`.
- Normale SQL-Migrationen über Drizzle Kit.
- Portable lokale Self-Hosting-Basis: `compose.yaml` startet Postgres 16 mit `pgvector`, die App, ein Artefaktvolume und `/api/health`; Details stehen in `docs/self-hosting.md`.

Für Neon muss `pgvector` im Projekt verfügbar sein. Für Self-Hosting muss das Paket zur jeweiligen Postgres-Version installiert werden.

## Lokale Prüfung

Beispiel mit Homebrew Postgres:

```bash
brew install pgvector
initdb -D .tmp/pgdata --no-locale --encoding=UTF8
postgres -D .tmp/pgdata -h 127.0.0.1 -p 55432
createdb -h 127.0.0.1 -p 55432 learnbuddy_e2e
DATABASE_URL="postgres://$USER@127.0.0.1:55432/learnbuddy_e2e" npm run db:migrate
DATABASE_URL="postgres://$USER@127.0.0.1:55432/learnbuddy_e2e" npm run admin -- seed-demo --owner referent@example.com
DATABASE_URL="postgres://$USER@127.0.0.1:55432/learnbuddy_e2e" LEARNBUDDY_AUTO_SEED=0 npm run dev
```

## Neon/Vercel

Für Vercel:

- `DATABASE_URL`: Neon pooled connection string für normale App-Queries.
- `AUTH_SECRET`: langer zufälliger Wert.
- `LEARNBUDDY_DEPLOYMENT_ENV=production`: optionaler Production-Hardening-Schalter für Self-Hosting außerhalb Vercel; auf Vercel setzt `VERCEL_ENV=production` dieselben Guardrails.
- `NEXT_PUBLIC_APP_URL`: kanonische Deployment-URL.
- `RESEND_API_KEY` und `EMAIL_FROM`: erst setzen, wenn produktiver Mailversand aktiv ist.
- `LEARNBUDDY_AI_PROVIDER=ctox-responses`: bevorzugter produktiver KI-Pfad über den bestehenden CTOX/OpenAI-Responses-Proxy.
- `LEARNBUDDY_LLM_PROXY_BASE_URL=https://llm.ctox.dev`: kann weggelassen werden, weil dies der Default ist; explizit setzen ist für Preview-Smokes trotzdem hilfreich.
- `LEARNBUDDY_LLM_PROXY_API_KEY=ctox_llm_...`: tenant-scoped Proxy-Key, serverseitig-only. Alternativ werden kompatible `CTOX_LLM_PROXY_BASE_URL` und `CTOX_LLM_PROXY_API_KEY` gelesen, damit Umgebungen zwischen CTOX und LearnBuddy geteilt werden können.
- `LEARNBUDDY_LECTURER_ASSISTANT_PROVIDER=ai`: Referenten-Assistent nutzt denselben serverseitigen AIProvider/CTOX-Responses-Pfad; ohne diese Variable bleibt nur der lokale Planungsfallback aktiv.
- `LEARNBUDDY_QUESTION_GENERATOR=ai`: verpflichtender Preview-/Production-Pfad für Materialreview-Fragen über denselben serverseitigen AIProvider; ohne diese Variable bleibt nur der lokale deterministische Demo-Generator aktiv.
- `LEARNBUDDY_EMBEDDING_PROVIDER=openai-compatible`: serverseitiger Embedding-Pfad für Material-Chunks und Learn-Retrieval.
- `LEARNBUDDY_EMBEDDING_BASE_URL=https://...`: Base-URL des OpenAI-kompatiblen Embedding-Dienstes; die App normalisiert auf `/v1/embeddings`.
- `LEARNBUDDY_EMBEDDING_API_KEY=...`: serverseitig-only, nie als `NEXT_PUBLIC_*` setzen.
- `LEARNBUDDY_EMBEDDING_MODEL=...`: produktives Embedding-Modell; der Provider muss 1536-dimensionale Vektoren liefern.
- `LEARNBUDDY_OCR_PROVIDER=http`: externer OCR-/Vision-Pfad für gescannte PDFs, PPTX-Bildinhalte und Bild-Uploads.
- `LEARNBUDDY_OCR_BASE_URL=https://...`: Base-URL des OCR-/Vision-Dienstes; die App normalisiert auf `/v1/ocr`.
- `LEARNBUDDY_OCR_API_KEY=...`: serverseitig-only, nie als `NEXT_PUBLIC_*` setzen.
- `LEARNBUDDY_OCR_MODEL=learnbuddy-ocr`: produktives OCR-/Vision-Modell.
- `LEARNBUDDY_OCR_LANGUAGE=de`: Standardsprache für deutschsprachige Vorlesungsmaterialien.
- `LEARNBUDDY_STORAGE_PROVIDER=vercel-blob`: produktionsnaher Vercel-Blob-Pfad für Material- und Archivartefakte. Alternativ `http` für den portablen Self-Hosting/Object-Storage-Adapter; leer nutzt lokalen Filesystem-Storage.
- `LEARNBUDDY_STORAGE_ACCESS=private`: Zugriffstyp für Vercel Blob; `public` ist möglich, aber der MVP liefert Artefakte bevorzugt über `/api/storage-artifacts/...` aus.
- `BLOB_READ_WRITE_TOKEN` oder `LEARNBUDDY_STORAGE_TOKEN`: serverseitiger Vercel-Blob-Schreibtoken.
- `LEARNBUDDY_STORAGE_ENDPOINT=https://...`: Endpoint des HTTP-Object-Storage-Adapters für Self-Hosting/Smokes; erwartet `PUT`/`GET /objects/:path`.
- `LEARNBUDDY_STORAGE_API_KEY=...`: optionaler Bearer-Token für den HTTP-Object-Storage-Adapter.
- `LEARNBUDDY_STORAGE_TIMEOUT_MS=15000`: optionales Timeout für Storage-Provider-Requests.
- `LEARNBUDDY_JOB_PROVIDER=http`: optionaler portabler Job-Broker-Pfad für Material- und Standalone-Archivjobs; ohne diese Variable bleibt der lokale Inline-Provider aktiv.
- `LEARNBUDDY_JOB_PROVIDER=database`: asynchroner Postgres-Queue-Pfad für Material- und Standalone-Archivjobs. User-Requests legen Jobs als `queued` an; der Worker verarbeitet sie später.
- `LEARNBUDDY_JOB_ENDPOINT=https://.../jobs`: absoluter HTTP(S)-Endpoint des Brokers. Der MVP registriert Jobs dort und führt anschließend denselben geprüften Handler aus; echte asynchrone Worker-Ausführung ist ein separater Ausbauschritt.
- `LEARNBUDDY_JOB_API_KEY=...`: optionaler serverseitiger Bearer-Token für den Broker.
- `LEARNBUDDY_JOB_TIMEOUT_MS=15000`: optionales Timeout für Broker-Registrierung.
- `LEARNBUDDY_WORKER_SECRET=...`: Bearer-Secret für `POST /api/jobs/worker`; ohne Secret ist der Worker-Endpunkt nicht nutzbar.
- `LEARNBUDDY_WORKER_APP_URL=https://...`: kanonische App-URL für Worker-Artefakterzeugung; fällt auf `NEXT_PUBLIC_APP_URL` zurück.
- `LEARNBUDDY_WORKER_MAX_ATTEMPTS=3`: maximale Versuche pro database Worker-Job, begrenzt auf 1 bis 10.
- `LEARNBUDDY_WORKER_RETRY_BASE_MS=30000`: Basisdelay für exponentielle Wiederholungen; der Worker claimt Retry-Jobs erst wieder ab `next_attempt_at`.
- `CRON_SECRET=...`: Secret für Vercel Cron. Vercel ruft `GET /api/jobs/worker/cron` gemäß `vercel.json` auf und sendet dieses Secret als Bearer-Token. Ohne `CRON_SECRET` oder `LEARNBUDDY_WORKER_SECRET` antwortet der Cron-Endpunkt mit 401.
- `LEARNBUDDY_WORKER_CRON_LIMIT=5`: maximale Anzahl Jobs pro Cron-Tick, begrenzt auf 1 bis 25.

Migrationen sollten über eine direkte Neon-Connection in einem kontrollierten Deploy-/Admin-Schritt laufen, nicht aus normalen Request-Handlern.

```bash
DATABASE_URL="postgres://..." npm run db:migrate
```

Aktueller Preview-Befund, zuletzt geprüft am 20. Juni 2026: Neon-Projekt `damp-sun-55979489` ist migriert und geseedet; `/api/health` auf `https://learn-buddy-xgulr7j1t-metric-spaces-projects.vercel.app` meldet `database=pass` und liefert die erwarteten Security-/No-Store-Header. Die Preview läuft mit Vercel Functions in `fra1` nahe an Neon `aws-eu-central-1`. Das kombinierte Preview-Baseline-Gate mit Vercel-Env-Pull ist grün: Live-Smoke, 30-Teilnehmer-Live-Load-Smoke und Worker-/Archiv-Smoke laufen gegen dieselbe Preview; der Worker-/Archiv-Pfad erzeugt einen `standalone_export_jobs`-Datensatz, verarbeitet ihn über `provider=database`, schreibt ein Vercel-Blob-Artefakt unter `/api/storage-artifacts/vercel-blob/...` und lädt das ZIP wieder über die App. Die öffentliche Root-Seite ist zusätzlich im Browser gegen die LearnBuddy-Motion-Spec geprüft: Launch-Stage und Bottom-Dock sind sichtbar, alte generische Mode-Cards sind nicht mehr vorhanden. Das echte Preview-Readiness-Gate steht bei 14/15 Checks; `provider_mode_values` ist grün, rot bleibt nur `required_env` für die noch fehlenden echten Providerwerte.

## E2E-Gate

Ein DB-Schnitt gilt erst als grün, wenn mindestens dieser Browserflow mit gesetzter `DATABASE_URL` läuft:

1. Ausgeloggter Zugriff auf `/lecturer` redirectet auf Login.
2. Referent loggt sich per Magic Link ein.
3. Dashboard zeigt die aus Postgres geseedete Demo-Vorlesung.
4. Referent legt eine neue Vorlesung an.
5. Referent merkt Material vor und verarbeitet es.
6. Review-Fragen werden erzeugt.
7. Referent bearbeitet eine Frage und eine Antwort.
8. Browser-Reload zeigt die Änderungen weiterhin.
9. Referent gibt die Frage frei.
10. Live-Dozentenmodus zeigt die freigegebene editierte Frage, aber keine Antworttexte.
11. Notizmaterial wird gelesen, gechunkt und in `asset_chunks` persistiert.
12. Dashboard zeigt Materialstatus `ready`, Chunk-Anzahl und Textvorschau.
13. Review-Fragen verwenden den extrahierten Materialbegriff und bleiben nach Reload sichtbar.
14. Review-Varianten zeigen Promptversion, Quellenreferenz, Lernziel, Status und Review-Kommentar.
15. Freigabe setzt Varianten auf `approved` und aktive Fragen übernehmen `prompt_version`.
16. Learn-Evaluation wird als pseudonymes Analytics-Event gespeichert.
17. Referenten-Dashboard zeigt Evaluationsanzahl, Durchschnittswerte, Freitextkommentare und einfache Empfehlung.
18. Referent konfiguriert den Evaluation Builder; `lectures.evaluation_config`, Learn-Modus, Analytics-Dashboard und Reload-Persistenz verwenden dieselben Labels.
19. Referent speichert die Evaluation als Reihenvorlage; `lecture_series.evaluation_config` wird gesetzt und neue Vorlesungen derselben Reihe übernehmen diese Konfiguration.
20. Referenten-Dashboard ist als WYSIWYG-Studio bedienbar; Präsentation und Fragenreview erscheinen als sichtbare Arbeitsflächen und nicht als technische Formularliste.
21. Evaluationen werden in `lectures.evaluation_config.version` versioniert; `evaluation_submitted` speichert `evaluationVersion`, und das Dashboard zeigt den Versionsverlauf.
22. KI-Chat im Learn-Modus schreibt Nutzungsereignisse und respektiert `ai_access_until`.
23. Referenten-Dashboard zeigt KI-Öffnungen, KI-Fragen, blockierte KI-Anfragen und letzte KI-Frage.
24. KI-Proxy erzwingt pro Vorlesung ein konfigurierbares Tageslimit und Tokenbudget pro pseudonymer Learn-Sitzung.
25. KI-Proxy liefert Learn-Antworten als `application/x-ndjson`-Stream; UI zeigt aufgebaute Antwort, Quellen und Restbudget, und `analytics_events.ai_chat_answered` speichert `streaming=true`.
26. KI-Proxy erzwingt zusätzlich pro Vorlesungsreihe konfigurierbare Tages- und Tokenlimits aus `lecture_series`.
27. KI-Proxy erzwingt zusätzlich kontoübergreifende Tages- und Tokenlimits aus `users`.
28. Demo-Seed kann über `npm run admin -- seed-demo` außerhalb des Request-Pfads erzeugt werden; die App läuft mit `LEARNBUDDY_AUTO_SEED=0` gegen dieselben Daten.
29. Referenten-Assistentenaktionen bleiben owner-gescoped und persistiert: `Fragenentwurf anlegen` schreibt Review-Drafts, `Folienpunkt übernehmen` schreibt deduplizierte Folienpunkte in `slides.content_json.copy`, `Quellen-Notiz` schreibt echte Notizquellen in `lecture_assets`, `Evaluation schärfen` schreibt eine folienbezogene `lectures.evaluation_config` mit neuer Version; alle bleiben nach Reload sichtbar und fremde Referenten erhalten 404.
30. Learn-KI nutzt im produktionsnahen Pfad `LEARNBUDDY_AI_PROVIDER=ctox-responses`; Browserrequests gehen nur an `/api/ai/chat`, der Server ruft `/v1/responses` mit Bearer-Token auf, `analytics_events.ai_chat_answered` speichert `provider=ctox-responses`, `model=MiniMax-M3` und Responses-Usage, und fehlender Proxy-Key liefert clientseitig nur eine neutrale 503.
31. Materialverarbeitung nutzt im produktionsnahen Pfad `LEARNBUDDY_EMBEDDING_PROVIDER=openai-compatible`; Browserrequests gehen nur an LearnBuddy-Routen, der Server ruft `/v1/embeddings` mit Bearer-Token auf, `asset_chunks.embedding` speichert 1536-dimensionale Vektoren, Learn-KI zitiert Vektorquellen, und fehlende Embedding-Konfiguration liefert clientseitig nur eine neutrale Fehlermeldung.
32. Materialreview-Fragen nutzen im produktionsnahen Pfad `LEARNBUDDY_QUESTION_GENERATOR=ai` denselben AIProvider wie der KI-Proxy; der Server ruft `/v1/responses` oder den konfigurierten OpenAI-kompatiblen Chat-Provider mit Bearer-Token auf, validiert vier Niveauvarianten und speichert `llm-material-v1` in Prompt-History und Registry. Fehlende AI-Konfiguration liefert clientseitig nur eine neutrale Fehlermeldung.
33. Material- und Archivjobs nutzen im portablen Broker-Pfad `LEARNBUDDY_JOB_PROVIDER=http`; der Server ruft `LEARNBUDDY_JOB_ENDPOINT` mit Bearer-Token auf, Postgres speichert `provider=http` plus Broker-ID, und fehlende Broker-Konfiguration liefert clientseitig nur neutrale Meldungen ohne Env-Namen oder Providerdetails.
34. Material- und Archivartefakte nutzen im Remote-Storage-Pfad `LEARNBUDDY_STORAGE_PROVIDER=http` oder `vercel-blob`; Browserlinks zeigen auf `/api/storage-artifacts/...`, der Server liest/schreibt mit Bearer-Token beziehungsweise Blob-Token, und fehlende Storage-Konfiguration liefert clientseitig nur neutrale Meldungen ohne Env-Namen oder Providerdetails.
35. Material- und Archivjobs nutzen im asynchronen DB-Pfad `LEARNBUDDY_JOB_PROVIDER=database`; Referentenrequests erzeugen `queued`-Runs/Jobs, `POST /api/jobs/worker` claimt Jobs atomar per `queued -> running`, schreibt `provider=database` plus Provider-Job-ID und finalisiert Review-Fragen oder ZIP-Artefakte.
36. 30 pseudonyme Studentensessions schreiben Live-Antwortevents über `/api/events`; der öffentliche Event-Guard validiert Antwortschlüssel serverseitig gegen die gespeicherte Vorlesungsfrage. `/api/lecture/[token]/leaderboard` aggregiert daraus Top-10, Punkte, korrekte Antworten, Antwortzahl und eigene Session-Markierung, und ein frischer Student-Browser sieht dieselbe Rangliste im Modal.
37. Öffentliche Preview-/Production-Smokes laufen über `npm run smoke:live -- --url https://... --lecture-token ...`; öffentliche Ziele müssen HTTPS verwenden, Plain-HTTP ist nur für lokale/private Diagnoseziele zulässig. Der Standardpfad prüft `/api/health`, Student Live, Learn, Quiz, KI-Chat-Öffnung und Leaderboard im Browser. Authentifizierter Referenten-Smoke erfordert einen echten absoluten HTTPS-Magic-Link aus Resend via `LEARNBUDDY_LIVE_SMOKE_MAGIC_LINK`, damit Production keine Testlink-Hintertür bekommt; relative oder lokal gerenderte Links sind nur für lokale/private Diagnoseziele zulässig. `--include-assistant --require-assistant-provider` prüft zusätzlich den sichtbaren Referenten-Assistenten mit Provider-Schritt. Rote Ziel-, Auth-, Health- oder Browserfehler erscheinen zusätzlich kompakt unter `blockers`.
38. Worker-/Storage-Smokes laufen über `npm run smoke:worker -- --url https://... --lecture-token ...`; öffentliche Preview-/Production-Ziele müssen HTTPS verwenden, Plain-HTTP ist nur für lokale/private Diagnoseziele zulässig. Der Pfad prüft Worker-401 ohne Secret, queued `standalone_export_jobs`, database Worker-Ausführung, finalen Jobstatus, `standalone_exports`-Verknüpfung, App-interne Storage-Route, ZIP-Mime-Type und SHA-256-Konsistenz. Absolute Storage-URLs zählen nicht als gültiger Beleg; `--verify-job-id` prüft vorhandene Jobdatensätze gezielt gegen denselben Artefaktroutenvertrag. Rote Ziel-, Worker- oder Artefaktfehler erscheinen zusätzlich kompakt unter `blockers`.
39. Vercel-Readiness läuft vor einem Deploy über `npm run deploy:readiness -- --environment preview|production`; der Check prüft Vercel-CLI, Login, `.vercel/project.json` und die Pflicht-Env-Namen aus Vercel oder lokalem `process.env`, ohne Secretwerte auszugeben. Mit `--pull-vercel-env --scope ...` lädt der Check die Ziel-Env temporär per `vercel env pull`, löscht die Datei wieder und prüft zusätzlich öffentliche Provider-Endpunkte, Placeholder-Secrets und `EMAIL_FROM`-Domains gegen dieselben Regeln wie Self-Hosting-/CI-Ziele. Für spätere Self-Hosting-Ziele läuft derselbe Env-/Endpoint-/Self-Hosting-Dateivertrag über `npm run deploy:readiness -- --environment production --self-host` ohne Vercel-CLI/Auth/Projektlink.
40. Das vollständige Freigabe-Gate läuft über `npm run release:gate -- --mode full --url https://... --lecture-token ...`; es bündelt lokale Gates, Deploy-Readiness, zielabhängigen Admin-Preflight, aktive Provider-Smokes, authentifizierten Live-Smoke mit KI/Assistent und Worker-/Storage-Smoke. `--mode full` ist nur für öffentliche HTTPS-Preview-/Production-Ziele gültig; lokale, `.local`, link-lokale und private Netzwerkziele bleiben Diagnosepfade. Für `--environment production` muss `--url` dieselbe Origin wie `NEXT_PUBLIC_APP_URL` haben. Für Vercel-Ziele lädt `--pull-vercel-env` die Zielwerte einmal und reicht sie an `deploy:readiness --local`, Provider-Smoke und Admin-Preflight weiter. Für Self-Hosting wird `--self-host` genutzt; das Gate ruft dann `deploy:readiness --self-host` auf und nutzt `process.env` statt Vercel-Env-Pull, bleibt aber an dieselben Full-Gate-Pflichten für Provider, Auth, Live und Worker gebunden. `releaseReady=true` wird nur ohne Fehler und ohne übersprungene Checks gesetzt; `productionReady=true` zusätzlich nur bei `--environment production`. Die JSON-Ausgabe enthält `blockers` mit fehlgeschlagenen/übersprungenen Top-Level-Checks. Für Unterbefehle wie Deploy-Readiness, Admin-Preflight, Provider-, Live-, Live-Load-, Worker-, Self-Host- und Backup-/Restore-Smoke übernimmt `release:gate` bevorzugt deren eigene `blockers` und nutzt rote `checks` nur als Fallback; dadurch sind fehlende Ziel-Env, Auth-, Provider-, Last-, Container-, Backup- und Artefaktprobleme ohne Logsuche sichtbar, während Warnungen aus dem Admin-Preflight nicht als Child-Blocker erscheinen.

Für Analytics gilt zusätzlich:

1. Student öffnet den Live-Link in einem frischen Browserkontext.
2. Student gibt ein Pseudonym ein und tritt bei.
3. `student_joined` wird mit Pseudonym und `anonymousKey` persistiert.
4. Student beantwortet eine Frage.
5. `answer_selected` wird mit Niveau, Punkten, gewählter Antwort und Korrektheit persistiert.
6. Reload erzeugt keine doppelten Teilnahmeevents.
7. Unbekannte Lecture Tokens werden für Events abgelehnt.
8. Referent sieht aggregierte Teilnehmende, Antworten, Antwortquote, Korrektquote und Niveau-Breakdown im Dashboard.
9. Die authentifizierte Aggregate-API liefert dieselben Werte wie die Dashboard-UI; unauthentifizierter Zugriff wird blockiert.
10. Learn-Evaluation erzeugt `evaluation_submitted` mit Ratings und Freitext.
11. Evaluationen bleiben nach Dashboard-Reload sichtbar und funktionieren im 390px Mobile-Viewport ohne horizontalen Overflow.
12. KI-Chat erzeugt `ai_chat_opened`, `ai_chat_requested`, `ai_chat_answered` und bei abgelaufenem Prüfungstag `ai_chat_blocked`.
13. Die authentifizierte Aggregate-API liefert dieselben KI-Nutzungswerte wie die Dashboard-UI.
14. Bei überschrittenem `LEARNBUDDY_AI_DAILY_LIMIT` erzeugt der Proxy `ai_chat_blocked` mit `reason=rate_limit`.
15. KI-Chat nutzt `asset_chunks` als Quellen, speichert `tokens` und `sources` in `ai_chat_answered`, und bei überschrittenem `LEARNBUDDY_AI_DAILY_TOKEN_LIMIT` `ai_chat_blocked` mit `reason=token_budget`.
16. URL-Material wird abgerufen, von HTML zu Text extrahiert, in `asset_chunks` gespeichert und im Review sowie KI-Chat als Quelle sichtbar.
17. PDF- und PPTX-Uploads werden textuell extrahiert, in `asset_chunks` gespeichert und im Review sowie KI-Chat als Datei-Quellen sichtbar.
18. Materialverarbeitung erzeugt einen persistierten Lauf in `material_processing_runs`; Dashboard zeigt Status, Counts, Schritte, Dauer und Reload-Persistenz.
19. Studentische Chatfragen werden in `student_chat_questions` persistiert, über einen providerneutralen Moderationsadapter bewertet, im Dashboard angezeigt und erzeugen bei Relevanz einen `Chatfrage:`-Review-Kandidaten. Provider, Modell, Confidence und Signale werden als Auditfelder gespeichert.
20. Live-Transkriptsegmente werden in `transcript_segments` persistiert, fachlich gefiltert, im Dashboard angezeigt und erzeugen bei Relevanz einen `Transkript:`-Review-Kandidaten.
21. Standalone-Exporte werden in `standalone_exports` persistiert; der Dashboard-Download liefert versionierte self-contained HTML-Dateien mit SHA-256-Prüfsumme, Manifest-SHA-Header, statisch gerenderten Folien/Fragen, eingebetteten Exportdaten, eingebettetem Offline-Manifest, Asset-Prüfsummen, Data-URI-Audio-Fallback, lokaler Quizinteraktion und Reload-sichtbarer Exporthistorie. Zusätzlich liefert der Archiv-Download ein ZIP-Bundle mit Manifest, Daten, CSS, JS und echten hochgeladenen Dozentenaudio-Dateien; `Archiv speichern` legt dasselbe ZIP als reload-stabiles lokales Storage-Artefakt ab.
22. KI-Budgets werden in `lectures.ai_daily_limit`, `lectures.ai_daily_token_limit`, `lecture_series.ai_daily_limit`, `lecture_series.ai_daily_token_limit`, `users.ai_daily_limit` und `users.ai_daily_token_limit` persistiert; Dashboard, Learn-Chat, Analytics und Reload-Persistenz verwenden dieselben Werte.
23. Antwortevents speichern Frage- und Antworttexte; das Dashboard aggregiert daraus Fragequalität mit Korrektquote, häufiger falscher Antwort und Prioritätsempfehlung.
24. `participant_sessions` sind über `(lecture_id, anonymous_key)` eindeutig; schnelle Join-/Antwortevents nutzen ein konfliktfestes Upsert und erzeugen keine doppelten Teilnehmenden.
25. Das Dashboard zeigt einen Aktivitätsverlauf aus Zeit-Buckets mit Events, aktiven Sitzungen, Antworten, Korrektquote, KI-Fragen und Evaluationen.
26. `lectures.evaluation_config` speichert Evaluationstitel, Intro, Skalenlabels, Freitextlabel, Buttontext und Aktivstatus; `evaluation_submitted` speichert zusätzlich die verwendeten Labelmetadaten.
27. `lecture_series.evaluation_config` speichert eine provider-neutrale Reihenvorlage; neue Vorlesungen verwenden sie als Default, andere Reihen bleiben isoliert.
28. `lectures.evaluation_config.version` und `updatedAt` werden bei inhaltlichen Änderungen erhöht; `analytics_events.event_payload.evaluationVersion` erlaubt getrennte Auswertung pro Evaluationsstand.
29. Das Dashboard erzeugt automatische Verbesserungsvorschläge aus Antwortqualität, Themenclustern, Reihenverlauf, Evaluation und KI-Nutzung; Aggregates-API, Reload, 390px Mobile-Fit und unauthentifizierter 401-Schutz bleiben grün.
30. Referenten können aus Verbesserungsvorschlägen Folien- und Fragenentwürfe übernehmen; `slides.content_json` und aktive `question_variants` persistieren die Änderungen, und Learn-/Live-Modus zeigen sie nach Reload.
31. Jede Entwurfsübernahme erzeugt ein `improvement_draft_applied`-Event; Dashboard und Aggregates-API zeigen daraus die Review-Historie `Übernommene Änderungen`.
32. Referentenstudio bleibt WYSIWYG: Fragenreview erscheint als zentrale Quizfläche, Evaluation als zentrale Learn-Vorschau und Material direkt am sichtbaren Deck; doppelte Kernaktionen wie zweites `Bearbeiten`, zweites `Speichern` oder zweites `Verarbeiten` sind im geprüften Flow entfernt.
33. Präsentationsmodus bleibt WYSIWYG: Es gibt keine permanente rechte Formularspalte, Folientitel und Copy werden direkt auf dem sichtbaren Slide geändert, Deckdaten sind standardmäßig eingeklappt und Speichern/Reload persistieren die Änderung.
34. Fragenreview persistiert Prompt-Historie und Qualitätsentscheidung in `question_review_items.variants_json`; Generierung, Review-Edit und Freigabe/Ablehnung bleiben nach Reload sichtbar und direkt per Postgres prüfbar.
35. Learn-KI-Antworten laufen über den eigenen Proxy als NDJSON-Stream; Token-/Done-Events werden browserseitig gelesen, Quellen/Budget bleiben sichtbar und `analytics_events` persistiert `streaming=true`.
36. Fragenreview persistiert eine Prompt-Registry in `question_review_items.variants_json`; Template-ID, Modellparameter, Retrievalmodus, Quellenabdeckung, Review-Confidence, Revisionen und letzte Qualitätsentscheidung bleiben nach Reload sichtbar und direkt per Postgres prüfbar.
37. Standalone-Export-Dateien bleiben als Einzel-HTML offline renderbar; `learnbuddy-manifest` und `learnbuddy-data` sind parsebar, `externalAssetCount=0`, Asset-Prüfsummen und lokales Quizfeedback sind im Browser prüfbar. Archiv-ZIPs deklarieren `standalone-archive-v1`, `rootDocument=index.html` und Audioassets mit Pfad, Mime-Type, Bytezahl, Quelle und SHA-256.
38. Dozenten-Live-STT läuft über Browser-Mikrofon, PCM16-WAV-Capture mit MediaRecorder-Fallback und den eigenen STT-Proxy; transkribierte Segmente werden erst nach Referentenübernahme in `transcript_segments` persistiert und erzeugen bei Fachbezug einen `Transkript:`-Review-Kandidaten.
39. Referentenstudio bleibt fullscreen-nah und WYSIWYG: Tools sind direkt an der Folie verankert, Fragen, Evaluation, Auswertung und Quellen öffnen als Folien-Layer statt als Formular- oder Kontextspalte, Quiz nutzt das Live-Layout, Quellen bleiben deckbezogen, und 390px Mobile zeigt Burger-Menü plus viewportgebundene Layer ohne horizontalen Overflow.
40. Referenten können studentische Chatfragen im Studio manuell übernehmen oder ignorieren; Übernahme erzeugt genau einen `Chatfrage:`-Review, Ignorieren entfernt einen noch unbearbeiteten Draft-Review derselben Quelle.
41. Folientitel, Copy und Thema werden direkt auf dem Slide per `contenteditable` bearbeitet; deutsche Umlaute persistieren nach Speichern und Reload.
42. Fragenreview bleibt WYSIWYG: Draft-Fragetext, Antworttexte und Erklärung werden direkt in der sichtbaren Quizkarte editiert; der mobile Drawer verdeckt keine Antworten oder Aktionen und erzeugt keinen horizontalen Overflow.
43. Chatfragen fließen in Themencluster ein; zwei akzeptierte fachliche Chatfragen zu Mischreibung/Festkörperkontakt/Verschleiß priorisieren `Mischreibung und Verschleiß` mit `chatQuestions=2`, `acceptedChatQuestions=2` und `riskLevel=hoch`.
44. Referentenstudio hält Status, Live-Termin, Prüfung, Rangliste und KI-Budget sekundär im unteren tabbaren Planungs-Popover; der alte `Termin und Freigabe`-Formularblock und dauerhafte Planleisten sind entfernt.
45. `Fragen prüfen` zeigt aktive Live-Fragen im Quizlayout, wenn keine neuen Review-Drafts vorhanden sind.
46. Referentenstudio hat keine dauerhafte Kopfzeile mehr; das Burger-Menü trägt globale Aktionen, schließt bei Werkzeugwechseln, Quellen nutzen einen exklusiven Datei/Link/Notiz-Composer und neue Vorlesungen entstehen als große editierbare Folienbühne statt als sichtbare Formularliste oder kleines Popover.
47. Prompt-Workflow bleibt auditierbar: Template-Editor, Template-Version, lokaler Testlauf, Durchschnitt, Modellvergleich und `template`-/`test`-History persistieren in `question_review_items.variants_json`.
48. Dozentenstudio bleibt WYSIWYG statt kryptischer Formularliste: Werkzeuglabels sind objektbezogen, Fragen öffnen als Quiz-Overlay über dem Slide, Prompt-Regeln sind standardmäßig verborgen, Quellen erscheinen als Ablage zur aktuellen Folie, und Speichern einer Review-Frage hält das Frage-Overlay offen.
49. Dozentenstudio hält Planwerte im unteren Planungs-Popover statt als generisches Plan-Dropdown, Burger-Formular oder dauerhafte Bühnenleiste; `Quellen` öffnet als Slide-Overlay statt als rechter Formular-Drawer, und Plan-/Exportaktionen schließen offene Werkzeug-Overlays.
50. Standalone-Archiv-ZIP ist als Referentenflow E2E-grün: WAV-Upload wird als `lecture_assets.kind=audio` mit Status `ready` gespeichert, der Burger-Menü-Link ist hit-test-mäßig klickbar, der Browserdownload enthält `index.html`, Manifest, Daten, CSS, JS und `audio/dozenten-audio-f70.wav`, und `standalone_exports` persistiert `standalone-archive-v1-*` mit 64-stelliger SHA-256-Prüfsumme.
51. Persistierte Standalone-Artefakte sind lokal E2E-grün: die authentifizierte Action `Archiv speichern` erzeugt ein ZIP ohne doppelten Route-Historieneintrag, schreibt es über den StorageProvider nach `.data/artifacts`, speichert `/api/local-artifacts/...` in `standalone_exports.storage_url`, und der reload-stabile Dashboard-Link liefert `application/zip`.
52. Chatfrage-Moderation ist auditierbar: fachliche Chatfragen werden automatisch übernommen, fachfremde ignoriert, genau passende `Chatfrage:`-Reviews entstehen, und der Signale-Drawer zeigt Begründung, Status, Provider, Modell, Confidence und Signale.
53. Standalone-Archiv-Audiosegmente sind E2E-grün: Bei PCM-WAV-Audio enthält das gespeicherte ZIP zusätzlich `audio/segments/slide-0X-*.wav`; Manifest und `learnbuddy-data.json` enthalten Segmentmetadaten mit `slideIndex`, `sourcePath`, Zeitbereich und SHA-256, und jede SHA stimmt mit dem ZIP-Eintrag überein.
54. Dozentenstudio bleibt WYSIWYG und folienzentriert: Folienbezogene Werkzeuge sitzen als Objektaktionen direkt auf dem Slide, öffnen Desktop-Kontextflächen beziehungsweise mobile Bottom-Sheets und ersetzen scrollbare Hauptformularlisten für Fragen und Quellen.
55. Standalone-Archivjobs sind persistiert: `Archiv speichern` erzeugt `standalone_export_jobs` mit Status, Format, Requester, Start-/Endzeit, Dauer, Artefakt-URL, SHA und Verweis auf den finalen `standalone_exports`-Datensatz.
56. Archivjobs laufen über einen providerneutralen `JobProvider`: der lokale Inline-Provider speichert `provider=inline` und `provider_job_id`; falsche Provider-Konfigurationen werden als `failed`-Job persistiert.
57. Dozentenstudio bleibt direkt bedienbar: Folienwerkzeuge sind lesbare Objektaktionen statt Symbolmarker, Quellen starten als sichtbarer Materialanker am Slide, offene Werkzeuge blenden die globale Deck-Leiste aus, und 390px Mobile zeigt im Frage-Drawer alle vier Antworten ohne horizontalen Overflow.
58. Materialverarbeitung läuft ebenfalls über den providerneutralen `JobProvider`: erfolgreiche Läufe speichern `provider=inline` und `provider_job_id`; Fehlkonfigurationen werden als `failed`-Run persistiert und in der UI ohne rohen Providertext angezeigt.
59. Dozentenstudio bleibt WYSIWYG statt Adminformular: Die Folie ist das Arbeitsobjekt, `Fragen`, `Evaluation`, `Quellen` und `Auswertung` öffnen Layer direkt auf der aktuellen Folie, Antwortkarten sind lesbar, und Prompt-/Providerdetails bleiben aus der sichtbaren Primär-UI heraus.
60. Leaderboard-Konfiguration ist persistiert: `lectures.leaderboard_enabled` steuert Live- und Learn-Zugang, Referenten-Plan-Chip toggelt den Wert, und Mobile bleibt ohne Overflow.
61. Quellen bleiben als WYSIWYG-Materialanker bedienbar: Datei/Link/Notiz wechseln im selben Kontext, ein ausgewählter Dateiname wird sichtbar, vorhandene Quellen bleiben am Slide sichtbar, und Desktop/Mobile erzeugen keinen horizontalen Overflow.
62. Uploadgrößenlimit ist wirksam: `LEARNBUDDY_MAX_UPLOAD_BYTES` lehnt zu große Dateien vor Storage/Extraktion mit HTTP 413 und sichtbarer Studio-Fehlermeldung ab, persistiert abgelehnte Dateien nicht und lässt kleinere Dateien weiter zu.
63. Learn-KI ist fachlich zweckgebunden: Der Proxy blockiert fachfremde Freitextfragen serverseitig vor Retrieval, Modellantwort und Budgetverbrauch, zeigt im Learn-Chat einen Scope-Hinweis und speichert `ai_chat_blocked.reason=scope`.
64. Dozentenstudio-Folien-Layer sind E2E-grün: `Fragen` öffnet eine Quizkarte, `Evaluation` eine Learn-Vorschau, `Auswertung` einen kompakten Zahlen-/Signallayer und `Quellen` den Materialanker direkt auf der Folie; 390px Mobile bleibt ohne horizontalen Overflow.
65. Leaderboard-Ranking kommt aus echten Antwortevents: `/api/lecture/[token]/leaderboard` aggregiert Punkte aus pseudonymen `answer_selected`-Events, respektiert `lectures.leaderboard_enabled`, markiert die eigene Session per `anonymousKey` und wird in Student Live sowie Learn nach Antworten aktualisiert.
66. Leaderboard-Aggregation ist repository-basiert: Local- und Postgres-Analytics-Repositories stellen `getLectureLeaderboard` bereit, und der Postgres-Pfad liest gezielt `answer_selected`-Events der Vorlesung statt globaler Eventlisten.
67. Datenaufbewahrung ist prüfbar und für pseudonyme Lernsignale bereinigbar: `/api/lectures/[id]/retention`, Studio-Inspector und `npm run admin -- retention-report` zählen Altbestände älter als die konfigurierte Frist. `npm run admin -- retention-cleanup --apply --confirm-retention-cleanup` redigiert alte Sessions, Events, Antworten, Chatfragen und Transkriptsegmente. Materialien, Verarbeitungsläufe, Fragen, Review-Drafts und Standalone-Exporte bleiben unverändert und werden als übersprungene Inhaltsbestände ausgewiesen.
68. Standalone-HTML ist lokal zugänglich bedienbar: Das eingebettete Manifest deklariert `WCAG 2.2 AA baseline`, der Export enthält Skip-Link, semantische Bereiche, sichtbaren Fokus, ARIA-Live-Feedback und Tastaturnavigation für Antwortoptionen.
69. Backup/Restore ist lokal reproduzierbar: `backup-sql` erzeugt einen normalen Postgres-SQL-Dump, `restore-sql` spielt ihn in eine frische DB ein, und die App zeigt danach die wiederhergestellten Vorlesungsdaten im Referentenstudio.
70. Referenten-Planungsassistenz ist foliennah persistiert: `lecturer_assistant_messages` speichert Lecture, optionale Slide, Rolle, Inhalt, Quellenbezüge und Timestamp; `/api/lectures/[id]/assistant` ist authentifiziert und owner-gescoped, und das Studio zeigt den Verlauf als Overlay direkt auf der Folie.
71. Referentenstudio ist konsequent WYSIWYG: keine permanente Inspector- oder Planleiste; Desktop zeigt eine visuelle Folienleiste wie ein Deck-Editor, Mobile blendet sie aus, Planung öffnet als kompakter Popover pro Plan-Chip, und folienbezogene Werkzeuge sitzen als lesbare Objektaktionen direkt auf der aktuellen Folie.
72. Referentenstudio vermeidet kryptische Marker und Formularlisten: `Assistent`, `Fragen`, `Quellen`, `Lernstand` und `Evaluation` sind auf Desktop ausgeschrieben, öffnen Layer auf der Folie, und 390px Mobile nutzt eine zweizeilige Bottom-Bar mit voller Planungszeile statt abgeschnittener Chips.

Letzte lokale Evidenz:

- `npm run db:migrate`: grün gegen temporäres Postgres 18 mit `pgvector`.
- Playwright Interactive: grün mit `DATABASE_URL=postgres://michaelwelsch@127.0.0.1:55432/learnbuddy_e2e`.
- Playwright Interactive Analytics: grün für Student-Join und Antwortauswahl mit persistierten Events in `participant_sessions` und `analytics_events`.
- Playwright Interactive Analytics-Dashboard: grün für zwei Studentensessions, 100% Antwortquote, 50% Korrektquote und Niveau-2.0-Breakdown.
- Playwright Interactive Material-Pipeline: grün für Notizextraktion, zwei persistierte Chunks, Dashboard-Vorschau, vier Review-Niveaus mit `Mischreibung`, Reload-Persistenz und Mobile-Fit.
- Direkte Postgres-Gegenprobe: `lecture_assets.status=ready`, zwei `asset_chunks`, erster Chunk enthält den extrahierten Notiztext.
- Playwright Interactive Review-Metadaten: grün für Promptversion, Quellenreferenz, Lernziel, Statuswechsel, Review-Kommentar, Reload-Persistenz, Freigabe und Live-Dozentenmodus ohne Antworttexte.
- Direkte Postgres-Gegenprobe: `variants_json` enthält `local-material-v1`, `approved` und Kommentar; aktive `question_variants` enthalten viermal `prompt_version=local-material-v1`.
- Playwright Interactive Evaluation: grün für Learn-Evaluation mit 3/4/5-Ratings, Freitext, Analytics-Dashboard-Aggregat, Aggregates-API, Reload-Persistenz und Mobile-Fit.
- Direkte Postgres-Gegenprobe: `analytics_events.event_type=evaluation_submitted` enthält Ratings und Freitextkommentar.
- Playwright Interactive KI-Analytics: grün für gültige KI-Antwort, abgelaufenen KI-Zugriff über Prüfungstag, sichtbaren Fehlerzustand, Dashboard-Aggregat, Aggregates-API, Reload-Persistenz und Mobile-Fit.
- Direkte Postgres-Gegenprobe: `analytics_events` enthält `ai_chat_opened=2`, `ai_chat_requested=2`, `ai_chat_answered=1`, `ai_chat_blocked=1`.
- Playwright Interactive KI-Rate-Limit: grün mit `LEARNBUDDY_AI_DAILY_LIMIT=2` für zwei erlaubte KI-Antworten, eine sichtbare 429-Blockierung, Dashboard-Aggregat, Aggregates-API, Reload-Persistenz und Mobile-Fit.
- Direkte Postgres-Gegenprobe: `analytics_events` enthält `ai_chat_opened=1`, `ai_chat_requested=3`, `ai_chat_answered=2`, `ai_chat_blocked=1` mit `reason=rate_limit`.
- Playwright Interactive KI-Retrieval/Tokenbudget: grün mit `LEARNBUDDY_AI_DAILY_TOKEN_LIMIT=500` für Quellenanzeige aus `asset_chunks`, sichtbares Restbudget, sichtbaren 429-Budgetblock, Dashboard-Aggregat, Reload-Persistenz und Mobile-Fit.
- Direkte Postgres-Gegenprobe: `analytics_events` enthält `ai_chat_answered` mit `tokens` und `sources`, plus `ai_chat_blocked.reason=token_budget`.
- Playwright Interactive URL-Extraktion: grün mit `LEARNBUDDY_ALLOW_LOCAL_URL_FETCH=1` für lokale Demo-URL, HTML-Textvorschau, zwei persistierte URL-Chunks, Review-Fragen mit `Stribeck-Kurve`, Learn-KI-Quellen, Reload-Persistenz und Mobile-Fit.
- Direkte Postgres-Gegenprobe: `lecture_assets.source=url`, `asset_chunks` enthält URL-HTML-Text, `question_review_items.variants_json` enthält URL-`sourceRef`, `analytics_events.ai_chat_answered.sources` enthält beide URL-Chunks.
- Playwright Interactive PDF/PPTX-Upload-Extraktion: grün für PDF- und PPTX-Upload, textuelle Datei-Extraktion, zwei persistierte Datei-Chunks, Review-Fragen mit `Stribeck-Kurve` und `Mischreibung`, Learn-KI-Quellen, Reload-Persistenz und Mobile-Fit.
- Direkte Postgres-Gegenprobe: `lecture_assets.source=upload`, `asset_chunks` enthält `gleitlagerung-upload.pdf#chunk-1` mit `Viskosität` und `gleitlagerung-upload.pptx#chunk-1` mit `Stribeck-Kurve`, `question_review_items.variants_json` enthält Datei-`sourceRef`, `analytics_events.ai_chat_answered.sources` enthält beide Datei-Chunks.
- Playwright Interactive Material-Jobstatus: grün für Dashboard-Start, sichtbares `Verarbeitung läuft`, persistierten letzten Lauf mit `Abgeschlossen`, Counts, Schrittprotokoll, Dashboard-Reload, erfolgreichen Null-Lauf, sauberen Dashboard-Reload ohne Console-/Network-Fehler und Mobile-Fit.
- Direkte Postgres-Gegenprobe: `material_processing_runs` enthält erfolgreichen Lauf mit `material_count=1`, `chunk_count=1`, `review_count=1`, Schrittprotokoll und Dauer; ein zweiter Lauf enthält `Keine offenen Materialien gefunden.` mit Null-Counts.
- Playwright Interactive WYSIWYG-Studio-Nachschärfung: grün für lesbare Objektaktionen, Quellen-Sheet im früheren Aktionszustand, Notizquelle, Materialverarbeitung, Frage-Quizkarte, ausgeblendete globale Bottom-Bar, 390px Mobile-Taps auf `Quellen`/`Frage`, vier sichtbare mobile Antwortoptionen und `overflowX=0`; der aktuelle Quellen-Default wurde mit F80 als sichtbarer Materialanker weiter verbessert.
- Playwright Chromium providerneutrale Materialverarbeitung: grün mit `DATABASE_URL=postgres://michaelwelsch@127.0.0.1:55432/learnbuddy_f77` und `LEARNBUDDY_JOB_PROVIDER=inline` für Quellen-Kontextfläche, `Material verarbeiten`, sichtbaren Abschlussstatus, `provider=inline`, `provider_job_id`, Mobile-Fit und Fehlpfad ohne rohen `LEARNBUDDY_JOB_PROVIDER`-Text.
- Playwright Chromium WYSIWYG-Studio ohne kryptische Formular-UX: grün für Folie als primäres Arbeitsobjekt, Objektaktionen `Fragen`, `Quellen` und `Auswertung`, foliennahe Layer statt Formularliste, einspaltige Antwortkarten, entfernte Prompt-/Providerdetails, Desktop- und 390px-Mobile-Fit ohne horizontalen Overflow.
- Playwright Interactive konfigurierbares Leaderboard: grün mit `DATABASE_URL=postgres://michaelwelsch@127.0.0.1:55432/learnbuddy_f77` für Referenten-Plan-Chip, API-/Postgres-Persistenz von `leaderboard_enabled=false/true`, Student Live und Learn ohne beziehungsweise mit Leaderboard-Button und Modal, 390px Mobile-Fit und keine unerwarteten Console-/Network-/Page-Fehler.
- Direkte Postgres-Gegenprobe: `lectures.public_token=gleitlagerung-demo` enthält `leaderboard_enabled=true` nach finalem Wieder-Einschalten; im Off-Teil des Browserflows lief die API mit `leaderboardEnabled=false`.
- Playwright Production-Smoke 30 Studierende: grün gegen `learnbuddy_e2e_smoke` für 30 pseudonyme `answer_selected`-Sessions über `/api/events` mit serverseitig verifizierten Antwortschlüsseln, Leaderboard-API mit Top-10 und `self=true` für `Load 01`, sowie frischen Student-Browser mit sichtbarem Modal `1 · Load 01` und `12` Punkten.
- Live-Smoke-Script: `npm run smoke:live -- --url <app-url> --lecture-token gleitlagerung-demo` prüft öffentliche Health-, Student-Live- und Learn-Flows in einem frischen Chromium-Kontext; `--auth --require-auth` nutzt nur einen explizit übergebenen Magic Link, verlangt dieselbe Origin wie die geprüfte App und leakt keine Tokens in der JSON-Ausgabe. `--include-assistant --require-assistant-provider` prüft zusätzlich das Referentenstudio-Overlay, Reload-Persistenz und den sichtbaren Provider-Schritt. Rote Checks stehen zusätzlich unter `blockers`.
- Deploy-Readiness-Script: `npm run deploy:readiness -- --environment preview` liefert einen maschinenlesbaren Blockerbericht für Vercel-Link, `vercel.json`-Next-Preset, Worker-Cron und Pflicht-Env-Namen; rote Checks erscheinen zusätzlich kompakt unter `blockers`. `npm run deploy:readiness -- --environment preview --pull-vercel-env --scope metric-spaces-projects` prüft zusätzlich die echten Zielwerte ohne Secret-Ausgabe, inklusive produktionsfähiger Provider-Modi, öffentlicher Provider-Endpunkte, Placeholder-Secrets und Mail-Sender. Vercel CLI ist installiert und authentifiziert, das Projekt ist mit `metric-spaces-projects/learn-buddy` verlinkt, Neon `damp-sun-55979489` ist migriert und Vercel Blob `learn-buddy-artifacts` ist verbunden; Preview kann `VERCEL_URL` statt statischer `NEXT_PUBLIC_APP_URL` nutzen. Aktueller Preview-Stand: 14/15 Checks grün, `provider_mode_values` grün, rot bleibt nur `required_env` für die noch fehlenden echten Werte für Resend, CTOX/LLM-Proxy, Embeddings, OCR und STT-Provider.
- Release-Gate-Script: `npm run release:gate -- --mode full --url <app-url> --lecture-token gleitlagerung-demo --email referent@your-university.edu` ist der Sammelpunkt für eine spätere Freigabe. Der echte Resend-Magic-Link wird über `LEARNBUDDY_RELEASE_GATE_MAGIC_LINK` gesetzt und muss eine absolute HTTPS-URL derselben Origin wie `<app-url>` sein sowie den Pfad `/auth/magic` mit `token`-Parameter haben; `--pull-vercel-env --scope metric-spaces-projects` lädt die Vercel-Ziel-Env temporär in den Prozess, löscht die Datei direkt wieder und lässt Deploy-Readiness, Provider-Smoke und Admin-Preflight gegen diese Zielwerte laufen. Vercel-Full-Gates verlangen Env-Pull; Self-Hosting-Full-Gates nutzen stattdessen `--self-host` und damit `process.env` plus `deploy:readiness --self-host`. Ein bewusstes CI-Diagnosegate kann weiter `--allow-process-env` verwenden, setzt aber ohne vollständige Checks kein `releaseReady=true`. `--mode preview-baseline` darf Teilsmokes orchestrieren, setzt aber ausdrücklich `releaseReady=false` und `productionReady=false`. Aktueller Preview-Baseline-Lauf mit Vercel-Env-Pull, öffentlichem Live-Smoke und Worker-/Storage-Smoke ist grün; Full-Gate bleibt bis zu Resend-/LLM-/Question-Generator-/Embedding-/OCR-/STT-Providerwerten offen. Das Gate führt den Admin-Preflight selbst aus, nutzt dabei `preview` für Preview-Ziele und `production` für Production-Ziele, gibt dem Preview-Preflight die geprüfte URL als lokale `VERCEL_URL`, blockiert Full-Gates auf nicht öffentlichen HTTPS-Zielen und verlangt in Production dieselbe Origin für `--url` und `NEXT_PUBLIC_APP_URL`. Mock-Provider sind im Full-Gate blockiert.
- Playwright `next start` Retention-Report: grün mit `DATABASE_URL=postgres://michaelwelsch@127.0.0.1:55432/learnbuddy_f88_retention` für 401-Schutz der Retention-API, Magic-Link-Login, Studio-Inspector `Daten`, manuelles `Prüfen`, `9 Datensätze älter als`, Reload-Persistenz, Logout-Schutz, 390px Mobile-Fit und keine unerwarteten Console-/Network-/Page-Fehler.
- Admin-CLI Retention-Report: grün für `npm run admin -- retention-report --years 5 --lecture-token gleitlagerung-demo`; gezählter Altbestand `staleTotal=9` über pseudonyme Sitzungen, Analytics-Events, Chatfragen, Transkriptsegmente, Materialien, Materialverarbeitungsläufe, Frage-Reviews, Standalone-Exporte und Archivjobs.
- Playwright E2E Retention-Cleanup: grün im Standard-Smoke gegen `learnbuddy_e2e_smoke`; der Test legt alte Sessions, Analytics-Events, Antworten, Chatfragen, Transkriptsegmente und ein altes Material an, prüft Dry-Run, bestätigtes Apply, redigierte DB-Zeilen und die geschützte Retention-API nach Referentenlogin.
- Playwright `next start` Standalone-A11y-Export: grün mit `DATABASE_URL=postgres://michaelwelsch@127.0.0.1:55432/learnbuddy_f89_accessible_export` für Magic-Link-Login, Dashboard-Download `HTML`, Offline-Render per `file://`, Manifest-/Datenprüfung auf `WCAG 2.2 AA baseline`, `externalAssetCount=0`, Skip-Link als ersten Fokus, Pfeiltasten-/Home-Navigation, Antwort per Enter, `role=status`-Feedback, sichtbaren Fokus und 390px Mobile-Fit.
- Artefakte: `output/playwright/f89-standalone-accessible.html`, `output/playwright/f89-standalone-accessible-offline.png`, `output/playwright/f89-standalone-accessible-mobile.png`.
- Admin-CLI Backup/Restore: grün für Quell-DB `learnbuddy_f90_backup_source`, `npm run admin -- backup-sql --out output/f90-learnbuddy-backup.sql`, Restore in frische Ziel-DB `learnbuddy_f90_backup_restore`, `status` mit `users=1`, `series=1`, `lectures=1`, `slides=3`, `question_variants=4` und Schutzpfad gegen Restore in nicht-leere DB.
- Playwright `next start` Restore-UI: grün mit `DATABASE_URL=postgres://michaelwelsch@127.0.0.1:55432/learnbuddy_f90_backup_restore` für Magic-Link-Login, restaurierte Vorlesung `Gleitlagerung`, drei Folien, Exportlinks, Dashboard-Reload, Logout-Schutz und 390px Mobile-Fit.
- Artefakte: `output/f90-learnbuddy-backup.sql`, `output/f90-restore-nonempty.log`, `output/playwright/f90-restored-dashboard.png`, `output/playwright/f90-restored-dashboard-mobile.png`.
- Playwright Interactive Quellen-WYSIWYG-Materialanker: grün für sofort sichtbaren Materialanker, Datei/Link/Notiz-Umschaltung, URL- und Notiz-Eingabe, versteckten funktionsfähigen File-Input mit sichtbarem PDF-Dateinamen, bestehende Quelle am Slide, Desktop- und 390px-Mobile-Fit ohne horizontalen Overflow.
- Playwright Interactive Uploadgrößenlimit: grün mit `DATABASE_URL=postgres://michaelwelsch@127.0.0.1:55432/learnbuddy_f77` und `LEARNBUDDY_MAX_UPLOAD_BYTES=1024` für UI-Redirect in den Quellenkontext, genau eine sichtbare Fehlermeldung, direkte API-413-Gegenprobe mit `code=material_upload_too_large`, kleinen erfolgreichen Upload unter Limit, Desktop-/Mobile-Fit und fehlende Persistenz der abgelehnten Dateien.
- Direkte Postgres-Gegenprobe: `lecture_assets` enthält `api-small-f81.pdf` mit `size_bytes=128`, aber keine `too-large-f81.pdf` oder `api-too-large-f81.pdf`.
- Playwright CLI WYSIWYG-Studio ohne kryptischen Plan-/Quellen-Drawer: grün für Magic-Link-Login, Grundansicht ohne rechte Formularspalte, direkte Plan-Chips, Quellen als Slide-Overlay, Plan-Chip schließt Quellen-Overlay, Linkmodus bleibt im Overlay, 390px Mobile unter den Hotspots und oberhalb der Bottom-Bar, keine Console-Fehler.
- Playwright Interactive Chatfragen: grün für fachliche und fachfremde Student-Live-Fragen, sichtbares Feedback, Dashboard-Anzeige mit `Übernommen`/`Ignoriert`, Review-Kandidat, Reload-Persistenz, sauberen Dashboard-Reload und Mobile-Fit.
- Direkte Postgres-Gegenprobe: `student_chat_questions` enthält `accepted` mit `source_topic=gleitlager` und `ignored` mit Begründung; `question_review_items` enthält den erzeugten `Chatfrage:`-Review-Kandidaten.
- Playwright Interactive Live-Transkript: grün für Dozenten-Live-STT, Übernahme eines Transkriptsegments, sichtbares Feedback, Dashboard-Anzeige mit `Fragequelle`, `Transkript:`-Review-Kandidat, unauthentifizierten 401-Schutzpfad, Reload-Persistenz, sauberen Dashboard-Reload und Mobile-Fit.
- Direkte Postgres-Gegenprobe: `transcript_segments` enthält `accepted` mit `provider=voxtral-realtime` und `source_topic=stribeck`; `question_review_items` enthält den erzeugten `Transkript:`-Review-Kandidaten.
- Playwright Interactive Standalone-Export: grün für Dashboard-Download, versionierten Dateinamen, SHA-Header, Manifest-SHA-Header, gerenderte Export-Metadaten, Offline-Manifest, statisch gerenderte Folien/Fragen, Data-URI-Audio-Fallback, lokale Quizinteraktion, Dashboard-Reload, unbekannten Token mit 404 und Mobile-Fit.
- Direkte Postgres-Gegenprobe: `standalone_exports` enthält Exporte mit `storage_url=/api/lecture/gleitlagerung-demo/export`, 64-stelliger SHA-256-Prüfsumme und `created_at`.
- Playwright Interactive Mailflow: grün mit `LEARNBUDDY_MAIL_PROVIDER=console` für lokalen Testlink, Login, authentifizierten Reload, Logout und erneut blockierten Zugriff auf `/lecturer`.
- Playwright Interactive Mailflow: grün mit `LEARNBUDDY_MAIL_PROVIDER=blackhole` für externen Mailmodus ohne Link-Leak im UI oder API-Payload, 400 bei ungültiger E-Mail, keine implizite Authentifizierung und Mobile-Fit.
- API-Gegenprobe Mailflow: Bei gesetztem `NEXT_PUBLIC_APP_URL` erzeugt ein manipulierter `Origin`-Header keinen fremden Link-Host.
- `npm run db:generate`: grün, Migration `0006_spotty_dazzler.sql` ergänzt `lectures.ai_daily_limit` und `lectures.ai_daily_token_limit`.
- `npm run db:migrate`: grün gegen temporäres Postgres 18 inklusive F37.
- Playwright Interactive KI-Budget pro Vorlesung: grün für Budgetedit im Referenten-Dashboard, Reload-Persistenz, erste Learn-KI-Antwort, zweite Learn-KI-Anfrage mit 429-Block, Dashboard-Analytics und Mobile-Fit.
- Direkte Postgres-Gegenprobe: `lectures.public_token=gleitlagerung-demo` enthält `ai_daily_limit=1` und `ai_daily_token_limit=5000`; `analytics_events` enthält `ai_chat_answered=2`, `ai_chat_blocked=2`, `ai_chat_requested=4`.
- Playwright Interactive Fragequalitätsdashboard: grün für drei frische Student-Live-Sessions, 2 falsche und 1 richtige Antwort, sichtbare Fragequalitätskarte mit 33% korrekt, häufiger falscher Antwort, Prioritätsempfehlung, Dashboard-Reload und 390px Mobile-Fit ohne Console-/Network-Fehler.
- Direkte Postgres-Gegenprobe: drei `answer_selected`-Events enthalten `questionText`, `selectedAnswerText`, `correctAnswerText`, `level=2.0` und `correct=true/false`.
- Migration `0007_needy_drax.sql`: dedupliziert vorhandene Race-Duplikate in `participant_sessions`, hängt Referenzen in `analytics_events`, `answers` und `student_chat_questions` um und erstellt `participant_sessions_lecture_anonymous_idx`.
- Playwright Interactive Analytics-Zeitverlauf: grün für Live-Antworten und Learn-Evaluation über drei Zeit-Buckets, Dashboard-Reload, 390px Mobile-Fit, schnelle Join-/Antwortfolge und keine neuen doppelten `participant_sessions`.
- Direkte Postgres-Gegenprobe: `answer_selected=3`, `student_joined=3`, `evaluation_submitted=1`, `participant_sessions=4`, `distinct anonymous_key=4`, keine doppelten anonymen Schlüssel.
- Migration `0008_soft_tempest.sql`: ergänzt `lectures.evaluation_config` und setzt Defaults für bestehende Vorlesungen.
- Playwright Interactive Evaluation Builder: grün für Builder-Edit im Referenten-Dashboard, Reload-Persistenz, Learn-Modus mit konfigurierten Labels, Evaluation-Submit, Analytics-Dashboard mit denselben Labels, deaktivierten Zustand ohne Learn-Button und 390px Mobile-Fit.
- Direkte Postgres-Gegenprobe: `lectures.evaluation_config` enthält `enabled=true`, `title=Lerncheck nach der Einheit`, `understandingLabel=Gleitlager verstanden`, `submitLabel=Lerncheck senden`; `analytics_events.event_type=evaluation_submitted` enthält denselben Evaluationstitel, dieselben Labels und den Freitext `Builderlabels sind im Learn-Modus sichtbar.`
- Migration `0009_aspiring_songbird.sql`: ergänzt `lecture_series.evaluation_config` und setzt Default-Evaluationen für bestehende Reihen.
- Playwright Interactive Reihenvorlagen: grün für WYSIWYG-Evaluation-Builder, Speichern als `Reihenvorlage`, neue Vorlesung derselben Reihe mit geerbten Labels, andere Reihe ohne Vererbung, Learn-Modus mit geerbter Evaluation, Dashboard-Reload und 390px Mobile-Fit ohne Console-/Network-Fehler.
- Direkte Postgres-Gegenprobe: `lecture_series.title=Maschinenelemente I` enthält `evaluation_config.title=Reihenevaluation Maschinenelemente WYSIWYG`; `Schmierstoffauswahl WYSIWYG 2` erbt denselben Titel, `Werkstoffkunde II` und `Werkstoffauswahl WYSIWYG 2` bleiben auf `Evaluation`.
- Keine neue Schema-Migration für F42 nötig; `evaluation_config` enthält `version` und `updatedAt`.
- Playwright Interactive Referentenstudio und Evaluation-Versionen: grün für Canvas/Inspector-Dashboard statt Formularliste, WYSIWYG-Evaluation, Quizkarten-Fragenreview, Review-Edit, Learn-Evaluation für Version 3 und 4, Analytics-Versionsverlauf, Dashboard-Reload, Console-/Network-Check und 390px Mobile-Fit.
- Direkte Postgres-Gegenprobe: `analytics_events.event_payload` enthält `evaluationVersion=3` mit `Evaluation Runde 2` und `evaluationVersion=4` mit `Evaluation Runde 3`; `lectures.live_at` bleibt nach erneutem Speichern stabil bei `2026-06-17 12:00:00+02` (`10:00Z`).
- Keine neue Schema-Migration für direkte WYSIWYG-Folienbearbeitung nötig; `slides` wird über die bestehende Tabelle aktualisiert.
- Playwright Interactive WYSIWYG-Folienbearbeitung: grün für direkte Bearbeitung von Folientitel, Copy und Thema auf dem Slide-Canvas, Speichern, Dashboard-Reload, Learn-/Dozent-Live-Sicht mit aktualisiertem Slide, Logout-Schutz und 390px Mobile-Fit ohne Console-/Network-Fehler.
- Keine neue Schema-Migration für F43 nötig; Themencluster aggregieren bestehende `analytics_events`.
- Playwright Interactive Themencluster: grün für zwei falsche Live-Antworten, eine Learn-KI-Frage, eine Learn-Evaluation, sichtbaren Cluster `Mischreibung und Verschleiß`, `riskLevel=hoch`, Evidenz, Empfehlung, authentifizierte Aggregates-API, Dashboard-Reload, Logout-Schutz und 390px Mobile-Fit ohne Console-/Network-/Page-Fehler.
- Direkte Postgres-Gegenprobe: `analytics_events` enthält für `gleitlagerung-demo` `answer_selected=2`, `ai_chat_requested=1`, `evaluation_submitted=1`; Aggregates-API liefert als ersten Cluster `Mischreibung und Verschleiß` mit `signalCount=5`, `wrongAnswers=2`, `aiQuestions=1`, `evaluationMentions=1`, `riskLevel=hoch`.
- Keine neue Schema-Migration für F44 nötig; Reihenverläufe aggregieren vorhandene `lectures`, `lecture_series`, `participant_sessions` und `analytics_events`.
- Playwright Interactive Reihenverlauf: grün für zweite Vorlesung `Stribeck Folge F44` in derselben Reihe, falsche Student-Live-Antwort in `gleitlagerung-demo`, richtige Student-Live-Antwort in `Stribeck Folge F44`, sichtbaren Reihenverlauf mit `0% korrekt` -> `100% korrekt`, authentifizierte Aggregates-API, Dashboard-Reload, Logout-Schutz und 390px Mobile-Fit ohne Console-/Network-/Page-Fehler.
- Direkte Postgres-Gegenprobe: `gleitlagerung-demo` enthält `answer_selected=1` mit `0` korrekten Antworten, `stribeck-folge-f44-93b84c` enthält `answer_selected=1` mit `1` korrekter Antwort; Aggregates-API liefert `seriesTrend.items` für beide Vorlesungen und die Empfehlung `Verbesserung gegenüber "Gleitlagerung"`.
- Keine neue Schema-Migration für F45 nötig; Verbesserungsvorschläge aggregieren bestehende Analytics- und Vorlesungsdaten.
- Playwright Interactive Verbesserungsvorschläge: grün für drei Student-Live-Antworten, eine niedrige Learn-Evaluation, sichtbare Vorschläge zu Verständnis, Themencluster, Fragequalität und Tempo, lesbare deutsche Quellenlabels, authentifizierte Aggregates-API, Dashboard-Reload, unauthentifizierten 401-Schutz, Logout-Schutz und 390px Mobile-Fit ohne Console-/Network-/Page-Fehler.
- Direkte Postgres-Gegenprobe: `analytics_events` enthält `answer_selected=3`, `evaluation_submitted=1`, `student_joined=4`; die Mischreibungsfrage hat `3` Antworten mit `1` korrekter Antwort, und die Evaluation speichert `understanding=2`, `pace=2`, Kommentar `Tempo bei Mischreibung war zu schnell.`.
- Keine neue Schema-Migration für F46 nötig; Änderungsentwürfe schreiben in vorhandene `slides`, `questions` und `question_variants`.
- Playwright Interactive Änderungsentwürfe: grün für sichtbare Folien- und Fragenentwürfe mit Vorher/Nachher, Übernahme beider Entwürfe, übernommene Buttonzustände, WYSIWYG-Folienfeld, Learn-Slide, Student-Live-Frage, Dashboard-Reload, Logout-Schutz und 390px Mobile-Fit. Erwartete 401/404-Schutzantworten wurden separat geprüft.
- Direkte Postgres-Gegenprobe: `slides.content_json` enthält auf `Auslegung beim Anfahren` die Ergänzung `Transferanker: Ursache, Kontaktzustand und konstruktive Gegenmaßnahme...`; `question_variants.level=2.0` enthält die aktualisierte Mischreibungsfrage samt geänderter Antworttexte.
- Keine neue Schema-Migration für F47 nötig; Review-Historie nutzt `analytics_events.event_type=improvement_draft_applied`.
- Playwright Interactive Review-Historie: grün für zwei übernommene Entwürfe, sichtbaren Verlauf `Übernommene Änderungen`, Aggregates-API mit zwei `improvementHistory.items`, Dashboard-Reload, Logout-Schutz und 390px Mobile-Fit.
- Direkte Postgres-Gegenprobe: `analytics_events` enthält `improvement_draft_applied=2`; Payloads speichern `kind`, `targetLabel`, `title`, `after` und `appliedBy=referent@example.com`.
- Playwright Interactive gegen `npm start`: öffentlicher Learn-Drawer im gebauten Server grün ohne Console-/Network-Fehler. Authentifizierter lokaler `next start`-Login braucht HTTPS oder eine Testkonfiguration, weil der Produktionspfad das Session-Cookie korrekt mit `Secure` setzt.
- Screenshot: `output/playwright/postgres-lecturer-review-e2e.png`.
- Screenshot: `output/playwright/postgres-analytics-student-live.png`.
- Screenshot: `output/playwright/postgres-analytics-dashboard.png`.
- Screenshot: `output/playwright/postgres-material-pipeline-dashboard.png`.
- Screenshot: `output/playwright/postgres-material-pipeline-mobile.png`.
- Screenshot: `output/playwright/postgres-review-metadata-edited.png`.
- Screenshot: `output/playwright/postgres-review-metadata-mobile.png`.
- Screenshot: `output/playwright/learn-evaluation-submitted.png`.
- Screenshot: `output/playwright/postgres-evaluation-dashboard.png`.
- Screenshot: `output/playwright/postgres-evaluation-dashboard-mobile.png`.
- Screenshot: `output/playwright/learn-ai-usage-success.png`.
- Screenshot: `output/playwright/learn-ai-expired-blocked.png`.
- Screenshot: `output/playwright/postgres-ai-usage-dashboard.png`.
- Screenshot: `output/playwright/postgres-ai-usage-dashboard-mobile.png`.
- Screenshot: `output/playwright/learn-ai-rate-limit-blocked.png`.
- Screenshot: `output/playwright/postgres-ai-rate-limit-dashboard.png`.
- Screenshot: `output/playwright/postgres-ai-rate-limit-dashboard-mobile.png`.
- Screenshot: `output/playwright/learn-ai-retrieval-token-budget.png`.
- Screenshot: `output/playwright/postgres-ai-retrieval-budget-dashboard-analytics.png`.
- Screenshot: `output/playwright/postgres-ai-retrieval-budget-dashboard-mobile-analytics.png`.
- Screenshot: `output/playwright/prod-learn-drawer.png`.
- Screenshot: `output/playwright/url-material-dashboard-materials.png`.
- Screenshot: `output/playwright/url-material-learn-ai-source.png`.
- Screenshot: `output/playwright/url-material-dashboard-mobile.png`.
- Screenshot: `output/playwright/upload-extraction-dashboard.png`.
- Screenshot: `output/playwright/upload-extraction-learn-ai-source.png`.
- Screenshot: `output/playwright/upload-extraction-dashboard-mobile.png`.
- Screenshot: `output/playwright/material-job-status-dashboard.png`.
- Screenshot: `output/playwright/material-job-status-reload.png`.
- Screenshot: `output/playwright/material-job-status-empty-run.png`.
- Screenshot: `output/playwright/material-job-status-mobile.png`.
- Screenshot: `output/playwright/student-chat-question-live.png`.
- Screenshot: `output/playwright/student-chat-question-dashboard.png`.
- Screenshot: `output/playwright/student-chat-question-dashboard-reload.png`.
- Screenshot: `output/playwright/student-chat-question-dashboard-mobile.png`.
- Screenshot: `output/playwright/live-transcript-segment.png`.
- Screenshot: `output/playwright/live-transcript-dashboard-section.png`.
- Screenshot: `output/playwright/live-transcript-review-section.png`.
- Screenshot: `output/playwright/live-transcript-dashboard-reload.png`.
- Screenshot: `output/playwright/live-transcript-dashboard-mobile.png`.
- Screenshot: `output/playwright/standalone-export-html-render.png`.
- Screenshot: `output/playwright/standalone-export-dashboard.png`.
- Screenshot: `output/playwright/standalone-export-dashboard-mobile.png`.
- Download-Artefakt: `output/playwright/standalone-export-download.html`.
- Screenshot: `output/playwright/mail-console-login.png`.
- Screenshot: `output/playwright/mail-external-login.png`.
- Screenshot: `output/playwright/mail-external-login-mobile.png`.
- Screenshot: `output/playwright/ai-budget-dashboard-edit.png`.
- Screenshot: `output/playwright/ai-budget-learn-blocked.png`.
- Screenshot: `output/playwright/ai-budget-dashboard-analytics.png`.
- Screenshot: `output/playwright/ai-budget-dashboard-mobile.png`.
- Screenshot: `output/playwright/evaluation-builder-dashboard.png`.
- Screenshot: `output/playwright/evaluation-builder-learn.png`.
- Screenshot: `output/playwright/evaluation-builder-analytics.png`.
- Screenshot: `output/playwright/evaluation-builder-dashboard-mobile.png`.
- Screenshot: `output/playwright/series-evaluation-wysiwyg-v2-builder-centered.png`.
- Screenshot: `output/playwright/series-evaluation-wysiwyg-v2-mobile-fixed.png`.
- Screenshot: `output/playwright/series-evaluation-wysiwyg-v2-learn.png`.
- Screenshot: `output/playwright/series-evaluation-wysiwyg-v2-other-series.png`.
- Screenshot: `output/playwright/wysiwyg-studio-edited-persisted.png`.
- Screenshot: `output/playwright/wysiwyg-studio-mobile-final.png`.
- Screenshot: `output/playwright/topic-clusters-learn-ai.png`.
- Screenshot: `output/playwright/topic-clusters-evaluation-submitted.png`.
- Screenshot: `output/playwright/topic-clusters-dashboard-dev.png`.
- Screenshot: `output/playwright/topic-clusters-dashboard-mobile.png`.
- Screenshot: `output/playwright/f45-improvement-suggestions-dashboard-clean.png`.
- Screenshot: `output/playwright/f45-improvement-suggestions-evaluation.png`.
- Screenshot: `output/playwright/f45-improvement-suggestions-mobile-full.png`.
- Screenshot: `output/playwright/f45-logout-protected.png`.
- Screenshot: `output/playwright/f46-improvement-drafts-dashboard.png`.
- Screenshot: `output/playwright/f46-improvement-drafts-applied-state-fixed.png`.
- Screenshot: `output/playwright/f46-learn-slide-draft-visible.png`.
- Screenshot: `output/playwright/f46-live-question-updated.png`.
- Screenshot: `output/playwright/f46-improvement-drafts-mobile-final.png`.
- Screenshot: `output/playwright/f46-logout-protected.png`.
- Screenshot: `output/playwright/f47-drafts-before-apply.png`.
- Screenshot: `output/playwright/f47-history-dashboard.png`.
- Screenshot: `output/playwright/f47-history-reload.png`.
- Screenshot: `output/playwright/f47-history-mobile.png`.
- Screenshot: `output/playwright/f47-logout-protected.png`.
- Screenshot: `output/playwright/f48-wysiwyg-question-stage.png`.
- Screenshot: `output/playwright/f48-wysiwyg-evaluation-stage.png`.
- Screenshot: `output/playwright/f48-wysiwyg-material-stage.png`.
- Screenshot: `output/playwright/f48-wysiwyg-mobile-question.png`.
- Playwright Interactive strukturierte Änderungsdiffs: grün mit `DATABASE_URL=postgres://michaelwelsch@127.0.0.1:55432/learnbuddy_f49` für Magic-Link-Login, Antwort-/Evaluationssignale, Änderungsentwürfe, Übernahme von Folien- und Fragenentwurf, feldweise History-Diffs, Aggregates-API, Reload, Logout-Schutz und 390px Mobile-Fit.
- Direkte Postgres-Gegenprobe: `analytics_events.event_type=improvement_draft_applied` enthält `event_payload.diff` mit `slide|1|Folientext` und `question|4|Fragetext`.
- Screenshot: `output/playwright/f49-structured-diff-drafts.png`.
- Screenshot: `output/playwright/f49-structured-diff-history.png`.
- Screenshot: `output/playwright/f49-structured-diff-mobile.png`.
- Playwright Interactive KI-Kostenbericht: grün mit `DATABASE_URL=postgres://michaelwelsch@127.0.0.1:55432/learnbuddy_f50`, `LEARNBUDDY_AI_COST_WARNING_EUR=0.00001` und `LEARNBUDDY_AI_COST_CRITICAL_EUR=0.00002` für Learn-KI-Chat, Tokenbudgetanzeige, Referenten-Magic-Link-Login, Analytics-Kostenbericht, kritische Kostenwarnung, Aggregates-API, Reload, Logout-Schutz und 390px Mobile-Fit.
- Direkte Postgres-Gegenprobe: `ai_chat_answered` enthält `tokens.input=33`, `tokens.output=87`, `costEstimate.estimatedEur=0.000057`, `provider=learnbuddy-demo` und `model=scoped-demo`.
- Screenshot: `output/playwright/f50-ai-cost-learn-chat.png`.
- Screenshot: `output/playwright/f50-ai-cost-dashboard.png`.
- Screenshot: `output/playwright/f50-ai-cost-mobile.png`.
- Playwright Interactive pgvector-Retrieval: grün mit `DATABASE_URL=postgres://michaelwelsch@127.0.0.1:55432/learnbuddy_f51` für Referenten-Magic-Link-Login, zwei Notizmaterialien über die Studio-UI, Materialverarbeitung, 2 gespeicherte Chunks, frischen Learn-KI-Chat mit sichtbarer Vektorquelle und Score, 390px Mobile-Fit und Logout-Schutz.
- Direkte Postgres-Gegenprobe: `asset_chunks` enthält `2` Embeddings mit `vector_dims=1536`; `ai_chat_answered.sources[0].retrievalMethod=vector` mit Scores `0.511` und `0.4512`.
- Screenshot: `output/playwright/f51-vector-material-processed.png`.
- Screenshot: `output/playwright/f51-vector-learn-chat.png`.
- Screenshot: `output/playwright/f51-vector-learn-mobile.png`.
- Keine neue Schema-Migration für F52 nötig; Wirkungsmessung nutzt bestehende `analytics_events`.
- Playwright Interactive Wirksamkeitsvergleich: grün für Magic-Link-Login, Antwortsignale vor und nach einer übernommenen Fragenänderung, sichtbaren `Wirksamkeitsvergleich`, Aggregates-API, Dashboard-Reload, DB-Gegenprobe, Logout-Schutz und 390px Mobile-Fit.
- Direkte Postgres-Gegenprobe: `analytics_events` enthält `answer_selected=6`, `student_joined=6`, `improvement_draft_applied=1`; `improvementImpact.items[0]` liefert `beforeCorrectRate=33`, `afterCorrectRate=100`, `delta=67`, `status=verbessert`.
- Screenshots: `output/playwright/f52-impact-dashboard.png`, `output/playwright/f52-impact-reload.png`, `output/playwright/f52-impact-mobile.png`.
- Keine neue Schema-Migration für F53 nötig; der Schnitt betrifft nur die Referentenstudio-UI.
- Playwright Interactive Präsentationsstudio: grün für Magic-Link-Login, Präsentationsmodus ohne `aside.workspace-inspector`, Deckdaten initial geschlossen, Folie mit 93% der Hauptpanelbreite, direkte Slide-Änderung, Speichern, Reload, Rücksetzen der Teständerung, Logout-Schutz und 390px Mobile-Fit.
- Mobile-Gegenprobe: `innerWidth=390`, `scrollWidth=390`, `overflowX=false`, keine Inspector-Spalte, optionale Deckdaten bedienbar.
- Screenshots: `output/playwright/f53-wysiwyg-deck-editor-normal.png`, `output/playwright/f53-wysiwyg-deck-editor-mobile.png`.
- Keine neue Schema-Migration für F54 nötig; Prompt-Historie und Qualitätsentscheidung werden in `question_review_items.variants_json` gespeichert.
- Playwright Interactive Prompt-Historie: grün mit `DATABASE_URL=postgres://michaelwelsch@127.0.0.1:55432/learnbuddy_f54` für Magic-Link-Login, Material vormerken, Materialverarbeitung, sichtbare `Prompt-Historie`, direkte Review-Änderung, sichtbaren `Review-Änderung`-Eintrag, Freigabe, sichtbare Qualitätsentscheidung, Dashboard-Reload, Logout-Schutz und 390px Mobile-Fit.
- Direkte Postgres-Gegenprobe: alle vier Niveaus enthalten `generation` und `decision`; die bearbeitete Niveau-2.0-Variante enthält zusätzlich `edit`; `qualityDecision.status=approved` und `qualityDecision.decidedBy=referent@example.com`.
- Screenshots: `output/playwright/f54-prompt-history-dashboard.png`, `output/playwright/f54-prompt-history-mobile.png`.
- Keine neue Schema-Migration für F55 nötig; NDJSON-Streaming nutzt `/api/ai/chat`, `analytics_events` und `asset_chunks`.
- Playwright Interactive KI-Streaming: grün mit `DATABASE_URL=postgres://michaelwelsch@127.0.0.1:55432/learnbuddy_f55` für Magic-Link-Login, Materialnotiz, Materialverarbeitung, Learn-KI-Chat mit `application/x-ndjson`, sichtbare Antwort, Quellenliste, Restbudget, direkten API-Stream mit Token-/Done-Events, Logout-Schutz und 390px Mobile-Fit.
- Direkte Postgres-Gegenprobe: `ai_chat_answered` enthält `streaming=true`, `tokens.total=190/204`, `sources[0].sourceRef=Planungsnotiz#chunk-1`, `sources[0].retrievalMethod=vector`; `asset_chunks` enthält `1` Chunk.
- Screenshots: `output/playwright/f55-material-processed.png`, `output/playwright/f55-ai-stream-learn.png`, `output/playwright/f55-ai-stream-mobile.png`, `output/playwright/f55-logout-protected.png`.
- Keine neue Schema-Migration für F56 nötig; Prompt-Registry wird in `question_review_items.variants_json` gespeichert.
- Playwright Interactive Prompt-Registry: grün mit `DATABASE_URL=postgres://michaelwelsch@127.0.0.1:55432/learnbuddy_f56` für Magic-Link-Login, Materialnotiz, Materialverarbeitung, sichtbare `Prompt-Registry`, direkte Review-Änderung mit sofort sichtbarer Revision 1, Freigabe mit `Freigegeben` und 92% Review-Confidence, Dashboard-Reload, Logout-Schutz und 390px Mobile-Fit.
- Direkte Postgres-Gegenprobe: Niveau-2.0-Varianten enthalten `promptRegistry.templateId=learnbuddy-mcq-20-v1`, `modelParameters.temperature=0.4`, `qualityMetrics.revisionCount=1`, `qualityMetrics.lastDecision=approved/draft` und `promptHistory` mit 3 beziehungsweise 2 Einträgen.
- Screenshots: `output/playwright/f56-prompt-registry-initial.png`, `output/playwright/f56-prompt-registry-approved.png`, `output/playwright/f56-prompt-registry-immediate-edit.png`, `output/playwright/f56-prompt-registry-mobile.png`, `output/playwright/f56-logout-protected.png`.
- Keine neue Schema-Migration für F57 nötig; `standalone_exports` persistiert weiterhin Version, Storage-URL, Response-SHA und Zeitstempel.
- Playwright Interactive Standalone-Export v2: grün mit `DATABASE_URL=postgres://michaelwelsch@127.0.0.1:55432/learnbuddy_f57` für Magic-Link-Login, echten Dashboard-Download über `Mehr` > `Standalone HTML`, `standalone-html-v2`-Dateiname, Response-SHA-Header, Manifest-SHA-Header, self-contained HTML, parsebares `learnbuddy-manifest`, parsebares `learnbuddy-data`, Data-URI-Audio-Fallback, `externalAssetCount=0`, lokale Quizantwort mit `Richtig.`, 404 bei unbekanntem Token, Dashboard-Reload mit letztem Export, Logout-Schutz und 390px Mobile-Fit.
- Direkte Postgres-Gegenprobe: `standalone_exports` enthält `4` v2-Exporte, alle mit 64-stelliger SHA-256-Prüfsumme und `storage_url=/api/lecture/gleitlagerung-demo/export`.
- Screenshots/Artefakte: `output/playwright/f57-dashboard-download.html`, `output/playwright/f57-standalone-offline-render.png`, `output/playwright/f57-standalone-offline-mobile.png`, `output/playwright/f57-standalone-dashboard.png`, `output/playwright/f57-standalone-dashboard-mobile.png`, `output/playwright/f57-logout-protected.png`.
- Keine neue Schema-Migration für F58 nötig; der STT-Proxy nutzt die bestehende `transcript_segments`-Tabelle und den bestehenden `STTProvider`.
- Playwright Interactive Browser-STT: grün mit `DATABASE_URL=postgres://michaelwelsch@127.0.0.1:55432/learnbuddy_f58` und Chromium-Fake-Mikrofon für Magic-Link-Login, Dozenten-Live-Modus, `getUserMedia`, MediaRecorder-Audio-Blob mit `7808` Bytes, POST auf `/api/lectures/:id/stt`, sichtbaren STT-Kandidat, 82% Konfidenz, Übernahme in `transcript_segments`, sichtbaren `Quelle`-Eintrag, Dashboard-Reload mit `Transkript:`-Review-Kandidat, sichtbaren Transkriptfeed, unauthentifizierten 401-Schutz, Logout-Schutz und 390px Mobile-Fit.
- Direkte Postgres-Gegenprobe: `transcript_segments` enthält `provider=voxtral-realtime`, `status=accepted`, `source_topic=stribeck`, Start-/Endzeit und `question_review_items` enthält genau einen `Transkript:`-Review-Kandidaten.
- Screenshots: `output/playwright/f58-live-stt-proxy.png`, `output/playwright/f58-live-stt-dashboard-review.png`, `output/playwright/f58-live-stt-source-feed.png`, `output/playwright/f58-live-stt-mobile.png`, `output/playwright/f58-logout-protected.png`.
- Keine neue Schema-Migration für F59 nötig; der Schnitt betrifft nur das Referentenstudio und nutzt bestehende Lecture-, Slide-, Asset- und Review-Tabellen.
- Playwright Interactive WYSIWYG-Studio UX: grün mit `DATABASE_URL=postgres://michaelwelsch@127.0.0.1:55432/learnbuddy_f59` für Magic-Link-Login, fullscreen-nahe Slide-Bühne ohne rechte Formularspalte, Quellen-Layer, Materialnotiz, Verarbeitung zu einem Review mit 4 Varianten, Quiz-Drawer im Live-Layout mit deutschen Statuslabels, direkte Folientitelbearbeitung, Speichern, Dashboard-Reload, neues Vorlesungs-Popover, Logout-Schutz und 390px Mobile-Fit.
- Direkte Postgres-Gegenprobe: `lectures=1`, Status `question_review`, erster `slides.title=Hydrodynamische Gleitlagerung und WYSIWYG Studio`, `lecture_assets=1`, `question_review_items=1`, `question_variants=4`.
- Screenshots: `output/playwright/f59-studio-desktop-final-clean.png`, `output/playwright/f59-studio-desktop-quiz-final.png`, `output/playwright/f59-studio-sources-overlay.png`, `output/playwright/f59-studio-create-popover.png`, `output/playwright/f59-studio-mobile-final.png`, `output/playwright/f59-studio-mobile-quiz-v2.png`, `output/playwright/f59-studio-logout-protected.png`.
- Keine neue Schema-Migration für F60/F61/F62 nötig; bestehende Tabellen decken Chatfrage-Moderation, Slide-Content und Review-Varianten ab.
- Playwright Interactive Chatfrage-Steuerung: grün mit `DATABASE_URL=postgres://michaelwelsch@127.0.0.1:55432/learnbuddy_f60_f61` für fachfremde Frage manuell übernehmen, fachliche Frage manuell ignorieren, genau einen verbleibenden `Chatfrage:`-Review, 401-Schutz der Moderationsroute, Dashboard-Reload, Logout-Schutz und 390px Mobile-Fit.
- Direkte Postgres-Gegenprobe: `student_chat_questions` enthält `accepted` für `MensaF60` und `ignored` für `LagerF60`; `question_review_items` enthält genau einen `Chatfrage:`-Review.
- Playwright Interactive Direkter Slide-Editor: grün für `contenteditable`-Bearbeitung von Folientitel und Copy mit Umlauten, Speichern, Reload-Persistenz, Rücksetzung der Teständerung, Toolwechsel bei offenem Drawer und Mobile-Fit.
- Direkte Postgres-Gegenprobe: erster Slide steht nach Rücksetzung wieder auf `Hydrodynamische Gleitlagerung`, `Stribeck-Kurve` und ursprünglichem ersten Copy-Satz.
- Playwright Interactive WYSIWYG-Quiz-Direkteditor: grün für direkte Bearbeitung von Review-Frage und Antwort B in der sichtbaren Quizkarte, Umlaute, Speichern, Dashboard-Reload, Rücksetzung der Teständerung, mobilen 390px Quiz-Drawer ohne verdeckte Aktionen und ohne horizontalen Overflow.
- Screenshots: `output/playwright/f60-chat-signals-after.png`, `output/playwright/f60-chat-review-after.png`, `output/playwright/f61-direct-slide-edited.png`, `output/playwright/f61-direct-slide-restored.png`, `output/playwright/wysiwyg-quiz-open.png`, `output/playwright/wysiwyg-quiz-restored.png`, `output/playwright/wysiwyg-mobile-quiz-wide.png`.
- Keine neue Schema-Migration für F63 nötig; `student_chat_questions` wird als zusätzliche Signalquelle der bestehenden Analytics-Aggregation genutzt.
- `npm run db:migrate`: grün gegen frisches lokales Postgres `learnbuddy_f63`.
- Playwright Interactive Chatfrage-Cluster: grün für zwei echte Student-Live-Chatfragen zu Mischreibung/Festkörperkontakt/Verschleiß, sichtbares Student-Feedback, Referenten-`Signale`-Drawer mit `Mischreibung und Verschleiß`, `2 Signale`, `2 Chatfragen`, `2 übernommen`, `HOCH`, Dashboard-Reload, Logout-Schutz und 390px Mobile-Fit ohne Console-/Network-/Page-Fehler.
- Aggregates-API-Gegenprobe: `summary.topicClusters.items[0]` liefert `topic=Mischreibung und Verschleiß`, `signalCount=2`, `chatQuestions=2`, `acceptedChatQuestions=2`, `riskLevel=hoch` und beide Chatfragen als Evidenz.
- Direkte Postgres-Gegenprobe: `student_chat_questions` enthält `ClusterA63` und `ClusterB63` jeweils `accepted`; `question_review_items` enthält `2` `Chatfrage:`-Review-Kandidaten.
- Screenshots: `output/playwright/f63-chat-cluster-student-a.png`, `output/playwright/f63-chat-cluster-student-b.png`, `output/playwright/f63-chat-cluster-dashboard-v2.png`, `output/playwright/f63-chat-cluster-mobile-final.png`, `output/playwright/f63-chat-cluster-logout-protected.png`.
- Migration `0010_striped_tinkerer.sql`: ergänzt `lecture_series.ai_daily_limit` und `lecture_series.ai_daily_token_limit`.
- `npm run db:migrate`: grün gegen frisches lokales Postgres `learnbuddy_f64`.
- Playwright Interactive KI-Reihenbudget: grün für Magic-Link-Login, Setzen von Vorlesungslimit `5` und Reihenlimit `1` über die Planungs-Chips, erste Learn-KI-Antwort mit sichtbarem Restbudget, zweite Learn-KI-Anfrage mit sichtbarem `KI-Reihenlimit erreicht`, erwarteter 429-Block, Dashboard-Reload, Logout-Schutz und 390px Mobile-Fit ohne unerwartete Console-/Network-/Page-Fehler.
- Direkte Postgres-Gegenprobe: `lecture_series.title=Maschinenelemente I` enthält `ai_daily_limit=1`, `ai_daily_token_limit=12000`; `analytics_events` enthält `ai_chat_answered` mit `seriesLimit=1` und `ai_chat_blocked` mit `reason=series_rate_limit`.
- Screenshots: `output/playwright/f64-series-budget-dashboard.png`, `output/playwright/f64-series-budget-first-answer.png`, `output/playwright/f64-series-budget-blocked.png`, `output/playwright/f64-series-budget-mobile.png`, `output/playwright/f64-series-budget-logout-protected.png`.
- Migration `0011_faulty_beast.sql`: ergänzt `users.ai_daily_limit` und `users.ai_daily_token_limit`.
- `npm run db:migrate`: grün gegen frisches lokales Postgres `learnbuddy_f65`.
- Playwright Interactive KI-Mandantenbudget: grün für Magic-Link-Login, Setzen von Vorlesungslimit `5`, Reihenlimit `5` und Kontolimit `1` über die Planungs-Chips, erste Learn-KI-Antwort in frischem Kontext, zweite Learn-KI-Anfrage in anderem frischen Kontext mit sichtbarem `KI-Kontolimit erreicht`, erwarteter 429-Block, Dashboard-Reload, Logout-Schutz und 390px Mobile-Fit ohne unerwartete Console-/Network-/Page-Fehler.
- Direkte Postgres-Gegenprobe: `users.email=f65@example.test` enthält `ai_daily_limit=1`, `ai_daily_token_limit=12000`; `lecture_series.title=Maschinenelemente I` ist diesem User zugeordnet; `analytics_events` enthält `ai_chat_answered` mit `tenantLimit=1` und `ai_chat_blocked` mit `reason=tenant_rate_limit`.
- Screenshots: `output/playwright/f65-tenant-budget-dashboard.png`, `output/playwright/f65-tenant-budget-first-student.png`, `output/playwright/f65-tenant-budget-blocked.png`, `output/playwright/f65-tenant-budget-mobile.png`, `output/playwright/f65-tenant-budget-logout-protected.png`.
- `node --check scripts/admin.mjs`: grün.
- `npm run db:migrate`: grün gegen frisches lokales Postgres `learnbuddy_f66`.
- Admin-CLI: `seed-demo --owner f66@example.test`, erneutes `seed-demo`, `set-ai-budget --email f66@example.test --questions 7 --tokens 15000` und `status` grün; Counts bleiben idempotent bei `users=1`, `series=1`, `lectures=1`, `slides=3`, `question_variants=4`.
- Direkte Postgres-Gegenprobe: Nach CLI-Setup enthält `users.email=f66@example.test` zunächst `ai_daily_limit=7`, `ai_daily_token_limit=15000`; nach dem WYSIWYG-E2E speichert der Planungs-Chip `ai_daily_limit=9`, `lectures.status=ready_for_live` und `slides.content_json` enthält die direkt auf dem Slide bearbeitete Copy. `lecture_series.title=Maschinenelemente I`, `public_token=gleitlagerung-demo`, `slides=3`, `variants=4`.
- Playwright WYSIWYG-Studio/CLI-Seed: grün mit `LEARNBUDDY_AUTO_SEED=0` für Magic-Link-Login, CLI-geseedete Vorlesung, entfernten `Termin und Freigabe`-Block, direkte Slide-Copy-Bearbeitung mit Reload-Persistenz, Status-/Live-/Prüfungs-/KI-Planungs-Chips, aktive Frage im `Fragen prüfen`-Drawer, Quellen-Drawer, Learn-Hotspot, Logout-Schutz und 390px Mobile-Fit ohne unerwartete Console-/Network-/Page-Fehler.
- Screenshots: `output/playwright/f66-wysiwyg-studio-plan-chips.png`, `output/playwright/f66-wysiwyg-studio-persisted.png`, `output/playwright/f66-wysiwyg-question-drawer.png`, `output/playwright/f66-wysiwyg-sources-drawer.png`, `output/playwright/f66-wysiwyg-learn-link.png`, `output/playwright/f66-wysiwyg-studio-mobile.png`, `output/playwright/f66-wysiwyg-logout-protected.png`.
- Keine neue Schema-Migration für F67 nötig; die Änderung betrifft den Studio-Interaktionsvertrag und nutzt bestehende Lecture-, Material- und Review-Routen.
- `npm run typecheck`: grün.
- Playwright WYSIWYG-Studio-Entrümpelung: grün für Magic-Link-Login, keine dauerhafte Studio-Kopfleiste, Burger-Menü mit Vorlesungswahl und Links, automatisches Menüschließen beim Öffnen von `Quellen`, Quellen-Composer mit exklusivem Datei/Link/Notiz-Modus, neue Vorlesung als editierbare Mini-Folie ohne sichtbare Titelformularliste, entkryptisierte Fragenherkunft, 390px Mobile ohne horizontalen Overflow und ohne durchscheinenden Toolstrip.
- Screenshots: `output/playwright/f67-wysiwyg-studio-no-header-v3.png`, `output/playwright/f67-wysiwyg-studio-menu-v3.png`, `output/playwright/f67-wysiwyg-source-composer-v3.png`, `output/playwright/f67-wysiwyg-new-lecture-v3.png`, `output/playwright/f67-wysiwyg-question-copy-v3.png`, `output/playwright/f67-wysiwyg-mobile-menu-v3.png`.
- Keine neue Schema-Migration für F68 nötig; Template, Testläufe und Modellvergleich werden in `question_review_items.variants_json` gespeichert.
- `npm run typecheck`: grün.
- Playwright Interactive Prompt-Workflow mit `DATABASE_URL=postgres://michaelwelsch@127.0.0.1:55432/learnbuddy_f68`: grün für Magic-Link-Login, Materialnotiz, Materialverarbeitung zu Review-Draft, Prompt-Template-Edit auf Niveau 2.0, `Template übernehmen`, `Testlauf starten`, sichtbaren `1 Testläufe`, Durchschnitt, `3 Modelle verglichen`, Modellvergleich mit `learnbuddy-rubric-strict`, Speichern, Reload-Persistenz, 390px Mobile-Fit und Logout-Schutz.
- Direkte Postgres-Gegenprobe: strukturelles `jsonb_array_elements` liefert `variants_with_tests=1`, `variants_with_model_compare=1`, `template_history=1`, `test_history=1`.
- Screenshots: `output/playwright/f68-prompt-workflow-test-run.png`, `output/playwright/f68-prompt-workflow-reload.png`, `output/playwright/f68-prompt-workflow-model-comparison.png`, `output/playwright/f68-prompt-workflow-final-desktop.png`, `output/playwright/f68-prompt-workflow-final-mobile.png`, `output/playwright/f68-prompt-workflow-final-logout-protected.png`.
- Keine neue Schema-Migration für F69 nötig; der Schnitt betrifft nur das Dozentenstudio und nutzt bestehende Postgres-Tabellen.
- `npm run typecheck`: grün.
- `npm run build`: grün.
- Playwright Interactive WYSIWYG-Entkryptisierung mit `DATABASE_URL=postgres://michaelwelsch@127.0.0.1:55432/learnbuddy_wysiwyg`: grün für Magic-Link-Login, Materialnotiz, Materialverarbeitung zu Review-Draft, Frage als Quiz-Overlay, versteckte Prompt-Regeln, erweiterte Regeln/Testlauf, Speichern ohne Werkzeug-Reset, ausgeblendete globale Bottom-Bar im Fragezustand, Quellenablage zur aktuellen Folie, 390px Mobile-Fit und Logout-Schutz.
- Screenshots: `output/playwright/wysiwyg-question-overlay-clean.png`, `output/playwright/wysiwyg-question-overlay-after-save.png`, `output/playwright/wysiwyg-source-tray.png`, `output/playwright/wysiwyg-mobile-question-overlay.png`, `output/playwright/wysiwyg-logout-protected.png`.
- Keine neue Schema-Migration für F70 nötig; Audioquellen nutzen `lecture_assets.kind=audio`, Archiv-Exporthistorie nutzt `standalone_exports`.
- `npm run typecheck`: grün.
- `npm run build`: grün.
- Playwright Interactive Standalone-Archiv-ZIP: grün mit `DATABASE_URL=postgres://michaelwelsch@127.0.0.1:55432/learnbuddy_f70` für Magic-Link-Login, WAV-Upload, sichtbares `audio · ready`, klickbaren Burger-Menü-Link `Archiv ZIP`, Browser-Download, ZIP-Parse mit Manifest, Daten, CSS, JS und echter WAV-Datei, Audio-SHA-Gegenprobe, Dashboard-Reload, 390px Mobile-Fit und Logout-Schutz.
- Direkte Postgres-Gegenprobe: `lecture_assets` enthält `kind=audio`, `status=ready`, `original_name=dozenten-audio-f70.wav`; `standalone_exports` enthält `standalone-archive-v1-*`, `storage_url=/api/lecture/gleitlagerung-demo/export?format=zip` und 64-stellige SHA-256-Prüfsumme.
- Screenshots/Artefakte: `output/playwright/f70-audio-source-uploaded.png`, `output/playwright/f70-audio-source-details.png`, `output/playwright/f70-burger-menu-after-fix.png`, `output/playwright/f70-archive-mobile-menu.png`, `output/playwright/f70-archive-logout-protected.png`, `output/playwright/f70-standalone-archive.zip`, `output/playwright/f70-zip-manifest.json`, `output/playwright/f70-zip-data.json`.
- Keine neue Schema-Migration für F71 nötig; gespeicherte Archivartefakte nutzen `standalone_exports.storage_url` und den StorageProvider.
- `npm run db:migrate`: grün gegen frisches lokales Postgres `learnbuddy_f71`.
- `npm run typecheck`: grün.
- `npm run build`: grün.
- Playwright Interactive persistiertes Standalone-Artefakt: grün mit `DATABASE_URL=postgres://michaelwelsch@127.0.0.1:55432/learnbuddy_f71` für Magic-Link-Login, WAV-Upload `dozenten-audio-f71.wav`, sichtbares `audio · ready`, `Archiv speichern`, Dashboard-Reload mit `Gespeichertes Archiv laden`, Desktop-Download, ZIP-Parse, Manifest-/Data-Schema `standalone-archive-v1`, Audio-SHA-Gegenprobe, Artefakt-HTTP-Header `application/zip`, 390px Mobile ohne horizontalen Overflow, Mobile-Hit-Test auf dem gespeicherten Link, Mobile-Artefaktabruf und Logout-Schutz.
- Direkte Postgres-/Filesystem-Gegenprobe: `lecture_assets` enthält `kind=audio`, `status=ready`, `original_name=dozenten-audio-f71.wav`; `standalone_exports.storage_url` zeigt auf `/api/local-artifacts/lectures/.../exports/gleitlagerung-demo-standalone-archive-v1-...zip`; `.data/artifacts/lectures/.../exports/...zip` existiert mit 104 KB.
- Screenshots/Artefakte: `output/playwright/f71-audio-source-ready.png`, `output/playwright/f71-archive-stored-dashboard.png`, `output/playwright/f71-stored-archive.zip`, `output/playwright/f71-stored-manifest.json`, `output/playwright/f71-stored-data.json`, `output/playwright/f71-stored-archive-mobile-final.png`, `output/playwright/f71-mobile-artifact-fetch.zip`, `output/playwright/f71-stored-archive-logout-protected.png`.
- Migration `0012_blushing_lightspeed.sql`: ergänzt Auditfelder `moderation_provider`, `moderation_model`, `moderation_confidence` und `moderation_signals` auf `student_chat_questions`.
- `npm run db:migrate`: grün gegen frisches lokales Postgres `learnbuddy_f72`.
- `npm run typecheck`: grün.
- `npm run build`: grün.
- Playwright Interactive Chatfrage-Moderation: grün mit `DATABASE_URL=postgres://michaelwelsch@127.0.0.1:55432/learnbuddy_f72` für frische Student-Live-Kontexte, fachliche Frage mit Weiterleitungsfeedback, fachfremde Mensa-Frage mit Ignorieren-Feedback, Referenten-Signale-Drawer mit `KI-Moderation`, `learnbuddy-chat-moderator`, `local-rubric-v1`, Confidence und Signalen, Dashboard-Reload, 390px Mobile ohne horizontalen Overflow und Logout-Schutz.
- Direkte Postgres-Gegenprobe: `student_chat_questions` enthält `F72 Lager` als `accepted`, `source_topic=gleitlager`, `moderation_confidence=96`, Signale `gleitlager/lager/mischreibung`; `F72 Mensa` ist `ignored`, `moderation_confidence=84`; `question_review_items` enthält genau einen `Chatfrage:`-Review.
- Screenshots: `output/playwright/f72-student-chat-accepted-retry.png`, `output/playwright/f72-student-chat-ignored.png`, `output/playwright/f72-chat-moderation-dashboard-final.png`, `output/playwright/f72-chat-moderation-reload-final.png`, `output/playwright/f72-chat-moderation-mobile.png`, `output/playwright/f72-chat-moderation-logout-protected.png`.
- Keine neue Schema-Migration für F73 nötig; Audiosegmentierung wird beim Archiv-Export aus vorhandenen WAV-Audioassets berechnet.
- `npm run db:migrate`: grün gegen frisches lokales Postgres `learnbuddy_f73`.
- `npm run typecheck`: grün.
- `npm run build`: grün.
- Playwright Interactive Standalone-Archiv-Audiosegmente: grün mit `DATABASE_URL=postgres://michaelwelsch@127.0.0.1:55432/learnbuddy_f73` für Magic-Link-Login, WAV-Upload `dozenten-audio-f73.wav`, sichtbares `audio · ready`, `Archiv speichern`, Dashboard-Reload mit `Gespeichertes Archiv laden`, ZIP-Parse mit Gesamtspur plus drei Segmentdateien `audio/segments/slide-01-dozenten-audio-f73.wav`, `slide-02-...`, `slide-03-...`, Manifest-/Data-Segmentmetadaten, SHA-Gegenprobe, Artefakt-HTTP-Header, 390px Mobile ohne horizontalen Overflow und Logout-Schutz.
- Direkte Postgres-/Filesystem-/ZIP-Gegenprobe: `lecture_assets` enthält `kind=audio`, `status=ready`, `original_name=dozenten-audio-f73.wav`; `standalone_exports.storage_url` zeigt auf `/api/local-artifacts/lectures/.../exports/gleitlagerung-demo-standalone-archive-v1-...zip`; ZIP-Einträge und Segment-SHAs sind in `output/playwright/f73-archive-check.json` dokumentiert.
- Keine neue Schema-Migration für F74 nötig; der Schnitt betrifft ausschließlich die Referentenstudio-Interaktion.
- `npm run typecheck`: grün.
- `npm run build`: grün.
- Playwright Interactive folienverankerte WYSIWYG-Werkzeuge: grün für Magic-Link-Login, fullscreen-nahe Folienfläche ohne permanente Kopfzeile, Frage-/Quellen-Marker direkt auf dem Slide, Bottom-Sheet statt scrollbarer Formularliste, Schließen des Sheets, Desktop-Zentrierung, 390px Mobile-Fit und keine unerwarteten Console-/Network-Fehler.
- Screenshots: `output/playwright/wysiwyg-redesign-v4-desktop-centered.png`, `output/playwright/wysiwyg-redesign-v4-mobile-final.png`.
- Migration `0013_hard_nocturne.sql`: ergänzt `standalone_export_jobs` mit Status, Format, Requester, optionalem `standalone_export_id`, Artefakt-URL, SHA, Message, Start-/Endzeit und Dauer.
- `npm run db:migrate`: grün gegen frisches lokales Postgres `learnbuddy_f75`.
- `npm run typecheck`: grün.
- `npm run build`: grün.
- Playwright Interactive persistierter Standalone-Archivjob: grün mit `DATABASE_URL=postgres://michaelwelsch@127.0.0.1:55432/learnbuddy_f75` für Magic-Link-Login, Export-Popover, `Archiv speichern`, Redirect `notice=export-job-succeeded`, `Letzter Job: Fertig`, `Archiv gespeichert`, gespeicherten Artefaktlink, `application/zip`-Abruf, ZIP mit Manifest/Daten/CSS/JS/Fallback-Audio/Audiosegmenten und keine Console-/Network-Fehler.
- Mobile-Gegenprobe: 390px Export-Popover liegt vollständig im Viewport (`x=12`, `right=378` bei 390px), kein horizontaler Overflow.
- Direkte Postgres-Gegenprobe: `standalone_export_jobs` enthält erfolgreiche `archive_zip`-Jobs mit Artefakt-URL, SHA, Dauer und verknüpftem `standalone_exports`-Datensatz.
- Screenshots/Artefakte: `output/playwright/f75-export-job-status.png`, `output/playwright/f75-export-job-mobile.png`, `output/playwright/f75-export-job-archive.zip`.
- Migration `0014_unknown_rictor.sql`: ergänzt `standalone_export_jobs.provider` und `provider_job_id`.
- `npm run db:migrate`: grün gegen frisches lokales Postgres `learnbuddy_f76`.
- `npm run typecheck`: grün.
- Playwright Interactive providerneutraler Archivjob: grün mit `DATABASE_URL=postgres://michaelwelsch@127.0.0.1:55432/learnbuddy_f76` und `LEARNBUDDY_JOB_PROVIDER=inline` für Magic-Link-Login, Export-Popover, `Archiv speichern`, `Letzter Job: Fertig`, Artefaktlink, `application/zip`, ZIP-Inhalt mit Manifest/Daten/CSS/JS/Fallback-Audio/Audiosegmenten und keine Console-/Network-Fehler.
- Mobile-Gegenprobe: 390px Export-Popover bleibt vollständig im Viewport (`x=12`, `right=378` bei 390px), kein horizontaler Overflow.
- Fehlkonfigurations-Gegenprobe: `LEARNBUDDY_JOB_PROVIDER=unsupported` führt nach `Archiv speichern` zu sichtbarem `Letzter Job: Fehlgeschlagen` mit Message `Unsupported LEARNBUDDY_JOB_PROVIDER: unsupported`; Postgres speichert den Job als `failed`.
- Direkte Postgres-Gegenprobe: letzter erfolgreicher Job enthält `provider=inline`, `provider_job_id like 'inline:standalone_archive:%'`, Artefakt-URL, SHA, Dauer und Exportverknüpfung; der Fehlpfad enthält `status=failed` und die Fehlermeldung.
- Screenshots/Artefakte: `output/playwright/f76-job-provider-status.png`, `output/playwright/f76-job-provider-mobile.png`, `output/playwright/f76-job-provider-failure.png`, `output/playwright/f76-job-provider-archive.zip`.
- Screenshots: `output/playwright/f77-material-job-provider-status.png`, `output/playwright/f77-material-job-provider-mobile.png`, `output/playwright/f77-material-job-provider-failure.png`.
- Screenshots: `output/playwright/wysiwyg-studio-real-desktop.png`, `output/playwright/wysiwyg-studio-real-questions.png`, `output/playwright/wysiwyg-studio-real-sources-final.png`, `output/playwright/wysiwyg-studio-real-mobile-questions.png`.
- Playwright CLI Learn-KI-Scope-Guard: grün für fachliche Streaming-Antwort mit Quelle/Budget und fachfremde Pizza-Frage mit sichtbarer Scope-Blockierung.
- Direkte API-/Postgres-Gegenprobe: `/api/ai/chat` liefert für fachfremde Frage HTTP 403 mit `reason=scope`; `analytics_events` enthält `ai_chat_blocked.reason=scope`, `scopeReason=off_topic`, `offTopicTerms=["pizza"]`, und keine fachfremde Antwort wurde persistiert.
- Screenshots: `output/playwright/f83-ai-scope-valid.png`, `output/playwright/f83-ai-scope-blocked.png`.
- Playwright CLI Dozentenstudio-Folien-Layer: grün für Magic-Link-Login, Frage-Quizlayer, Evaluation-Vorschau-Layer, Auswertungs-Zahlenlayer, 390px Mobile-Fragenlayer über Bottom-Bar, 0 Browser-Console-Errors, 0 Warnings und nur 200er API-Requests im geprüften Flow.
- Screenshots: `output/playwright/wysiwyg-question-overlay-final2.png`, `output/playwright/wysiwyg-evaluation-overlay.png`, `output/playwright/wysiwyg-analytics-overlay.png`, `output/playwright/wysiwyg-question-overlay-mobile-final3.png`.
- Playwright `next start -p 3001` Public-Token-Leaderboard: grün für Student Live und Learn, jeweils vier korrekte Antworten über alle Niveaus, eigene Ranking-Zeile mit 10 Punkten, 4 korrekten Antworten, `self=true`, nur 200er API-Responses und keine Browser-Console-Errors.
- Finaler Playwright-Smoke nach Entfernen der alten Demo-Leaderboard-Methoden: grün gegen frischen `next start -p 3001`, eigene Live-Ranking-Zeile mit 10 Punkten, 4 korrekten Antworten, `self=true`, 0 Console-Errors und 0 Request-Fails.
- Screenshots: `output/playwright/f85-live-leaderboard-ranking.png`, `output/playwright/f85-learn-leaderboard-ranking.png`, `output/playwright/f85-live-leaderboard-ranking-final.png`.
- `npm run db:migrate`: grün gegen frisches lokales Postgres `learnbuddy_f86_repo_leaderboard`.
- `npm run admin -- seed-demo --owner f86@example.test`: grün gegen dieselbe Postgres-DB.
- Playwright `DATABASE_URL=postgres://michaelwelsch@127.0.0.1:55432/learnbuddy_f86_repo_leaderboard`, `next start -p 3002`: grün für repository-basierte Public-Token-Leaderboard-Aggregation im Student-Live-Flow; vier korrekte Antworten, eigene Zeile mit 10 Punkten, `self=true`, nur 200er API-Responses, keine Console-Errors und keine Request-Fails.
- Direkte Postgres-Gegenprobe: getestete Session `PgRank...` enthält `answers=4`, `correct=4`, `points=10` über `participant_sessions` und `analytics_events`.
- Screenshot: `output/playwright/f86-postgres-repository-leaderboard-live.png`.
- Playwright CLI WYSIWYG-Inspector: grün gegen den laufenden Next-Dev-Server für Magic-Link-Login, kompakten `.studio-inspector`, direkt editierbare Folie, entfernte `.studio-plan-strip` und `.studio-export-menu`, reduzierte Statusauswahl, `Fragen`-/`Quellen`-Layer mit synchronem Inspector, Plan-Speichern per PATCH und 390px Mobile mit Inspector unter der Bühne.
- Screenshots: `output/playwright/f87-wysiwyg-lecturer-studio-desktop.png`, `output/playwright/f87-wysiwyg-lecturer-studio-mobile.png`.
- Migration `0017_awesome_shaman.sql`: legt `lecturer_assistant_messages` für den foliennahen Referenten-Assistenten an.
- `npm run db:migrate`: grün gegen frisches lokales Postgres `learnbuddy_f95_lecturer_assistant`.
- Playwright Interactive Referenten-Assistent: grün für Magic-Link-Login, WYSIWYG-Anlegen, `Assistent`-Overlay, Antwort zu Mischreibung mit Niveau 4.0 bis 1.0, Reload-Persistenz, authentifizierten Owner-POST, fremden Owner-POST mit 404, Logout-Schutz, 390px Mobile ohne horizontalen Overflow, 0 Console-Errors und 0 nicht-abgebrochene Requestfehler.
- Screenshots: `output/playwright/f95-assistant-current-stage.png`, `output/playwright/f95-assistant-current-response.png`, `output/playwright/f95-assistant-current-reload.png`, `output/playwright/f95-assistant-current-mobile.png`.
- Keine neue Schema-Migration für F96 nötig; Assistenten-Fragenentwürfe nutzen bestehende `question_review_items` und `lecturer_assistant_messages`.
- Playwright Interactive Assistenten-Toolaktion: grün für Magic-Link-Login, Assistenten-Overlay, `Fragenentwurf anlegen`, sichtbare `Assistent:`-Quiz-Reviewkarte, Reload-Persistenz, direkter Owner-API-POST, fremder Owner-POST mit 404, Logout-Schutz, 390px Mobile ohne horizontalen Overflow und 0 Console-Errors.
- Screenshots: `output/playwright/f96-assistant-before-action.png`, `output/playwright/f96-assistant-review-draft.png`, `output/playwright/f96-assistant-review-reload.png`, `output/playwright/f96-assistant-action-mobile.png`.
- Keine neue Schema-Migration für F97 nötig; die Änderung betrifft `LecturerDashboard` und Studio-CSS.
- `npm run typecheck`: grün nach F97.
- `npm run build`: grün nach F97.
- Playwright Interactive WYSIWYG-Bühne: grün gegen `next start -p 3017` für Magic-Link-Login, 1440px Stage ohne permanente `.studio-filmstrip-rail`, 42px Desktop-Hotspots mit ungeschnittenen Badges, direkte Folientitel-Bearbeitung mit Reload-Persistenz, Folienwechsel über untere Miniaturen, Planungs-Popover mit persistiertem Live-Termin, Burger-Menü ohne Planformularfelder, 390px Mobile mit 34px Hotspots, ausgeblendeter Folienminiaturleiste, Bottom-Bar innerhalb 390px und `overflowX=0`.
- Screenshots: `output/playwright/wysiwyg-studio-desktop-final-2.png`, `output/playwright/wysiwyg-studio-mobile-final-2.png`.
- Keine neue Schema-Migration für F98 nötig; Assistenten-Folienpunkte nutzen bestehende `slides.content_json.copy` und `lecturer_assistant_messages`.
- `npm run db:migrate`: grün gegen frisches lokales Postgres `learnbuddy_f98_assistant_slide_point`.
- `npm run build`: grün nach F98.
- `npm run typecheck`: grün nach F98.
- Playwright Interactive Assistenten-Folienpunkt: grün gegen `next start -p 3018` mit `DATABASE_URL=postgres://michaelwelsch@127.0.0.1:55432/learnbuddy_f98_assistant_slide_point` für Magic-Link-Login, WYSIWYG-Anlegen, Assistenten-Overlay, `Folienpunkt übernehmen`, sichtbaren Merksatz auf der Folie, Reload-Persistenz, Owner-API 200, fremder Owner 404, Logout-Schutz, 390px Mobile ohne horizontalen Overflow und 0 Console-/Requestfehler nach Herausnahme des erwarteten 404.
- Direkte Postgres-Gegenprobe: `slides.content_json.copy` enthält den übernommenen `Merksatz: Mischreibung ist kritisch...`; `lecturer_assistant_messages` protokolliert Übernahme und Deduplikation.
- Screenshots: `output/playwright/f98-assistant-slide-point-desktop.png`, `output/playwright/f98-assistant-slide-point-mobile.png`.
- Keine neue Schema-Migration für F99 nötig; Assistentenquellen nutzen bestehende `lecture_assets`, StorageProvider, `asset_chunks`, `question_review_items` und `lecturer_assistant_messages`.
- `npm run db:migrate`: grün gegen frisches lokales Postgres `learnbuddy_f99_assistant_source_note`.
- `npm run typecheck`: grün nach F99.
- `npm run build`: grün nach F99.
- Playwright Interactive/Chromium Assistenten-Quellen-Notiz: grün gegen `next start -p 3019` mit `DATABASE_URL=postgres://michaelwelsch@127.0.0.1:55432/learnbuddy_f99_assistant_source_note` für Magic-Link-Login, WYSIWYG-Anlegen, Assistenten-Overlay, `Quellen-Notiz`, sichtbare Quelle im Quellen-Layer, Materialverarbeitung zu 1 Chunk und 1 Review, Reload-Persistenz, Owner-API 201 mit Deduplikation, fremder Owner 404, Logout-Schutz, 390px Mobile ohne horizontalen Overflow und 0 Console-/Requestfehler.
- Direkte Postgres-Gegenprobe: `lecture_assets` enthält `Assistentenquelle: Gleitlagerung F99` als `kind=notes`, `source=notes`, `status=ready`; `asset_chunks=1`, `question_review_items=1`, und `lecturer_assistant_messages` protokolliert Anlage plus Deduplikation.
- Screenshots: `output/playwright/f99-assistant-source-note-desktop.png`, `output/playwright/f99-assistant-source-note-reload.png`, `output/playwright/f99-assistant-source-note-mobile.png`.
- Keine neue Schema-Migration für F100 nötig; der Schnitt betrifft nur `LecturerDashboard` und Studio-CSS.
- `npm run typecheck`: grün nach F100.
- `npm run build`: grün nach F100.
- Playwright Interactive/Chromium WYSIWYG-Studio ohne kryptische Marker: grün gegen isoliertes `next start -p 3020` mit `LEARNBUDDY_REPOSITORY=local` für Magic-Link-Login, direkt editierbare Folie als Primärfläche, entfernte permanente `.studio-hotspot`-Marker, beschriftetes Bottom-Bar-Menü `Werkzeuge`, Fragen-Layer aus dem Menü, direkte Folientitelbearbeitung mit Reload-Persistenz, 1500px Desktop ohne Page-Scroll, 390px Mobile ohne horizontalen Overflow, alle Bottom-Bar-Aktionen vollständig im Viewport, Werkzeug-Popover vollständig im Viewport und 0 Console-/Requestfehler.
- Screenshots: `output/playwright/f100-wysiwyg-studio-desktop.png`, `output/playwright/f100-wysiwyg-tool-questions.png`, `output/playwright/f100-final-desktop-questions.png`, `output/playwright/f100-final-mobile-fit.png`, `output/playwright/f100-final-mobile-menu.png`.
- Migration `0018_damp_shooting_star.sql`: ergänzt `lecturer_assistant_messages.metadata_json` für strukturierte Agent-Metadaten im foliennahen Referenten-Assistenten.
- `npm run db:migrate`: grün gegen frisches lokales Postgres `learnbuddy_f85_agent` auf Port `55432`.
- `npm run typecheck`: grün nach F101.
- `npm run build`: grün nach F101.
- Playwright Interactive strukturierter Referenten-Agent-Loop: grün gegen `next start -p 3021` mit `DATABASE_URL=postgres://michaelwelsch@127.0.0.1:55432/learnbuddy_f85_agent` für Magic-Link-Login, WYSIWYG-Anlegen, `Werkzeuge` -> `Assistent`, sichtbare `Agent-Schritte`, sichtbare `Quellengewichtung`, Vorschlag, Review-Draft-Toolaktion, Reload-Persistenz, 390px Mobile ohne horizontalen Overflow und Logout-Schutz.
- Direkte Postgres-Gegenprobe: `lecturer_assistant_messages.metadata_json` speichert `provider=learnbuddy-agent-loop`, `model=local-planning-agent-v1`, `steps=4`, `sourceWeights=1`, `toolSuggestions=2`.
- Browserdiagnose F101: 0 Console-Errors und 0 Page-Errors; nur erwartbare Next-RSC-Prefetch-Aborts beim Menü/Logout.
- Screenshots: `output/playwright/f101-agent-loop-assistant.png`, `output/playwright/f101-agent-loop-review-draft.png`, `output/playwright/f101-agent-loop-reload-persisted.png`, `output/playwright/f101-agent-loop-mobile.png`.
- Keine neue Schema-Migration für F102 nötig; der Schnitt betrifft `LecturerDashboard` und Studio-CSS.
- `npm run typecheck`: grün nach F102.
- `npm run build`: grün nach F102.
- Playwright Interactive WYSIWYG-Deckstudio: grün gegen `next start -p 3023` mit lokalem Repository und Console-Magic-Link für Magic-Link-Login, sichtbare linke Desktop-Folienleiste, beschriftete Objektaktionen direkt auf der Folie, `Fragen`-Overlay aus dem Hotspot, kompakter Einzel-Popover per Plan-Chip, Reload mit Folienleiste und Hotspots, 390px Mobile mit kompakter Hotspotzeile und voller zweizeiliger Bottom-Bar.
- Browserdiagnose F102: 0 Console-Errors und 0 Page-Errors; Desktop-Hotspot-Labels nicht abgeschnitten, mobile Planungszeile `360px` breit bei `390px` Viewport.
- Screenshots: `output/playwright/wysiwyg-lecturer-studio-desktop-final-clean.png`, `output/playwright/wysiwyg-lecturer-studio-questions-final2.png`, `output/playwright/wysiwyg-lecturer-studio-mobile-final4.png`.
- Keine neue Schema-Migration für F103 nötig; der Schnitt betrifft `LecturerDashboard` und Studio-CSS.
- `npm run typecheck`: grün nach F103.
- `npm run build`: grün nach F103.
- Playwright Interactive WYSIWYG-Studio ohne Formularlisten-Anmutung: grün gegen `next start -p 3028` mit lokalem Repository und Console-Magic-Link für Magic-Link-Login, ruhige Icon-Objektleiste statt breiter Werkzeug-Pills, Bottom-Bar nur mit Foliennavigation, `Planung` und `Speichern`, 0 sichtbare `.studio-plan-strip`, tabbarer Planungsdialog, Fragen-Overlay aus dem Icon, direkte Folientitelbearbeitung mit Save/Reload-Persistenz und Rücksetzung des Testtitels.
- Browserdiagnose F103: Desktop `planStripCount=0`, `visibleInputCountOnStage=0`, `scrollW=1440`, 0 Console-/Page-/Requestfehler; Mobile `390px` mit `scrollW=390`, Bottom-Bar `372px`, Icon-Leiste `308px`, Fragen-Overlay geöffnet und 0 Console-/Page-/Requestfehler.
- Screenshots: `output/playwright/f103-wysiwyg-clean-desktop-final.png`, `output/playwright/f103-wysiwyg-plan-clean.png`, `output/playwright/f103-wysiwyg-question-clean.png`, `output/playwright/f103-wysiwyg-mobile-clean.png`, `output/playwright/f103-wysiwyg-mobile-plan.png`, `output/playwright/f103-wysiwyg-mobile-question.png`.
- F104 OpenAI-kompatibler externer Chat-Provider: Migration nicht nötig; `npm run typecheck`, `npm run build` und `npm run db:migrate` gegen frische DB `learnbuddy_f104_ai_provider` grün.
- Playwright Interactive mit Mock-Provider `http://127.0.0.1:4011/v1/chat/completions`, `LEARNBUDDY_AI_PROVIDER=openai-compatible` und `next start -p 3030`: Learn-Chat Desktop und 390px Mobile rufen nur `/api/ai/chat` auf, erhalten `application/x-ndjson`, zeigen `Mock-Provider F104`, Budgetanzeige und keinen API-Key; Dozenten-Auswertung zeigt KI-Nutzung; keine Console-/Page-/Requestfehler im sauberen Abschlusslauf.
- Direkte Postgres-Gegenprobe F104: `analytics_events.ai_chat_answered` speichert `provider=openai-compatible`, `model=mock-openai-f104`, Tokens `37/29/66` und `costEstimate.estimatedEur=0.000248`.
- Fehlkonfigurations-Gegenprobe F104 gegen `next start -p 3031` ohne `LEARNBUDDY_AI_BASE_URL`: `/api/ai/chat` liefert neutrale 503 ohne Base-URL/API-Key-Details; Postgres speichert intern `ai_chat_blocked.reason=provider_config`.
- Screenshots: `output/playwright/f104-external-ai-learn-chat-clean.png`, `output/playwright/f104-external-ai-analytics.png`, `output/playwright/f104-external-ai-mobile.png`.
- F105 CTOX Responses-Proxy: Migration nicht nötig; `npm run typecheck`, `npm run build` und `npm run db:migrate` gegen frische DB `learnbuddy_f105_ctox_responses` grün.
- Live-Routencheck ohne Secret: `POST https://llm.ctox.dev/v1/responses` ohne Authorization liefert `403 application/json`; authentifizierter Production-Smoke mit echtem tenant-scoped `ctox_llm_...`-Token steht aus.
- Playwright Interactive mit Mock-Responses-Proxy `http://127.0.0.1:4016/v1/responses`, `LEARNBUDDY_AI_PROVIDER=ctox-responses`, Proxy-Key `ctox_llm_learnbuddy_test` und `next start -p 3036`: Learn-Chat Desktop und 390px Mobile rufen nur `/api/ai/chat` auf, erhalten `application/x-ndjson`, zeigen `Mock-Responses F105`, Budgetanzeige und keinen Proxy-Host/Token; Mock sieht `authSeen=true`, `/v1/responses`, `inputIsString=true`, `store=false`, `model=MiniMax-M3`; keine Console-/Page-/Requestfehler.
- Direkte Postgres-Gegenprobe F105: `analytics_events.ai_chat_answered` speichert `provider=ctox-responses`, `model=MiniMax-M3`, Tokens `41/31/72` und `costEstimate.provider=ctox-responses`.
- Fehlkonfigurations-Gegenprobe F105 gegen `next start -p 3037` ohne Proxy-Key: `/api/ai/chat` liefert neutrale 503; Postgres speichert intern `ai_chat_blocked.reason=provider_config`.
- Screenshots: `output/playwright/f105-ctox-responses-learn-chat-desktop.png`, `output/playwright/f105-ctox-responses-learn-chat-mobile.png`.
- F106 externer Embedding-Provider: Migration nicht nötig; `npm run typecheck`, `npm run build` und `npm run db:migrate` gegen frische DB `learnbuddy_f106_external_embeddings` grün.
- Playwright Interactive mit Mock-Embedding-Provider `http://127.0.0.1:4018/v1/embeddings`, `LEARNBUDDY_EMBEDDING_PROVIDER=openai-compatible`, API-Key `embed_f106_secret` und `next start -p 3038`: Referent legt eine Quellen-Notiz an, `Fragen aktualisieren` erzeugt `1 Chunks · 1 Reviews`, Learn-Chat Desktop zitiert `Planungsnotiz#chunk-1 · Vektor`, 390px Mobile bleibt ohne horizontalen Overflow und das Leaderboard-Modal ist erreichbar; Browser sieht keine Embedding-URL und keinen API-Key.
- Direkte Provider-/DB-Gegenprobe F106: Mock `/stats` meldet `calls=2`, `authSeen=true`, `model=mock-embedding-f106`, `encoding=float`; `asset_chunks.vector_dims=1536`; `analytics_events.ai_chat_answered.sources[0].retrievalMethod=vector`.
- Fehlkonfigurations-Gegenprobe F106 gegen `next start -p 3039` ohne `LEARNBUDDY_EMBEDDING_BASE_URL`: Materialverarbeitung liefert neutrale UI-Meldung `Embedding-Provider ist nicht korrekt konfiguriert.` ohne Env-Namen, Provider-URL oder API-Key.
- F107 LLM-Fragegenerator: Migration nicht nötig; `npm run typecheck`, `npm run build` und `npm run db:migrate` gegen frische DB `learnbuddy_f107_llm_questions` grün.
- Playwright Interactive mit Mock-Responses-Provider `http://127.0.0.1:4020/v1/responses`, `LEARNBUDDY_QUESTION_GENERATOR=ai`, `LEARNBUDDY_AI_PROVIDER=ctox-responses`, Proxy-Key `f107_question_secret` und `next start -p 3040`: Referent legt eine Quellen-Notiz an, `Fragen aktualisieren` erzeugt LLM-generierte Reviewvarianten, die UI zeigt unterschiedliche 4.0/2.0/1.0-Fragen mit korrekten Umlauten, 390px Mobile bleibt ohne horizontalen Overflow; Browser sieht keine Provider-URL und keinen API-Key.
- Direkte Provider-/DB-Gegenprobe F107: Mock `/stats` meldet `calls=1`, `authSeen=true`, `model=mock-question-f107`, `lastHasSchema=true`, `lastHasUmlautInstruction=true`; `question_review_items` enthält vier unterschiedliche Varianten mit `promptVersion=llm-material-v1` und `promptHistory[0].model=ctox-responses:mock-question-f107`.
- Fehlkonfigurations-Gegenprobe F107 gegen `next start -p 3041` mit `LEARNBUDDY_QUESTION_GENERATOR=ai` ohne AI-Provider: Materialverarbeitung liefert neutrale UI-Meldung `Fragegenerator ist nicht korrekt konfiguriert.` ohne Env-Namen oder Providerdetails; `material_processing_runs` persistiert den Fehler intern.
- F108 HTTP-JobProvider: Migration nicht nötig; `npm run typecheck`, `npm run build` und `npm run db:migrate` gegen frische DB `learnbuddy_f108_http_jobs` grün.
- Playwright/API-Gegenprobe F108 mit Mock-Broker `http://127.0.0.1:4022/jobs`, `LEARNBUDDY_JOB_PROVIDER=http`, `LEARNBUDDY_JOB_API_KEY=f108_job_secret` und `next start -p 3044`: Materialverarbeitung und `Archiv speichern` registrieren Jobs beim Broker, der Broker sieht Bearer-Auth und `appUrl=http://localhost:3044`, das Dashboard zeigt ein gespeichertes Archiv.
- Direkte Provider-/DB-Gegenprobe F108: Mock `/stats` meldet zwei Jobs (`material_processing`, `standalone_archive`); `material_processing_runs.provider=http`, `standalone_export_jobs.provider=http`, beide mit Broker-`provider_job_id`; `standalone_exports` enthält Artefakt-URL und SHA.
- Fehlkonfigurations-Gegenprobe F108 gegen `next start -p 3045` mit `LEARNBUDDY_JOB_PROVIDER=http` ohne Endpoint: Materialverarbeitung liefert neutral `Materialverarbeitung konnte nicht gestartet werden.` und sanitizt zurückgegebene Run-/Step-Meldungen ohne `LEARNBUDDY_JOB_*`, `Job provider`, Fetch- oder URL-Interna.
- F109 Remote-Storage: Migration nicht nötig; `npm run typecheck`, `npm run build` und `npm run db:migrate` gegen frische DB `learnbuddy_f109_http_storage` grün.
- Playwright/API-Gegenprobe F109 mit HTTP-Storage-Mock `http://127.0.0.1:4024`, `LEARNBUDDY_STORAGE_PROVIDER=http`, `LEARNBUDDY_STORAGE_API_KEY=f109_storage_secret` und `next start -p 3046`: Notizquelle wird per PUT in den Object Store geschrieben, Materialverarbeitung liest sie per GET, `Archiv speichern` schreibt das ZIP remote, Dashboard zeigt `Gespeicherten Stand laden`, und der `/api/storage-artifacts/http/...`-Link liefert ein valides ZIP.
- Direkte Provider-/DB-Gegenprobe F109: Mock `/stats` enthält PUT/GET für Notiz und Archiv mit Bearer-Auth; `lecture_assets.storage_key` und `standalone_exports.storage_url` nutzen `/api/storage-artifacts/http/...`; `standalone_export_jobs` enthält `status=succeeded`, Artefakt-URL und SHA.
- Fehlkonfigurations-Gegenprobe F109 gegen `next start -p 3047` mit `LEARNBUDDY_STORAGE_PROVIDER=http` ohne Endpoint: `Archiv speichern` persistiert `failed` mit neutral `Archivjob konnte nicht gestartet werden.`; API und sichtbare UI leaken keine `LEARNBUDDY_STORAGE_*`-Variable, keinen `Storage provider`-Text und keine Fetch-/URL-Interna.
- F110 database Worker/Queue: Migration nicht nötig; `npm run typecheck`, `npm run build` und `npm run db:migrate` gegen frische DB `learnbuddy_f110_database_worker` grün.
- Playwright/Chromium-Gegenprobe F110 mit `LEARNBUDDY_JOB_PROVIDER=database`, `LEARNBUDDY_WORKER_SECRET=f110_worker_secret` und `next start -p 3048`: Materialverarbeitung liefert `202 queued`, erzeugt erst nach Worker-Lauf Reviewfragen, Worker ohne Secret liefert 401, `POST /api/jobs/worker` mit Secret verarbeitet Material- und Archivjob, Dashboard-Reload zeigt `Fertig · Archiv gespeichert.` und `Gespeicherten Stand laden`, ZIP-Abruf ist valide, Logout schützt `/lecturer`.
- Direkte DB-Gegenprobe F110: `material_processing_runs.provider=database`, `provider_job_id=database:material_processing:...`, Counts `1/1/1`; `standalone_export_jobs.provider=database`, `provider_job_id=database:standalone_archive:...`, Artefakt-URL und SHA; `question_review_items` und `standalone_exports` enthalten die erwarteten Datensätze.
- Admin-CLI F110: `npm run admin -- worker-once --url http://localhost:3048 --limit 5` ruft die geschützte Worker-Route auf und meldet bei leerer Queue `processed=0`.
- F111 Worker-Retry/Dead-Letter: Migration `0019_careful_ted_forrester.sql`; `npm run typecheck`, `npm run build` und `npm run db:migrate` gegen frische DBs `learnbuddy_f111_worker_retry` und `learnbuddy_f111_worker_success` grün.
- Playwright/Chromium-Fehlerpfad F111 mit `LEARNBUDDY_WORKER_MAX_ATTEMPTS=2`: Archivjob mit kaputter `LEARNBUDDY_WORKER_APP_URL` und Materialjob mit fehlender `LEARNBUDDY_EMBEDDING_BASE_URL` liefern jeweils `retrying -> dead_letter`; DB setzt `attempt_count=2`, `next_attempt_at=null`, `dead_letter_at`; Dashboard zeigt `Eingriff nötig` und `Manuelle Prüfung erforderlich` ohne Env-/Provider-Leak; Worker ohne Secret liefert 401.
- Playwright/Chromium-Erfolgspfad F111 mit `next start -p 3055`: Materialjob liefert `succeeded`, `attempt_count=1`, `chunk_count=1`, `review_count=1`; Archivjob liefert `succeeded`, Artefakt-URL und SHA; `Gespeicherten Stand laden` liefert `application/zip` mit 102969 Bytes; Logout schützt `/lecturer`.
- F112 Vercel-Cron-Worker: `vercel.json` triggert `/api/jobs/worker/cron` alle fünf Minuten. Der Cron-Endpunkt ist GET-basiert, akzeptiert `CRON_SECRET` oder `LEARNBUDDY_WORKER_SECRET` als Bearer-Token, nutzt `LEARNBUDDY_WORKER_CRON_LIMIT` und ruft denselben database Worker wie die portable POST-/CLI-Route auf.
- F113 Production-Auth/Mail-Guardrails: echte Production-Deployments (`VERCEL_ENV=production` oder `LEARNBUDDY_DEPLOYMENT_ENV=production`) akzeptieren kein fehlendes, kurzes oder Platzhalter-`AUTH_SECRET`; Console- und Blackhole-Mailprovider sind in Production verboten; Resend benötigt `RESEND_API_KEY` und `EMAIL_FROM`. Fehlkonfigurationen liefern im Login nur `Magic Link konnte nicht versendet werden.` und keinen Testlink.
- F124 Single-Use-Magic-Link-Tokens: Bei gesetzter `DATABASE_URL` speichert LearnBuddy Magic Links nur als SHA-256-Hash in `magic_login_tokens`; ein erfolgreicher Login markiert den Token mit `consumed_at`, Wiederverwendung desselben Links redirectet auf `invalid-token`. Production ohne `DATABASE_URL` akzeptiert keine Magic-Link-Tokens.
- F128 Magic-Link-UX: `invalid-token` zeigt im Login sichtbar `Dieser Magic Link ist abgelaufen oder wurde bereits verwendet.`, damit verbrauchte oder abgelaufene Links nicht als stiller Loginfehler wirken.
- F129 Magic-Link-Rate-Limit: Migration `0021_glossy_living_lightning.sql` ergänzt `magic_login_rate_limits`. LearnBuddy begrenzt standardmäßig mehr als 5 Magic-Link-Anfragen pro normalisierter E-Mail in 15 Minuten und blockiert den HMAC-gehashten Bucket anschließend 15 Minuten. Konfiguration: `LEARNBUDDY_AUTH_MAGIC_LINK_LIMIT`, `LEARNBUDDY_AUTH_MAGIC_LINK_WINDOW_MS`, `LEARNBUDDY_AUTH_MAGIC_LINK_BLOCK_MS`.
- F201 Auth-Architekturentscheidung: Der Referentenlogin nutzt bewusst den eigenen serverseitigen Magic-Link-/Session-Guard statt Auth.js, weil Single-Use-Token-Hashes, signierte Cookies, CSRF, serverseitiger Ablauf, Rate-Limit und Resend-Provider bereits in Postgres/Drizzle verankert und E2E-grün sind.
- F114/F125/F130/F142/F227 Deployment-Preflight: Vor Preview- oder Production-Deployments muss `npm run admin -- preflight --profile production` gegen die Ziel-DB laufen. Der Check prüft ohne Secret-Ausgabe `DATABASE_URL`, Postgres-Verbindung, `pgvector`, Drizzle-Migrationstabelle, erwartete Tabellen/Spalten inklusive `magic_login_tokens.token_hash`, `magic_login_tokens.consumed_at`, `magic_login_rate_limits.bucket_hash`, `magic_login_rate_limits.attempt_count` und `magic_login_rate_limits.blocked_until`, HTTPS-`NEXT_PUBLIC_APP_URL`, `AUTH_SECRET`, Resend, Remote-Storage, Worker-/Job-Provider, CTOX Responses KI-Proxy, providerbasierte Referenten-Assistenz, providerbasierte Chatfragenmoderation, externen Embedding-Provider, OCR-/Vision-Provider und STT-Secret. Lokale Profile dürfen Warnungen haben; `production` darf keine kritischen Fehler ausgeben. Kritische Fehler erscheinen zusätzlich unter `blockers`, Warnungen bleiben in `checks`.
- F116/F244/F246 Mistral/Voxtral-, Self-Hosted- und Realtime-STT: `LEARNBUDDY_STT_PROVIDER=mistral-voxtral` aktiviert den externen STT-Adapter hinter dem bestehenden `/api/lectures/:id/stt`-Proxy. Der Browser sendet weiter nur an LearnBuddy; der Server ruft Mistral per Multipart `POST /v1/audio/transcriptions` mit `MISTRAL_API_KEY`, Modell, Sprache und Kontextbegriffen auf. `LEARNBUDDY_STT_PROVIDER=self-hosted-vllm` nutzt stattdessen `LEARNBUDDY_STT_BASE_URL` plus `LEARNBUDDY_STT_API_KEY` gegen einen OpenAI-kompatiblen `/v1/audio/transcriptions`-Endpunkt. `LEARNBUDDY_STT_PROVIDER=self-hosted-vllm-realtime|vllm-realtime|openai-realtime` nutzt `LEARNBUDDY_STT_REALTIME_BASE_URL` oder `LEARNBUDDY_STT_BASE_URL` plus `LEARNBUDDY_STT_API_KEY` gegen einen `/v1/realtime`-WebSocket fuer PCM16/WAV-Segmente. `LEARNBUDDY_STT_PROVIDER=local` ist in Production ein Preflight-Fehler.
- F202 STT-/Transkript-Zeitmetadaten: STT-Proxy und Transkriptsegment-API normalisieren `startedAt`/`endedAt`, weisen ungültige oder mehr als 2 Minuten zukünftige Zeiten ab und begrenzen einzelne Passagen auf 15 Minuten, damit keine defekten Zeitreihen oder unsegmentierten Langmitschnitte in Analytics und Review-Quellen landen.
- F117/F124/F129/F131/F164/F165/F166/F167/F168/F169/F170/F171/F172/F173/F174/F175/F176/F177/F178/F179/F180/F181/F182/F183/F184/F185/F186/F187/F188/F189/F190/F191/F192/F193/F194/F195/F196/F197/F198/F199/F202/F203/F204/F205/F206/F207/F208/F209/F210/F211/F212/F213/F214/F215/F216/F226/F252/F256/F258/F263 Reproduzierbarer E2E-Gate: `npm run test:e2e` ist jetzt der Standard-Smoke vor Releases; `npm run scripts:check` prüft alle operativen `.mjs`-Entrypoints, `npm run smoke:live-load` ergänzt den reproduzierbaren 30-Teilnehmer-Lastsmoke, und `npm run motion:contract` ist der ergänzende UI-Vertrag für `docs/learnbuddy-motion-design-spec.md` inklusive Studio-Shared-Element-Motion. Der E2E-Befehl baut die App, setzt `learnbuddy_e2e_smoke` zurück, führt Drizzle-Migrationen aus, seedet `gleitlagerung-demo` und prüft in Chromium Referentenlogin, kanonischen Magic-Link-Origin-Guard gegen manipulierte `Origin`-/`x-forwarded-host`-Header, fail-closed Secure-Cookie-Runtime-Config für Preview/Production, explizite Deployment-/StorageProvider-Env-Namen, lokale URL-Fetch-Forbidden-Env, `process.env`- und gepullte Vercel-Env-Werte im Deploy-Readiness-Gate inklusive lokalen oder unsupported Provider-Modi, reservierter Beispiel-/Test-Hosts, offensichtlicher Placeholder-Secrets und reservierter Mail-Sender-Domains, den Self-Hosting-/Operational-Contract-Check inklusive npm-Smoke-Scripts, `scripts/live-load-smoke.mjs`, `scripts/self-host-smoke.mjs` und `scripts/backup-restore-smoke.mjs`, den Self-Host-Modus im Deploy-Readiness-Gate inklusive übersprungener Vercel-Checks, den Self-Host-Full-Gate-Diagnosepfad, `LEARNBUDDY_RELEASE_GATE_SELF_HOST=1` und den roten Konflikt `--self-host --pull-vercel-env`, den Provider-Smoke-Endpoint-Guard ohne Mock, den Runtime-MailProvider-Endpoint-Guard, den Runtime-MailProvider-Sender-Guard, den Full-Release-Gate-Zielhost-Guard, den direkten Live-Smoke-Auth-Precondition-Guard, den Live-Smoke-HTTPS-Zielguard, den Live-Load-Smoke-HTTPS-Zielguard, den Self-Host-Smoke-Blocker-Vertrag, den Backup-/Restore-Smoke-Blocker-Vertrag, den Worker-Smoke-Artefaktrouten-Guard und den Worker-Smoke-HTTPS-Zielguard, serverseitigen Session-Ablauf, Security-Header- und Cache-Control-Auslieferung, Magic-Link-Consume-Guard, Single-Use-Magic-Link-Wiederverwendung im frischen Kontext, Magic-Link-Oversize-Guard, Magic-Link-Rate-Limit mit 429, Artefakt-Download-Guards gegen Traversal, absolute Pfade, Backslashes, falsche Provider und absolute Storage-Read-URLs aus manipulierten Audio-Artefakten, URL-Material-Guard gegen private DNS-/Loopback-Ziele, Provider-Endpoint-Guard gegen lokale/private und reservierte Beispiel-/Test-Ziele für Mail, AI, Question-Generator, Embeddings, OCR, STT, HTTP-Jobs und HTTP-Storage, Provider-Mode-Guard gegen lokale Mail-, KI-, Assistenten-, Moderations-, Fragegenerator-, Embedding-, OCR- und STT-Fallbacks, Mail-Sender-Guard gegen reservierte Absenderdomains, Worker-401 ohne Secret und Limit-Clamping auf 25, Public-Token-/AnonymousKey-Guards für APIs und gerenderte Seiten, authentifizierte Entity-ID-Guards für Referentenrouten, Public-Event-Guard mit allowlisteten Eventtypen, Größenlimit und serverseitiger Antwortwertung, öffentlichen Chatfrage-Guard mit Pflicht-`anonymousKey`, Größenlimit und 429 vor Provider-Moderation, Learn-KI-Request-Guard mit Größenlimit vor Provideraufruf, authentifizierten Lecturer-JSON-Body-Guard, Multipart-Upload-/STT-Body-Guard vor `formData()`, Browser-STT-WAV-Segmentvertrag, STT-/Transkript-Zeitmetadaten-Guard, race-festen Quellen-Upload vor Materialverarbeitung, Standalone-Export-Record-Guard, OCR-Layoutanker in Materialchunks, Retention-Cleanup mit echter Postgres-Redaktion, Reload/Logout-Schutz, Student-Live-Teilnahme plus Leaderboard sowie Learn-Fragedichte, KI-Chat-Link, Leaderboard, Studio-Folienstrip-zu-Stage-FLIP und 390px Mobile-Fit. Für Self-Hosting ergänzt `npm run smoke:self-host` den echten Docker-Compose-Start-Smoke in Zielumgebungen mit Docker; `--config-only` prüft nur Docker/Compose/Config. Für Datenbankbetrieb ergänzt `npm run smoke:backup-restore` den echten `pg_dump`/`psql`-Roundtrip gegen eine leere Restore-DB, und `--config-only` ist zusätzlich im CI-Gate verankert. Rote `deploy:readiness`-Env-Ausgaben enthalten jetzt zusätzlich `details.remediation` mit secretfreien `vercel env add`-Befehlen für die fehlenden Providerwerte; falsch gesetzte lokale Provider-Modi erscheinen als eigener Blocker `provider_mode_values`.
- F139 Öffentlicher Live-Smoke: `scripts/live-smoke.mjs` macht den öffentlichen Deploy-Smoke reproduzierbar. Standardmäßig erzeugt er keine KI-Kosten und keinen Referenten-Bypass; KI-Anfrage läuft nur mit `--include-ai`, Referenten-Assistent nur mit `--include-assistant`, Providerpflicht mit `--require-assistant-provider`, Referentenlogin nur mit echtem Resend-Magic-Link. Der Default-Timeout beträgt 45 Sekunden, damit frische Vercel-Cold-Starts nicht als falscher Browserfehler enden.
- F140/F216 Deploy-Readiness: `scripts/deploy-readiness.mjs` prüft vor `vercel deploy` CLI, Auth, Projektlink und Env-Namen für Preview/Production. Fehlende Env-Werte werden nur als Namen gemeldet; Secretwerte werden sanitizt. Mit `--pull-vercel-env` werden die Vercel-Zielwerte temporär geladen, nach dem Check gelöscht und zusätzlich gegen öffentliche Provider-Endpunkte, Placeholder-Secrets und Mail-Senderdomains geprüft.
- F133/F196/F197/F198/F199/F200/F204/F205/F206/F213/F214/F215 Self-Hosting-Basis: `Dockerfile`, `compose.yaml` und `/api/health` erlauben eine portable lokale Laufzeit mit pgvector-Postgres, Startmigrationen, lokalem Artefaktvolume und database Worker-Konfiguration. `deploy:readiness` prüft den Self-Hosting-Vertrag inzwischen statisch als `self_hosting_files=pass` für Dockerfile, Compose, `.dockerignore`, `package.json`, `scripts/script-syntax-check.mjs`, `scripts/live-load-smoke.mjs`, `scripts/self-host-smoke.mjs`, `scripts/backup-restore-smoke.mjs` und `docs/self-hosting.md`; `--self-host` nutzt `process.env` und überspringt Vercel-spezifische CLI/Auth/Projektlink-Checks. `release:gate --self-host` nutzt denselben Pfad als Full-Gate-Zielkonfiguration und bleibt ohne echte Provider-, Auth-, Live-, Live-Load- und Worker-Belege nicht release-ready. `.env.example` dokumentiert dafür `LEARNBUDDY_RELEASE_GATE_SELF_HOST=1`; `--allow-process-env` bleibt nur CI-Diagnose. `--self-host --pull-vercel-env` ist bewusst ein roter Gate-Konflikt, damit der portable Pfad nicht still Zielkonfiguration aus Vercel lädt. `npm run smoke:self-host` führt in Zielumgebungen mit Docker den echten Compose-Config-/Build-/Start-/Health-Smoke aus und räumt den Stack standardmäßig wieder ab; `--config-only` prüft nur Docker/Compose/Config. Der E2E-Gate validiert, dass fehlendes Docker als strukturierter `docker_cli=fail` erscheint. Docker war in der lokalen Codex-Umgebung nicht installiert; ein echter Container-Start-Smoke bleibt deshalb offen.
- F118/F123/F126/F127/F207/F209/F213/F215/F229/F235 CI-Gate: `.github/workflows/e2e.yml` startet für Pull Requests, `main` und manuell einen `pgvector/pgvector:pg16`-Service, installiert den PostgreSQL-Client und führt `npm run typecheck`, `npm run lint`, `npm audit --audit-level=moderate`, `npm run scripts:check`, `npm run motion:contract`, `npm run smoke:backup-restore -- --config-only`, `npm run release:gate -- --mode preview-baseline --environment development --url http://127.0.0.1:3070 --lecture-token gleitlagerung-demo --skip-e2e --skip-readiness --skip-preflight --skip-provider --skip-live --skip-worker --timeout-ms 180000`, den vollständigen mockbasierten Provider-Smoke, einen separaten `LEARNBUDDY_AI_PROVIDER=ctox-responses`-Mock-Smoke für AI, Referenten-Assistent, Chatmoderation und Fragegenerator, `npm run test:e2e` und danach `npm run admin -- preflight --profile production` gegen `E2E_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/learnbuddy_e2e_smoke` aus. Die produktionsähnliche Preflight-Emulation nutzt nicht reservierte `learnbuddy.cloud`-Hosts, damit `.example`-/`.test`-Dummywerte nicht als Release-Konfiguration trainiert werden.
- F119 Dependency-Audit: Vor Releases muss `npm audit --audit-level=moderate` ohne Befund laufen. Der aktuelle Lockfile nutzt Overrides für `postcss@8.5.15` und `esbuild@0.28.1`; Playwright ist konsistent auf `1.61.0`.
- F120/F165 Chatfragenmoderation und öffentlicher Guard: `LEARNBUDDY_CHAT_MODERATION_PROVIDER=ai` nutzt den serverseitigen AIProvider für `accepted|ignored`-Entscheidungen und persistiert Provider, Modell, Confidence und Signals. Der öffentliche Chatfrage-POST begrenzt den Requestkörper, verlangt einen pseudonymen `anonymousKey` und rate-limitiert pro Lecture/Key vor dem Moderationsaufruf. Production-Preflight blockiert lokale Chatmoderation als kritischen Fehler.
- F142 Referenten-Assistent: `LEARNBUDDY_LECTURER_ASSISTANT_PROVIDER=ai` nutzt den serverseitigen AIProvider für WYSIWYG-nahe Antworten im Studio und behält den lokalen Planungsagenten als Fallback. Production-Preflight blockiert den lokalen Assistenten als kritischen Fehler.
- F144 Referenten-Assistenten-UI-Smoke: Der Standard-E2E prüft den sichtbaren Studio-Pfad für providerbasierte Assistentenantworten inklusive `Assistent an dieser Folie`, sichtbarer Antwort, `AIProvider genutzt`, Reload-Persistenz und Logout-Schutz. Der öffentliche Live-Smoke kann denselben Pfad mit `--include-assistant --require-assistant-provider` gegen Preview/Production prüfen.
- F253 Provider-Smoke-Assistentenvertrag: Der `lecturer_assistant`-Check akzeptiert und validiert denselben Toolkatalog wie die echte serverseitige Assistentenkette: `source_note`, `slide_point`, `review_draft` und `evaluation_focus`. Der CTOX-Responses-Mock liefert `evaluation_focus`, und der E2E-Gate prüft diese Action im secretfreien Toolplan-Detail, damit echte Provider-Live-Smokes nicht an legitimen Evaluation-Fokus-Plänen scheitern.
- F121/F207 Motion-/Design-Smoke: UI-Änderungen müssen `docs/learnbuddy-motion-design-spec.md` einhalten. `npm run motion:contract` prüft Tokens, Aufbauklassen, Reduced-Motion, Presence, Quizdrawer, Overlays, Slide-Wechsel und Studio-Sheets statisch; vor Release zusätzlich mindestens Learn geschlossen/offen, Evaluation, Studio, Studio-Fragen, Studio-Toolmenü und 390px Mobile per Browser prüfen. `npm run test:e2e` bleibt Pflichtgate.
- F208/F223/F227/F238/F252 Deploy-Readiness-/Preflight-Remediation: `npm run deploy:readiness -- --environment preview|production` gibt rote Checks zusätzlich unter `blockers` aus und führt bei fehlenden Env-Namen unter `details.remediation.required` und `details.remediation.alternativeGroups` providergruppierte Zwecke und konkrete `vercel env add`-Befehle. Für Preview ergänzt die Ausgabe `branchCommand`, weil Vercel CLI 52 bei nicht-interaktiven Preview-Werten einen Git-Branch verlangen kann; Werte für alle Preview-Branches sollten über Vercel Dashboard oder API-Upsert gesetzt werden. Sobald Werte geprüft werden können, blockiert `provider_mode_values` lokale oder unsupported Provider-Modi wie Console-Mail, lokale KI, lokalen Assistenten, lokale Chatmoderation, lokalen Question-Generator, lokale Embeddings, deaktiviertes OCR oder lokale STT. `npm run admin -- preflight --profile preview|production` gibt kritische Konfigurationsfehler ebenfalls unter `blockers` aus. Die Ausgabe enthält keine Secretwerte und kann deshalb in CI-/Operator-Logs bleiben.
- F209/F216 Dummy-Zielwert-Guard: `deploy:readiness`, Admin-Preflight und Full-Release-Gate blockieren reservierte `.example`-/`.test`-/`.invalid`-Hosts in Preview/Production-Konfigurationen; `deploy:readiness` blockiert zusätzlich offensichtliche Placeholder-Secrets, wenn echte `process.env`- oder per Vercel gepullte Zielwerte geprüft werden. Für Beispiele und CI müssen deshalb plausible, nicht reservierte Hostnamen oder echte Ziel-Origins verwendet werden.
- F210/F211 Mail-Sender-Guard: `EMAIL_FROM` wird in `deploy:readiness --self-host`, im Admin-Preflight und im Runtime-MailProvider als echter Preview-/Production-Wert geprüft. Nicht parsebare Adressen, lokale/private Domains und reservierte Beispiel-/Test-Domains sind rot; der Runtime-Negativtest startet einen isolierten Production-Server und erwartet für reservierte Senderdomains einen neutralen 502 ohne `magicLink`. `.env.example` nutzt deshalb eine eigene Hochschul-/Organisationsdomain als Vorlage.
- F212 Backup-/Restore-Smoke: `npm run smoke:backup-restore` prüft `pg_dump`, `psql`, Admin-Status, Dump-Erzeugung, Restore in eine explizit leere Ziel-DB, Statuscount-Vergleich, erwarteten Public Token und den Nonempty-Restore-Guard. `--reset-restore-database` ist nur für lokale Smoke-Datenbanken zulässig. Der lokale Beleg vom 19. Juni 2026 lief gegen `learnbuddy_e2e_smoke` nach `learnbuddy_backup_restore_smoke` mit 11/11 Checks grün; der Dump `output/backup-restore-smoke/learnbuddy-current.sql` hatte 163261 Bytes und der zweite Restore in die nun nicht-leere Ziel-DB wurde erwartungsgemäß blockiert.
- F213/F229 Release-Gate-Local-Contract: `npm run scripts:check` validiert alle `.mjs`-Dateien unter `scripts/` per `node --check`. Das vollständige `npm run release:gate` führt im lokalen Gate-Block nun zusätzlich `script_syntax`, `motion_contract` und `backup_restore_config` aus, bevor E2E, Deploy-Readiness, Provider-, Live-, Live-Load- und Worker-Smokes die Zielumgebung prüfen. `deploy:readiness` verlangt denselben Syntax-Entrypoint im Operational-Contract. CI führt denselben Orchestrierungsvertrag als deterministischen `preview-baseline`-Contract ohne Ziel-Smokes aus, damit Änderungen an `scripts/release-gate.mjs` nicht nur durch Einzelkommandos abgedeckt sind. Ein gekürzter lokaler Beleg am 19. Juni 2026 lief mit 12/12 Skripten grün und zeigte zusätzlich `live_smoke=pass` und `live_load_smoke=pass`.
- F214 Live-Load-Smoke: `npm run smoke:live-load` prüft eine laufende Ziel-App mit standardmäßig 30 pseudonymen Teilnehmenden über die öffentlichen Studentenschnittstellen. Der Check schreibt `student_joined` und `answer_selected`, misst p95-Antwortlatenz und validiert die Leaderboard-Konsistenz für den aktuellen anonymen Schlüssel. Das Full-Release-Gate führt ihn als `live_load_smoke` aus; `--skip-load` ist nur Diagnose und verhindert wie andere Skips `releaseReady=true`. `npm run test:e2e` führt denselben Smoke gegen den isolierten E2E-Server aus. Der lokale Beleg vom 19. Juni 2026 lief gegen `http://localhost:3001` mit 8/8 Checks grün, 30 Join-Events, 116 parallelen Antwort-Events, `answer_load.p95Ms=92` und Leaderboard-Self `rank=1`, `points=30`, `correct=12`, `answers=12`.
- F215 Backup-/Restore-Config im CI-Gate: CI installiert `postgresql-client` und führt `npm run smoke:backup-restore -- --config-only` vor dem Provider-Smoke aus. Dadurch sind `pg_dump`, `psql` und das operative Backup-Script nicht nur lokal und im Release-Gate, sondern in jedem Pull-Request-Gate sichtbar.
- F141 UI-Contract-Smoke: Nach Änderungen an Rolleinstieg, Hotspots, Quizdrawer, Inspector/Leaderboard oder Studio-Sheets zusätzlich Startseite, Learn-Frage, 390px-Mobile, Leaderboard und Studio-Fragen-Sheet per Playwright prüfen. Der Quizdrawer darf beim Niveauwechsel nicht in der Höhe springen; aktueller Referenzwert: 280/280/280 px bei 1.0/4.0/2.0.
- F122/F143/F155/F156/F189/F235/F246 Provider-Smoke: `npm run provider:smoke -- --profile production` ist der aktive Roundtrip-Check für externe Provider. Für Teilchecks kann `--only ai,lecturer_assistant,chat_moderation,question_generator,embedding,ocr,storage,mail,stt` genutzt werden; unbekannte Check-Namen sind ein harter Fehler, und die Ausgabe darf keine Secrets enthalten. Preview-/Production-Smokes ohne `--mock` weisen lokale und private Provider-Base-URLs vor dem ersten Request ab. Der lokale Mockserver nutzt standardmäßig einen freien OS-Port; `--mock-port` ist nur für gezielte Diagnose nötig. `--mock` überschreibt im Smoke-Prozess vorhandene Provider-Endpunkte und Tokens mit Mockwerten, damit CI oder lokale Shell-Env keine echten Provider aufruft. Wenn dabei `LEARNBUDDY_AI_PROVIDER=ctox-responses` gesetzt ist, nutzt der Mock bewusst `/v1/responses` und weist die vier AI-nahen Checks mit `provider=ctox-responses` aus; wenn `LEARNBUDDY_STT_PROVIDER=self-hosted-vllm-realtime` gesetzt ist, nutzt der STT-Mock bewusst `/v1/realtime` per WebSocket und weist `transport=websocket` aus. Ohne diese Schalter bleibt der vollständige Mock-Smoke beim OpenAI-kompatiblen Chatpfad und beim Mistral/Voxtral-Transcription-Pfad.
- F191 Resend-kompatibler Mail-Gateway: `LEARNBUDDY_RESEND_BASE_URL` oder `RESEND_BASE_URL` wird jetzt vom Runtime-MailProvider und vom Provider-Smoke gleich verwendet. Der Wert ist optional; wenn er in Preview/Production gesetzt ist, muss er eine öffentliche HTTP(S)-URL sein und darf nicht auf lokale oder private Netzwerkziele zeigen.

## Release-Preflight

Für Vercel/Neon/Resend:

```bash
DATABASE_URL="postgres://..." \
LEARNBUDDY_DEPLOYMENT_ENV=production \
NEXT_PUBLIC_APP_URL="https://learnbuddy.your-university.edu" \
AUTH_SECRET="..." \
LEARNBUDDY_MAIL_PROVIDER=resend \
RESEND_API_KEY="..." \
EMAIL_FROM="LearnBuddy <noreply@your-university.edu>" \
LEARNBUDDY_JOB_PROVIDER=database \
LEARNBUDDY_WORKER_SECRET="..." \
CRON_SECRET="..." \
LEARNBUDDY_STORAGE_PROVIDER=vercel-blob \
BLOB_READ_WRITE_TOKEN="..." \
LEARNBUDDY_AI_PROVIDER=ctox-responses \
LEARNBUDDY_LLM_PROXY_API_KEY="..." \
LEARNBUDDY_LECTURER_ASSISTANT_PROVIDER=ai \
LEARNBUDDY_CHAT_MODERATION_PROVIDER=ai \
LEARNBUDDY_CHAT_QUESTION_LIMIT_PER_WINDOW=5 \
LEARNBUDDY_EMBEDDING_PROVIDER=openai-compatible \
LEARNBUDDY_EMBEDDING_BASE_URL="https://..." \
LEARNBUDDY_EMBEDDING_API_KEY="..." \
LEARNBUDDY_OCR_PROVIDER=http \
LEARNBUDDY_OCR_BASE_URL="https://..." \
LEARNBUDDY_OCR_API_KEY="..." \
LEARNBUDDY_OCR_MODEL=learnbuddy-ocr \
LEARNBUDDY_OCR_LANGUAGE=de \
LEARNBUDDY_STT_PROVIDER=mistral-voxtral \
LEARNBUDDY_STT_MODEL=voxtral-mini-latest \
LEARNBUDDY_STT_LANGUAGE=de \
MISTRAL_API_KEY="..." \
npm run admin -- preflight --profile production
```

Für Self-Hosting oder einen eigenen vLLM/Voxtral-Gateway kann der STT-Teil stattdessen so gesetzt werden:

```bash
LEARNBUDDY_STT_PROVIDER=self-hosted-vllm \
LEARNBUDDY_STT_BASE_URL="https://stt.your-university.edu" \
LEARNBUDDY_STT_API_KEY="..." \
LEARNBUDDY_STT_MODEL=voxtral-mini-latest \
npm run admin -- preflight --profile production
```

Fuer einen vLLM-Realtime-Gateway wird stattdessen der WebSocket-Pfad gesetzt:

```bash
LEARNBUDDY_STT_PROVIDER=self-hosted-vllm-realtime \
LEARNBUDDY_STT_REALTIME_BASE_URL="wss://stt.your-university.edu" \
LEARNBUDDY_STT_API_KEY="..." \
LEARNBUDDY_STT_MODEL=mistralai/Voxtral-Mini-4B-Realtime-2602 \
npm run admin -- preflight --profile production
```

Die vollständige Preview-/Production-Checkliste inklusive Vercel-Link, Env-Namen und Live-Smoke steht in `docs/deployment-checklist.md`.

Erwartung: `ok=true`, `criticalFailures=0`. Warnungen oder Fehler sind vor dem Deploy zu klären. Der Preflight ruft keine externen KI-, Storage-, Mail- oder STT-Dienste aktiv auf; danach folgt der aktive Provider-Smoke:

```bash
LEARNBUDDY_PROVIDER_SMOKE_EMAIL="qa@your-university.edu" \
LEARNBUDDY_STT_SMOKE_FILE="/path/to/short-audio.webm" \
npm run provider:smoke -- --profile production
```

Für gestaffelte Releases kann gezielt geprüft werden, zum Beispiel `npm run provider:smoke -- --profile production --only ai,lecturer_assistant,chat_moderation,question_generator,embedding,ocr,storage,mail,stt`. `--only` akzeptiert nur diese bekannten Check-Namen; Tippfehler brechen den Smoke mit `selection=fail` ab. Der `ai`-Check verlangt dabei eine normale Providerantwort und einen nativen SSE-Stream, damit der Learn-Modus nicht nur lokal simuliertes Streaming belegt. Der öffentliche Browser-Smoke kann denselben Beleg mit `npm run smoke:live -- --include-ai --require-ai-provider ...` am sichtbaren `KI Chat`-Panel prüfen; das Full-Release-Gate setzt diesen Schalter automatisch. Der `question_generator`-Pfad deckt inzwischen auch Assistenten-`review_draft` ab: Bei aktivem AI-Fragegenerator erzeugen Local- und Postgres-Repository die vier Review-Varianten über `generateQuestionVariantsForMaterial`, nicht über lokale Platzhalter. Rote Provider-, Live-, Live-Load-, Worker-, Self-Host- und Backup-/Restore-Smoke-Fehler erscheinen zusätzlich unter `blockers`, sodass Endpunkt-, Auth-, Payload-, Browser-, Last-, Container-, Worker-, Backup- oder Artefaktformatfehler ohne Durchsuchen der vollständigen Checkliste sichtbar sind. Zusätzlich müssen `npm run lint`, `npm audit --audit-level=moderate` und `npm run test:e2e` lokal oder im CI mit einer isolierten Postgres-Testdatenbank grün sein; der E2E-Gate muss dabei die Wiederverwendung eines bereits konsumierten Magic Links ablehnen.

Im vollständigen Release-Gate gilt ein strengerer Vertrag als beim Einzelbefehl: `npm run release:gate -- --mode full ...` akzeptiert `--provider-only` nur, wenn exakt das vollständige Set `ai,lecturer_assistant,chat_moderation,question_generator,embedding,ocr,storage,mail,stt` geprüft wird. Teilmengen wie `--provider-only mail` sind weiterhin für Diagnose möglich, aber sie setzen `releaseReady` nicht auf `true`; unbekannte Namen werden in `provider_smoke_coverage.details.unknown` ausgewiesen. Zusätzlich erzeugt `release_target=fail` ein rotes Gate, wenn `--mode full` mit `--environment development`, `http://localhost`, `.local`, link-lokalen, privaten, reservierten oder multicast Netzwerkzielen läuft. JSON-basierte Child-Steps müssen außerdem parsebares JSON liefern; ein Exit 0 ohne JSON erscheint als Blocker mit `reason=missing_json`, weil ein stummer Wrapper kein Release-Beleg ist.

## Offene Punkte

- Neon-Cloud-Instanz ist für Preview angebunden: Projekt `damp-sun-55979489` ist migriert/geseedet, und die öffentliche Vercel-Preview `https://learn-buddy-chh03jyzb-metric-spaces-projects.vercel.app` meldet `/api/health` mit `database=pass`. Vercel Functions sind per `vercel.json` auf `fra1` gepinnt. Lokaler Postgres-Backup/Restore mit `pg_dump`/`psql`, Browserprüfung, `smoke:backup-restore` und Production-Preflight gegen eine migrierte lokale Postgres-DB sind weiterhin grün; Worker und Standalone-Export sind auf der Preview inklusive Vercel Blob im Preview-Baseline-Gate live geprüft. Ausstehend ist der vollständige providerbasierte Preview-Smoke mit Resend, CTOX/LLM, Question-Generator, Embeddings, OCR und STT-Providerwerten.
- Echter Resend-Versand mit verifizierter Absenderdomain, realem `RESEND_API_KEY`, `EMAIL_FROM` und Vercel-Environment ist über `npm run provider:smoke -- --profile production --only mail` aktiv prüfbar; der lokale und externe No-Leak-Mailmodus, Production-Guardrails gegen Console-/Blackhole-Mail und Platzhalter-Secret sowie der Production-Preflight für Resend-Konfiguration sind E2E-grün.
- Providerbasierte OCR-/Vision-Extraktion ist für gescannte Uploadkandidaten lokal und im Mock-Gate grün; offen bleiben OCR-Live-Smokes mit produktivem OCR-/Vision-Provider, tiefere visuelle PPTX/PDF-Layout-Rekonstruktion jenseits providerseitiger Regionen und authentifizierte Live-Smokes mit echten Chat-/Question-Generator-/Embedding-/OCR-Provider-Tokens. Aktuell sind Notiz-/Text-Chunking, URL-HTML-Extraktion, textbasierte PDF/PPTX-Upload-Extraktion, PPTX-Relationship-Notes, Chart-XML, Bild-Alt-Texte, getaggte PDF-Bildinhalte mit OCR-Hinweis, OCR-Text aus Scan-Kandidaten im E2E-Materialupload, providerseitige OCR-Layoutregionen als `OCR-Layout`-Spur in Materialchunks, sichtbare `Extraktion eingeschränkt`-Steps fuer OCR-lose Quellen ohne Scheinfragen, persistierter Material-Jobstatus, lokaler providerneutraler `JobProvider`, HTTP-Broker-Registrierung, database Worker-/Queue-Ausführung, Worker-Retry-/Dead-Letter-Policy, providerneutrale Embeddings, OpenAI-kompatible externe Embeddings, pgvector-Retrieval und LLM-basierte Materialfragegenerierung über den bestehenden AIProvider grün.
- Studentische Chatfragen werden persistiert, können providerbasiert über den bestehenden AIProvider mit Auditfeldern bewertet werden, bleiben im Referentenstudio manuell übernehmbar/ignorierbar und sind als Signalquelle in Themencluster integriert. Der öffentliche Chatfrage-Eingang ist mit Pflicht-`anonymousKey`, 4-KiB-Requestlimit und Rate Limit vor Provider-Moderation abgesichert; offen bleibt der echte Live-Smoke mit produktivem CTOX-Token und längeren Diskussionsverläufen.
- Live-Transkriptsegmente werden persistiert und deterministisch gefiltert; Browser-Mikrofon, PCM16-WAV-Capture mit MediaRecorder-Fallback, eigener STT-Proxy, lokaler STT-Fallback, automatische Segmentierung mit Kandidatenliste, Mistral/Voxtral-Transcription-Adapter, OpenAI-kompatibler Self-Hosted-vLLM-STT-Adapter und serverseitiger vLLM-Realtime-WebSocket-Adapter sind E2E-/Provider-Smoke-grün. Offen bleiben durchgehend bidirektionale Browser-zu-Provider-Realtime-Relays ohne segmentierten Proxy-Hop sowie echte STT-Live-Smokes mit produktiven Mistral- oder Self-Hosted-vLLM-Werten.
- Eine auditierbare Prompt-Historie, Qualitätsentscheidung, Prompt-Registry, Template-Editor, lokaler Testlauf und Modellvergleich pro Review-Variante sind persistiert; offen bleiben echte Provider-Testläufe, echte Provider-Kosten und aggregierte Review-Qualitätsmetriken über mehrere reale Durchführungen.
- Standalone-Exporte sind versioniert, self-contained, offline renderbar, prüfbar, öffentlich ohne Account herunterladbar, im Offline-HTML mit `WCAG 2.2 AA baseline` versehen und nur bei authentifizierten Referenten-Downloads in Postgres als Historie persistiert; Manifest, Asset-Prüfsummen, ZIP-Manifest-Einträge mit byte- und SHA-256-genauer Gegenprobe gegen die tatsächlichen Archiv-Einträge, Data-URI-Audio-Fallback, echte hochgeladene Dozentenaudio-Dateien im Archiv-ZIP, optionale WAV-Audiosegmente pro Folie, lokale Quizinteraktion, Tastaturbedienung, ARIA-Live-Feedback, ein reload-stabiles Storage-Artefakt außerhalb des synchronen Route-Downloads, persistierte Archivjobs mit Status/Dauer/Artefaktlink, der providerneutrale lokale JobProvider, HTTP-Broker-Registrierung, database Worker-/Queue-Ausführung, Worker-Retry-/Dead-Letter-Policy, Vercel-Blob-Adapter und HTTP-Object-Storage-Adapter sind E2E-grün. Der Vercel/Neon/Blob-Preview-Smoke ist ebenfalls grün.
- Vertiefte Analytics wie repository-basiertes Public-Token-Leaderboard aus serverseitig validierten Antwortevents, Zeit-Buckets, eine WYSIWYG-konfigurierbare Evaluation pro Vorlesung, Reihenvorlagen, versionierte Evaluationsverläufe pro Vorlesung, eine erste Fragequalitätskarte, Themencluster inklusive Chatfrage-Signalen, Reihenverläufe, automatische Verbesserungsvorschläge, übernehmbare Folien-/Fragenentwürfe, Review-Historie mit strukturierten Diffs, Wirksamkeitsvergleich für übernommene Fragenänderungen, Prompt-Historie mit Qualitätsentscheidung, Prompt-Registry und das fullscreen-nahe WYSIWYG-Referentenstudio mit visueller Desktop-Folienleiste, ohne permanente Inspector- oder Planleiste, mit schmaler Icon-Objektleiste direkt auf der Folie, direkten Folien-Layern, Planung als unterem Popover, direkter Quizkarten-Bearbeitung, Auswertung, Evaluation, Material, foliennahem Referenten-Assistent, strukturiertem Agent-Loop mit Agent-Schritten, Quellengewichtung und Toolvorschlägen, provider-validiertem Toolplan, AIProvider-Fallback auf den bestehenden CTOX-Responses-Pfad, CSRF-Schutz für cookie-authentifizierte Referenten-Mutationen, geschlossenem öffentlichen Event-Debug-Dump, allowlistetem Public-Event-POST, Assistenten-Toolaktionen für Fragenentwürfe, Folienpunkte, Quellen-Notizen und Evaluation-Fokus und mobiler Referentenarbeit sind E2E-grün; die serverseitige Toolkette aus Quellen-Notiz, Folienpunkt, providerbasiertem Fragenentwurf und Evaluation-Fokus ist E2E-grün; offen bleiben echte Provider-Live-Smokes für den Assistenten, weitere Toolklassen jenseits dieser Kette sowie langfristige Wirksamkeitsvergleiche über mehrere reale Durchführungen.
- KI-Proxy hat Ablaufdatum, Nutzungsanalytics, serverseitige fachliche Zweckbindung, Requestgrößenlimit vor JSON-Parse, pro Vorlesung, pro Vorlesungsreihe und pro Konto konfigurierbares Tageslimit, pro Vorlesung, pro Vorlesungsreihe und pro Konto konfigurierbares Tokenbudget, pgvector-basierte Quellenanzeige, provider-nativen NDJSON-Antwortstream im Learn-Modus, einen OpenAI-kompatiblen externen Chat-Provider hinter dem eigenen Proxy, providerbasierte Material-Fragegenerierung, OpenAI-kompatible externe Embeddings, providerbasierten Referenten-Assistenten mit strukturiertem Toolplan, serverseitiger Toolkette und einen providerneutralen Kostenbericht mit Warnschwellen; offen bleiben authentifizierte Live-Smokes mit echten CTOX-/Question-Generator-/Embedding-Providerwerten und echte Provider-Abrechnung.
