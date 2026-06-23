# LearnBuddy Deployment Checklist

Stand: 19. Juni 2026.

## Lokaler Release-Gate

Vor Preview oder Production müssen lokal beziehungsweise in CI grün sein:

```bash
npm run typecheck
npm run lint
npm run build
npm audit --audit-level=moderate
npm run scripts:check
npm run motion:contract
npm run smoke:backup-restore -- --config-only
npm run provider:smoke -- --profile production --mock --only ai,lecturer_assistant,chat_moderation,question_generator,embedding,ocr,storage,mail,stt
LEARNBUDDY_AI_PROVIDER=ctox-responses npm run provider:smoke -- --profile production --mock --only ai,lecturer_assistant,chat_moderation,question_generator
npm run test:e2e
npm run admin -- preflight --profile production
npm run smoke:live -- --url http://127.0.0.1:3070 --lecture-token gleitlagerung-demo
npm run smoke:live-load -- --url http://127.0.0.1:3070 --lecture-token gleitlagerung-demo
npm run smoke:worker -- --url http://127.0.0.1:3070 --lecture-token gleitlagerung-demo
npm run deploy:readiness -- --environment preview
npm run deploy:readiness -- --environment preview --pull-vercel-env --scope metric-spaces-projects
npm run release:gate -- --mode preview-baseline --environment development --url http://127.0.0.1:3070 --lecture-token gleitlagerung-demo --skip-e2e --skip-readiness --skip-preflight --skip-provider --skip-live --skip-worker --timeout-ms 180000
```

Der aktuelle lokale Stand erfüllt diese Gates gegen `learnbuddy_e2e_smoke`; `npm run scripts:check` validiert alle operativen `.mjs`-Entrypoints unter `scripts/` per `node --check` und prüft zusätzlich den side-effect-free `--help`/`-h`-Vertrag, und `npm run release:gate` führt diesen Check zusammen mit Motion-Contract und Backup-/Restore-Config-Smoke im lokalen Gate-Block aus. `.github/workflows/e2e.yml` installiert zusätzlich den PostgreSQL-Client und führt `npm run smoke:backup-restore -- --config-only` sowie den CI-sicheren `release:gate --mode preview-baseline`-Contract im Pull-Request-Gate aus, damit `pg_dump`/`psql`, das operative Backup-Script und die Release-Gate-Orchestrierung nicht nur lokal geprüft werden. CI führt außerdem den vollständigen mockbasierten Provider-Smoke und einen separaten `ctox-responses`-Mock-Smoke für AI, Referenten-Assistent, Chatmoderation und Fragegenerator aus, damit der bevorzugte `llm.ctox.dev/v1/responses`-Pfad nicht nur dokumentiert, sondern regressionsgesichert ist. `npm run smoke:live-load` simuliert standardmäßig 30 pseudonyme Studierende über die öffentlichen Event- und Leaderboard-APIs und prüft Join, Antwortwrites, p95-Latenz und Leaderboard-Konsistenz; derselbe Smoke wird zusätzlich innerhalb von `npm run test:e2e` gegen den isolierten E2E-Server ausgeführt. `npm run deploy:readiness -- --pull-vercel-env` lädt Vercel-Zielwerte temporär, löscht die Datei wieder, aktiviert ohne Secret-Ausgabe die Wertguards für produktionsfähige Provider-Modi, öffentliche Provider-Endpunkte, Placeholder-Secrets und `EMAIL_FROM` und gibt rote Checks zusätzlich kompakt unter `blockers` aus. `admin -- preflight`, `provider:smoke`, `smoke:live`, `smoke:worker`, `smoke:live-load`, `smoke:self-host` und `smoke:backup-restore` folgen demselben Blocker-Vertrag. `release:gate --pull-vercel-env` reicht dieselben Zielwerte an `deploy:readiness --local` weiter. `npm run motion:contract` prüft die Design-/Motion-Spezifikation aus `docs/learnbuddy-motion-design-spec.md` gegen CSS-Tokens, Aufbauklassen, Presence-States, Shared-Element-Motion und die zentralen Learn-/Live-/Studio-Komponenten. `npm run test:e2e` läuft mit 15/15 Tests inklusive side-effect-free `--help`/`-h` für alle zwölf `.mjs`-Entrypoints unter `scripts/` und `scripts:check`-Help-Zusammenfassung, Standalone-ZIP-Manifest-Byte/Hash-Vertrag, Duplicate-KI-Fragevarianten-Guard, serverseitigem Session-Ablauf, fail-closed Secure-Cookie-Runtime-Config für Preview/Production, ausgelieferten Security Headern und no-store-Cache-Control für dynamische Pfade, 30-Studierenden-Leaderboard-Smoke, kanonischem Magic-Link-Origin-Guard gegen manipulierte `Origin`-/`x-forwarded-host`-Header, expliziten Deployment-/StorageProvider-Env-Namen, `forbidden_env`-Guard gegen lokale URL-Fetch-Schalter, `provider_mode_values`-, `provider_endpoint_values`-, `placeholder_env_values`- und `mail_sender_values`-Check für `process.env`- und Vercel-Env-Pull-basierte Readiness im Deploy-Gate, Runtime-MailProvider-Sender-Guard gegen reservierte Absenderdomains, Self-Host-Full-Gate-Vertrag inklusive `LEARNBUDDY_RELEASE_GATE_SELF_HOST=1`, rotem `--self-host --pull-vercel-env` und strukturiertem Docker-missing-Fall im Self-Host-Smoke, Magic-Link-Consume-Guard, Magic-Link-Oversize-Guard und persistentem Rate-Limit, Artefakt-Download-Guards gegen Traversal, absolute Pfade, Backslashes, falsche Provider und absolute Storage-Read-URLs aus manipulierten Artefaktdatensätzen, URL-Material-Guard gegen private DNS-/Loopback-Ziele ohne Serverrequest, Provider-Endpoint-Guard gegen lokale/private und reservierte Beispiel-/Test-Ziele für Mail, AI, Embeddings, OCR, STT, HTTP-Jobs und HTTP-Storage, Mail-Sender-Guard gegen reservierte Absenderdomains, Provider-Smoke-Endpoint-Guard für echte Preview-/Production-Smokes ohne `--mock`, CTOX-Responses-Mock-Smoke über `/v1/responses`, Worker-401 ohne Secret und Limit-Clamping auf 25, Public-Token-/AnonymousKey-Guards für APIs und gerenderte Seiten, authentifizierten Entity-ID-Guards für Referentenrouten, serverseitig validiertem Public-Event-Guard für `/api/events`, öffentlichem Chatfrage-Guard mit Pflicht-`anonymousKey`, Größenlimit und 429 vor Provider-Moderation, Learn-KI-Request-Guard mit Größenlimit vor Provideraufruf, authentifiziertem Lecturer-JSON-Body-Guard, Multipart-Upload-/STT-Body-Guard vor `formData()`, Browser-STT-WAV-Segmentvertrag, race-festem Quellen-Upload vor Materialverarbeitung, Standalone-Export-Record-Guard, CSRF-403 für cookie-authentifizierte Referenten-Mutationsrouten ohne Token, geschlossenem öffentlichem `GET /api/events`, LearnBuddy-Motion-Contract nach `docs/learnbuddy-motion-design-spec.md`, FLIP-Shared-Element vom Studio-Folienstrip zur Stage, provider-nativem Learn-KI-Stream im Mock-Providerpfad und providerbasierten Assistenten-Review-Draft-Varianten.

`npm run deploy:readiness` prüft zusätzlich den portablen Self-Hosting- und Operational-Vertrag als `self_hosting_files`: `Dockerfile`, `compose.yaml`, `.dockerignore`, `package.json`, `scripts/script-syntax-check.mjs`, `scripts/live-load-smoke.mjs`, `scripts/self-host-smoke.mjs`, `scripts/backup-restore-smoke.mjs` und `docs/self-hosting.md` müssen den dokumentierten Node-/Postgres-/Artefakt-/Worker-/Healthcheck-/Backup-/Restore-Smoke-Pfad enthalten. Der zusätzliche Check `env_example_contract` verlangt, dass `.env.example` die Deploy-Readiness-Schalter für Vercel-Env-Pull, Self-Host, lokale Diagnose, Scope und Timeout sowie die zentralen Release-Gate-Schalter dokumentiert. `--help` und `-h` sind bei allen zwölf `.mjs`-Entrypoints reine Usage-Aufrufe mit Exit 0 und starten keine Checks, Builds, Provider-Smokes, Serverstarts, Docker- oder Datenbankzugriffe. Für spätere Self-Hosting-Ziele läuft derselbe Check ohne Vercel-CLI/Auth/Projektlink über `npm run deploy:readiness -- --environment production --self-host`. Das vollständige Self-Hosting-Gate nutzt `npm run release:gate -- --mode full --environment production --self-host --url https://... --lecture-token gleitlagerung-demo --email referent@your-university.edu` und bleibt wie das Vercel-Full-Gate erst ohne übersprungene Provider-, Auth-, Live-, Live-Load- und Workerchecks release-ready. Ein echter Container-Start-Smoke läuft über `npm run smoke:self-host`, sobald Docker in der Zielumgebung verfügbar ist; `npm run smoke:self-host -- --config-only` prüft nur die Compose-Konfiguration. Ein echter Backup-/Restore-Smoke läuft über `npm run smoke:backup-restore` mit Quell-DB und bewusst leerer Restore-DB; `--config-only` prüft nur `pg_dump`/`psql`.

Preview-/Production-Konfigurationen dürfen keine reservierten `.example`-, `.test`- oder `.invalid`-Hosts mehr als App-, Provider- oder Mail-Sender-Ziel verwenden. Der Runtime-MailProvider blockiert solche `EMAIL_FROM`-Domains ebenfalls vor dem Versand, damit ein übersprungener Preflight nicht zu einer scheinbar funktionierenden Mailkonfiguration führt. Für Diagnose-Shells sind realistische, nicht reservierte Hostnamen oder echte Ziel-Origins zu setzen; offensichtliche Platzhalter-Secrets bleiben in `deploy:readiness --self-host` rot.

## Vercel-Projekt

Aktueller Befund in dieser Umgebung:

- Vercel CLI ist installiert.
- CLI ist eingeloggt als `metricspaceai-5511`.
- Das Repository ist mit `metric-spaces-projects/learn-buddy` verlinkt.
- `vercel.json` deklariert `framework: "nextjs"`, `regions: ["fra1"]` für Functions nahe an Neon `aws-eu-central-1` und den geschützten Worker-Cron.
- Neon-Preview-Projekt `damp-sun-55979489` liegt in `aws-eu-central-1`; Migrationen sind inklusive `0022_slim_jocasta.sql` angewendet und die Demo-Vorlesung `gleitlagerung-demo` ist für `referent@example.edu` geseedet.
- Vercel Blob Store `learn-buddy-artifacts` ist für Preview in `cdg1` verbunden.
- Preview-Env enthält bereits `DATABASE_URL`, `AUTH_SECRET`, `LEARNBUDDY_DEPLOYMENT_ENV`, `LEARNBUDDY_MAIL_PROVIDER`, `LEARNBUDDY_JOB_PROVIDER`, `LEARNBUDDY_WORKER_SECRET`, `CRON_SECRET`, `LEARNBUDDY_AI_PROVIDER`, `LEARNBUDDY_LECTURER_ASSISTANT_PROVIDER`, `LEARNBUDDY_CHAT_MODERATION_PROVIDER`, `LEARNBUDDY_QUESTION_GENERATOR=ai`, `LEARNBUDDY_EMBEDDING_PROVIDER`, `LEARNBUDDY_OCR_PROVIDER=http`, `LEARNBUDDY_STT_PROVIDER`, `LEARNBUDDY_STT_MODEL`, `LEARNBUDDY_STT_LANGUAGE`, `LEARNBUDDY_STORAGE_PROVIDER` und `BLOB_READ_WRITE_TOKEN`.
- Es fehlen noch `RESEND_API_KEY`, `EMAIL_FROM`, `LEARNBUDDY_EMBEDDING_BASE_URL`, `LEARNBUDDY_EMBEDDING_API_KEY`, `LEARNBUDDY_OCR_BASE_URL`, `LEARNBUDDY_OCR_API_KEY`, ein `MISTRAL_API_KEY` oder `LEARNBUDDY_STT_API_KEY` sowie ein `LEARNBUDDY_LLM_PROXY_API_KEY` oder `CTOX_LLM_PROXY_API_KEY`.
- `NEXT_PUBLIC_APP_URL` ist für Production Pflicht. Für Vercel Preview kann die App die jeweilige `VERCEL_URL` als HTTPS-URL verwenden; nach einem konkreten Preview-Deploy wird die zurückgegebene URL für `smoke:live` explizit übergeben.
- Vercel SSO Deployment Protection ist für dieses Projekt deaktiviert, damit Studierende Preview-/Production-Links ohne Vercel-Login öffnen können.
- Neue öffentliche Preview `https://learn-buddy-e5jmpt4zh-metric-spaces-projects.vercel.app` (`dpl_CggG545w1NYiUQQ48XuWEY227pA1`, `readyState=READY`) ist deployed und als aktuelle Baseline geprüft: `/api/health` liefert `ok=true` und `database=pass` mit no-store Cache-Control, CSP, HSTS, `X-Frame-Options`, `X-Content-Type-Options` und `Permissions-Policy`; das Preview-Baseline-Gate liefert Health, Student Live und Learn grün, Referentenlogin bewusst übersprungen, 30 pseudonyme Teilnahmen grün und Worker/Storage grün.
- Das echte Preview-Readiness-Gate mit gepullter Vercel-Env steht aktuell bei 14/15 Checks: `provider_mode_values`, `provider_endpoint_values`, `placeholder_env_values` und `mail_sender_values` sind grün; rot bleibt ausschließlich `required_env` für die oben gelisteten Resend-, CTOX/LLM-Proxy-, Embedding-, OCR- und STT-Werte.
- Die ältere öffentliche Preview `https://learn-buddy-h0q1vopbr-metric-spaces-projects.vercel.app` zeigte im Preview-Baseline-Gate Runtime-Drift bei `/api/events` und wird nicht mehr als aktueller Baseline-Beleg verwendet.
- Preview-Worker/Storage ist im kombinierten Preview-Baseline-Gate mit gepullter Vercel-Ziel-Env live geprüft: Worker-Auth-Guard, Queue-Enqueue, database Worker-Ausführung und App-interne Storage-Artefaktroute sind grün. Der direkte `npm run smoke:worker` benötigt lokal dieselbe Ziel-Env, insbesondere `DATABASE_URL` und Worker-Secrets.
- Kombiniertes Preview-Baseline-Gate ist geprüft: `npm run release:gate -- --mode preview-baseline --environment preview --pull-vercel-env --scope metric-spaces-projects --url https://learn-buddy-e5jmpt4zh-metric-spaces-projects.vercel.app --lecture-token gleitlagerung-demo --skip-local --skip-readiness --skip-preflight --skip-provider --timeout-ms 180000` lädt die Vercel-Preview-Env temporär, führt öffentlichen Live-Smoke, 30-Teilnehmer-Live-Load-Smoke und Worker-/Storage-Smoke aus, endet mit `ok=true` und bleibt korrekt `releaseReady=false`, `productionReady=false`.
- Ein versehentlich erzeugtes Production-Deployment ohne Provider-Secrets wurde wieder gelöscht; die immutable URL liefert `DEPLOYMENT_NOT_FOUND`.

Vor einem sinnvollen Preview-Smoke:

```bash
npm run deploy:readiness -- --environment preview
npm run deploy:readiness -- --environment preview --pull-vercel-env --scope metric-spaces-projects
```

Wenn `required_env` rot ist, enthält die JSON-Ausgabe unter `blockers[]` denselben roten Check kompakt und unter `details.remediation` eine secretfreie Checkliste mit Providerzweck und konkreten `vercel env add <NAME> preview|production`-Befehlen. Zusätzlich gruppiert `details.remediation.completionGroups` die offenen Punkte nach `mail`, `ai`, `embeddings`, `ocr`, `stt`, `storage` usw.; `missingRequired` sind Pflichtnamen, `missingAlternativeGroups` markieren Blöcke, bei denen genau eine der genannten Alternativen reicht. Für Preview ergänzt die Ausgabe zusätzlich `branchCommand`, weil Vercel CLI 52 bei nicht-interaktiven Preview-Werten einen Git-Branch verlangen kann; für Werte auf allen Preview-Branches sind Vercel Dashboard oder API-Upsert zuverlässiger. Werte werden dabei nicht ausgegeben; die Secrets werden interaktiv oder über die Vercel-Oberfläche gesetzt. Sobald alle Namen vorhanden sind, prüft der zweite Befehl die gepullten Zielwerte auf lokale, Fallback- oder unsupported Provider-Modi, lokale/private oder reservierte Provider-Endpunkte, offensichtliche Placeholder-Secrets und ungültige beziehungsweise reservierte Mail-Senderdomains.

Ein Baseline-Smoke ohne vollständige Provider-Env darf Health, Student Live, Learn sowie den secretgeschützten Worker-/Storage-Export belegen. Als vollständiger Deploy-Smoke zählt erst der Lauf mit Magic-Link-Mail, KI, providerbasierter Fragegenerierung, Embeddings, OCR, STT, Storage-Export und Worker gegen eine öffentliche HTTPS-Preview oder Production-URL. Der maschinenlesbare Sammelpunkt dafür ist `npm run release:gate -- --mode full ...`; `releaseReady=true` darf nur aus diesem vollständigen Gate ohne übersprungene Checks kommen. `productionReady=true` darf zusätzlich nur bei `--environment production` erscheinen, damit Preview- und Production-Belege nicht vermischt werden. Full-Gates akzeptieren keine lokalen, link-local, privaten, reservierten oder multicast Zielhosts.

## Erforderliche Preview/Production Env

Mindestens:

```bash
NEXT_PUBLIC_APP_URL=https://... # Production Pflicht; Preview kann VERCEL_URL nutzen.
LEARNBUDDY_DEPLOYMENT_ENV=preview
AUTH_SECRET=...
DATABASE_URL=postgres://...
LEARNBUDDY_MAIL_PROVIDER=resend
RESEND_API_KEY=...
EMAIL_FROM=LearnBuddy <noreply@your-university.edu>
LEARNBUDDY_STORAGE_PROVIDER=http
LEARNBUDDY_STORAGE_ENDPOINT=https://...
LEARNBUDDY_STORAGE_API_KEY=...
LEARNBUDDY_JOB_PROVIDER=database
LEARNBUDDY_WORKER_SECRET=...
CRON_SECRET=...
LEARNBUDDY_AI_PROVIDER=ctox-responses
LEARNBUDDY_LLM_PROXY_API_KEY=...
LEARNBUDDY_LECTURER_ASSISTANT_PROVIDER=ai
LEARNBUDDY_CHAT_MODERATION_PROVIDER=ai
LEARNBUDDY_QUESTION_GENERATOR=ai
LEARNBUDDY_CHAT_QUESTION_LIMIT_PER_WINDOW=5
LEARNBUDDY_EMBEDDING_PROVIDER=openai-compatible
LEARNBUDDY_EMBEDDING_BASE_URL=https://...
LEARNBUDDY_EMBEDDING_API_KEY=...
LEARNBUDDY_OCR_PROVIDER=http
LEARNBUDDY_OCR_BASE_URL=https://...
LEARNBUDDY_OCR_API_KEY=...
LEARNBUDDY_OCR_MODEL=learnbuddy-ocr
LEARNBUDDY_OCR_LANGUAGE=de
LEARNBUDDY_STT_PROVIDER=mistral-voxtral
LEARNBUDDY_STT_MODEL=voxtral-mini-latest
LEARNBUDDY_STT_LANGUAGE=de
MISTRAL_API_KEY=...
# Alternative fuer self-hosted/vLLM:
# LEARNBUDDY_STT_PROVIDER=self-hosted-vllm
# LEARNBUDDY_STT_BASE_URL=https://stt.your-university.edu
# LEARNBUDDY_STT_API_KEY=...
# Optionaler Realtime-WebSocket-Pfad fuer PCM16/WAV-Segmente:
# LEARNBUDDY_STT_PROVIDER=self-hosted-vllm-realtime
# LEARNBUDDY_STT_REALTIME_BASE_URL=wss://stt.your-university.edu
# LEARNBUDDY_STT_API_KEY=...
```

Für Production `LEARNBUDDY_DEPLOYMENT_ENV=production` setzen.

## Deploy-Smoke

Nach Link und Env:

```bash
npm run deploy:readiness -- --environment preview
npm run deploy:readiness -- --environment preview --pull-vercel-env --scope metric-spaces-projects
vercel deploy --yes --archive=tgz --target=preview --scope metric-spaces-projects
```

Danach die zurückgegebene Preview-URL prüfen. Für Preview wird die URL dem Smoke explizit übergeben; für Production muss dieselbe URL zusätzlich als `NEXT_PUBLIC_APP_URL` gesetzt sein:

```bash
curl -f https://<preview-url>/api/health
NEXT_PUBLIC_APP_URL=https://<preview-url> LEARNBUDDY_PROVIDER_SMOKE_EMAIL=referent@your-university.edu npm run provider:smoke -- --profile production --only mail,ai,lecturer_assistant,chat_moderation,question_generator,embedding,ocr,storage,stt
npm run smoke:live -- --url https://<preview-url> --lecture-token gleitlagerung-demo
npm run smoke:worker -- --url https://<preview-url> --lecture-token gleitlagerung-demo --timeout-ms 180000 --limit 5
```

Der `ai`-Provider-Smoke zählt nur als grün, wenn der Provider sowohl eine normale Antwort als auch einen nativen SSE-Stream liefert. Das ist der technische Beleg dafür, dass der Learn-Modus nicht auf lokal simuliertes Streaming zurückfällt. `provider:smoke`, `smoke:live`, `smoke:worker`, `smoke:live-load`, `smoke:self-host` und `smoke:backup-restore` geben rote Roundtrips beziehungsweise Ziel-/Auth-/Last-/Container-/Backup-/Artefaktfehler zusätzlich unter `blockers` aus; diese Kurzliste ist die erste Anlaufstelle bei Endpunkt-, Auth-, Payload-, Browser-, Worker- oder Artefaktformatfehlern, während `checks` die vollständige Audit-Spur bleibt.

Vollständiges Release-Gate nach echtem Magic-Link-Empfang:

```bash
LEARNBUDDY_RELEASE_GATE_MAGIC_LINK='https://<preview-url>/auth/magic?token=...' \
  npm run release:gate -- --mode full --environment preview --pull-vercel-env --scope metric-spaces-projects --url https://<preview-url> --lecture-token gleitlagerung-demo --email referent@your-university.edu
```

Das Gate bündelt lokale Gates, Deploy-Readiness, zielabhängigen Admin-Preflight, aktive Provider-Smokes, authentifizierten Browser-Smoke mit KI/Assistent und Worker-/Storage-Smoke. Vercel-Full-Gates laden mit `--pull-vercel-env` die Ziel-Env temporär aus Vercel in den Prozess, löschen die Datei direkt wieder und rufen Deploy-Readiness anschließend als `deploy:readiness --local` gegen genau diese Zielwerte auf; Secretwerte werden nicht ausgegeben. Self-Hosting-Full-Gates nutzen stattdessen `--self-host`, lesen `process.env` als Zielkonfiguration und rufen intern `deploy:readiness --self-host` auf; `--self-host --pull-vercel-env` ist ein absichtlicher Gate-Fehler. Für `--environment preview` nutzt der Admin-Preflight Preview-Regeln und erhält die geprüfte URL als lokale `VERCEL_URL`, für `--environment production` bleiben die Production-Env-Regeln streng. `--mode full` akzeptiert nur `preview` oder `production` als Ziel und verlangt eine öffentliche HTTPS-URL; `localhost`, `.local`, link-lokale und private Netzwerkziele können kein `releaseReady=true` erzeugen. Bewusste CI-Diagnosen dürfen weiter `--allow-process-env` verwenden, setzen aber ohne vollständige Checks kein `releaseReady=true`. Bei `--environment production` muss die geprüfte URL dieselbe Origin wie `NEXT_PUBLIC_APP_URL` haben. Der Magic Link muss eine absolute HTTPS-URL derselben geprüften App-Origin sein und auf `/auth/magic?token=...` zeigen, damit Preview- und Production-Logins nicht vermischt werden. Wenn kein `LEARNBUDDY_PROVIDER_SMOKE_EMAIL` gesetzt ist, nutzt das Release-Gate `--email` auch als Smoke-Mail-Empfänger. Im `preview-baseline`-Modus darf es Teilsmokes orchestrieren, setzt dann aber ausdrücklich `releaseReady=false` und `productionReady=false`. Mock-Provider sind im Full-Gate verboten und nur für lokale/CI-Providerpfadprüfung außerhalb von `--mode full` zulässig. `--provider-only` ist im Full-Gate nur erlaubt, wenn alle Providerchecks enthalten sind: `ai,lecturer_assistant,chat_moderation,question_generator,embedding,ocr,storage,mail,stt`; ein Teilset bleibt Diagnose, aber kein Release-Beleg. Unbekannte Providercheck-Namen sind Fehler und werden nicht stillschweigend ignoriert. Die JSON-Ausgabe enthält zusätzlich `blockers`: fehlgeschlagene und übersprungene Top-Level-Checks; bei verschachtelten JSON-Schritten übernimmt das Gate bevorzugt die `blockers` des Unterbefehls und fällt nur bei älteren Ausgaben auf rote `checks` zurück. JSON-Unterbefehle müssen maschinenlesbares JSON ausgeben; Exit 0 ohne JSON wird als `reason=missing_json` blockiert, damit stumme oder kaputte Wrapper kein grünes Release-Gate erzeugen. Dadurch bleiben Admin-Preflight-Warnungen aus Child-Blockern heraus, während fehlende Env-Namen, Providerfehler, Live-Smoke-Preconditions und Worker-/Storage-Artefaktfehler direkt sichtbar bleiben. Erwartete Self-Host-Skips werden dort nicht als Child-Blocker ausgegeben. Secretwerte werden weiterhin nicht ausgegeben.

`LEARNBUDDY_RESEND_BASE_URL` beziehungsweise `RESEND_BASE_URL` ist optional und nur für Resend-kompatible Gateways gedacht. Wenn gesetzt, nutzt der Runtime-MailProvider denselben Endpoint wie der Provider-Smoke; Preview/Production-Gates blockieren lokale oder private Werte.

Browser-Smoke auf der Preview:

- `/lecturer/login`: Magic Link über Resend anfordern.
- Magic Link öffnen und Dashboard laden.
- `/api/health`: `ok=true`, `database=pass`.
- Student Live Link öffnen und pseudonym teilnehmen.
- 30-Studierenden-Smoke aus dem lokalen Gate als Referenz nehmen; auf Preview zusätzlich mindestens mehrere parallele Student-Teilnahmen manuell oder per Script gegen dieselbe Vorlesung prüfen.
- Learn-Modus öffnen, Frage beantworten, KI-Chat testen; im Full-Smoke muss `--include-ai --require-ai-provider` den provider-nativen Stream am sichtbaren `KI Chat`-Panel belegen.
- Archiv/Standalone-Export speichern und Artefakt downloaden.
- Worker/Cron mit Secret einmal auslösen oder `npm run smoke:worker` gegen dieselbe Preview ausführen.
- Worker-/Storage-Smoke zählt nur App-interne Artefaktrouten (`/api/storage-artifacts/...` oder `/api/local-artifacts/...`) als gültigen Downloadbeleg. Absolute Storage-URLs sind ein Fehler, weil Provider-Endpunkte und Presigned URLs nicht Teil des öffentlichen Clientvertrags sein dürfen.
- Direkte Live-Smokes und Worker-/Storage-Smokes gegen öffentliche Preview-/Production-Ziele müssen eine HTTPS-App-URL verwenden. Plain-HTTP bleibt nur für lokale/private Diagnoseziele zulässig.

Für den authentifizierten Referenten-Smoke gibt es keinen Produktions-Shortcut. Erst Magic Link über Resend anfordern, den Link aus der Mail übernehmen und dann ausführen:

```bash
LEARNBUDDY_LIVE_SMOKE_MAGIC_LINK='https://<preview-url>/auth/magic?token=...' \
  npm run smoke:live -- --url https://<preview-url> --lecture-token gleitlagerung-demo --auth --require-auth --email referent@your-university.edu
```

`--include-ai` löst zusätzlich eine echte Learn-KI-Anfrage aus und sollte nur genutzt werden, wenn Tokenverbrauch und Providerrechnung für den Smoke gewollt sind. `--require-ai-provider` verlangt dabei am `KI Chat`-Panel `data-ai-stream-source="provider"` und einen nicht lokalen Provider; das Full-Release-Gate setzt diesen Schalter automatisch.
`--include-assistant --require-assistant-provider` löst zusätzlich im authentifizierten Referentenstudio eine Assistentenantwort aus und verlangt den sichtbaren Schritt `AIProvider genutzt`; auch das sollte nur genutzt werden, wenn Providerkosten für den Smoke gewollt sind.

Bei öffentlichen Zielen akzeptiert `--require-auth` nur einen expliziten absoluten HTTPS-Magic-Link derselben App-Origin. Relative Links und lokal gerenderte Console-Links sind nur für lokale/private Diagnoseziele zulässig.

Erst wenn diese Checks gegen die öffentliche Preview grün sind, ist der Vercel/Neon/Resend-Deploypfad als live verifiziert zu werten.
