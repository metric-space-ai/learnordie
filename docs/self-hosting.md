# LearnBuddy Self-Hosting

LearnBuddy bleibt auf Vercel/Neon/Resend ausgerichtet, aber die Laufzeit soll portabel bleiben. Dieses Runbook beschreibt die lokale Docker-Compose-Variante als Self-Hosting-Basis.

## Lokaler Compose-Start

```bash
docker compose up --build
```

Reproduzierbarer Smoke in einer Umgebung mit Docker:

```bash
npm run smoke:self-host
```

Nur Compose-Konfiguration prüfen, ohne Container zu starten:

```bash
npm run smoke:self-host -- --config-only
```

Der Compose-Stack startet:

- `postgres`: Postgres 16 mit `pgvector`.
- `app`: Next.js Production-Server auf `http://localhost:3000`.
- persistente Volumes für Postgres und lokale Artefakte.

Beim App-Start läuft `npm run db:migrate`, danach `next start`. Der Healthcheck liegt unter:

```bash
curl http://localhost:3000/api/health
```

## Lokale Defaults

`compose.yaml` ist für eine lokale Self-Host-Probe konfiguriert:

- `LEARNBUDDY_DEPLOYMENT_ENV=local`
- `LEARNBUDDY_MAIL_PROVIDER=console`
- `LEARNBUDDY_STORAGE_PROVIDER=local`
- `LEARNBUDDY_JOB_PROVIDER=database`
- `LEARNBUDDY_STT_PROVIDER=local`

Diese Defaults sind absichtlich niedrigschwellig. Für echte Produktion müssen Secrets und externe Provider über eine eigene Env-Datei oder Deployment-Secrets ersetzt werden.

## Produktions-Overrides

Für einen produktiven Self-Host-Betrieb mindestens setzen:

```bash
LEARNBUDDY_DEPLOYMENT_ENV=production
NEXT_PUBLIC_APP_URL=https://learnbuddy.your-university.edu
AUTH_SECRET=...
DATABASE_URL=postgres://...
LEARNBUDDY_MAIL_PROVIDER=resend
RESEND_API_KEY=...
EMAIL_FROM=LearnBuddy <noreply@your-university.edu>
LEARNBUDDY_STORAGE_PROVIDER=http
LEARNBUDDY_STORAGE_ENDPOINT=https://object-storage.your-university.edu
LEARNBUDDY_STORAGE_API_KEY=...
LEARNBUDDY_JOB_PROVIDER=database
LEARNBUDDY_WORKER_SECRET=...
CRON_SECRET=...
LEARNBUDDY_AI_PROVIDER=ctox-responses
LEARNBUDDY_LLM_PROXY_API_KEY=...
LEARNBUDDY_LECTURER_ASSISTANT_PROVIDER=ai
LEARNBUDDY_CHAT_MODERATION_PROVIDER=ai
LEARNBUDDY_CHAT_QUESTION_LIMIT_PER_WINDOW=5
LEARNBUDDY_EMBEDDING_PROVIDER=openai-compatible
LEARNBUDDY_EMBEDDING_BASE_URL=...
LEARNBUDDY_EMBEDDING_API_KEY=...
LEARNBUDDY_STT_PROVIDER=self-hosted-vllm
LEARNBUDDY_STT_BASE_URL=https://stt.your-university.edu
LEARNBUDDY_STT_API_KEY=...
LEARNBUDDY_STT_MODEL=voxtral-mini-latest
```

Optional kann ein eigener vLLM-Realtime-Gateway genutzt werden. Dieser Pfad ist fuer PCM16/WAV-Segmente gedacht und spricht serverseitig `/v1/realtime` per WebSocket; Browser und Standalone-Export erhalten weiterhin keinen Provider-Key.

```bash
LEARNBUDDY_STT_PROVIDER=self-hosted-vllm-realtime
LEARNBUDDY_STT_REALTIME_BASE_URL=wss://stt.your-university.edu
LEARNBUDDY_STT_API_KEY=...
LEARNBUDDY_STT_MODEL=mistralai/Voxtral-Mini-4B-Realtime-2602
```

Alternativ kann ein gehosteter Mistral/Voxtral-Pfad genutzt werden:

```bash
LEARNBUDDY_STT_PROVIDER=mistral-voxtral
LEARNBUDDY_STT_BASE_URL=https://api.mistral.ai
MISTRAL_API_KEY=...
```

Vor einem echten Deployment:

```bash
npm run scripts:check
npm run admin -- preflight --profile production
npm run provider:smoke -- --profile production
npm run deploy:readiness -- --environment production --self-host
npm run smoke:live-load -- --url https://learnbuddy.your-university.edu --lecture-token gleitlagerung-demo
npm run smoke:backup-restore -- --source-url "$DATABASE_URL" --restore-url "$RESTORE_DATABASE_URL"
npm run release:gate -- --mode full --environment production --self-host --url https://learnbuddy.your-university.edu --lecture-token gleitlagerung-demo --email referent@your-university.edu
```

`deploy:readiness --self-host` prüft dabei ohne Vercel-CLI/Auth/Projektlink die Env-Namen aus `process.env`, öffentliche Provider-Endpunkte und den Self-Hosting-Vertrag: `Dockerfile`, `compose.yaml`, `.dockerignore`, `package.json`, `scripts/script-syntax-check.mjs`, `scripts/live-load-smoke.mjs`, `scripts/self-host-smoke.mjs`, `scripts/backup-restore-smoke.mjs` und dieses Runbook müssen den erwarteten Node-/Postgres-/Artefakt-/Worker-/Healthcheck-/Smoke-Pfad enthalten. Das ersetzt keinen echten `docker compose up --build`-Start in der Zielumgebung, verhindert aber driftende Container-Dateien.

`release:gate --self-host` nutzt denselben Self-Hosting-Readiness-Pfad innerhalb des vollständigen Full-Gates. Der Lauf bleibt erst dann release-ready, wenn zusätzlich Admin-Preflight, echte Provider-Smokes, authentifizierter Live-Smoke mit echtem Magic Link und Worker-/Storage-Smoke gegen die öffentliche HTTPS-Ziel-URL ohne Skip grün sind.

`--self-host` und `--pull-vercel-env` dürfen nicht kombiniert werden. Self-Hosting nutzt die Zielkonfiguration aus `process.env`; Vercel-Env-Pull ist nur für Vercel-Preview-/Production-Gates vorgesehen.

## Worker-Betrieb

Bei `LEARNBUDDY_JOB_PROVIDER=database` verarbeitet die App Jobs nicht implizit im Referentenrequest. Dafür gibt es drei portable Optionen:

- Vercel Cron über `GET /api/jobs/worker/cron`.
- eigener Cron gegen `GET /api/jobs/worker/cron` mit `Authorization: Bearer $CRON_SECRET`.
- manuell oder per Supervisor:

```bash
npm run admin -- worker-once --url https://learnbuddy.your-university.edu --secret "$LEARNBUDDY_WORKER_SECRET"
```

## Backups und Retention

Backups:

```bash
DATABASE_URL="postgres://..." npm run admin -- backup-sql --out backups/learnbuddy.sql
```

Backup-/Restore-Smoke:

```bash
DATABASE_URL="postgres://..." \
RESTORE_DATABASE_URL="postgres://..." \
npm run smoke:backup-restore
```

Der Smoke erzeugt per `pg_dump` einen SQL-Dump, spielt ihn per `psql` in eine explizit angegebene leere Restore-DB ein, vergleicht die Admin-Statuscounts und prüft den Schutz gegen Restore in eine nicht-leere Datenbank. Für lokale Diagnose kann `--reset-restore-database` genutzt werden, aber nur bei lokalen Hosts und eindeutig benannten Smoke-Datenbanken wie `learnbuddy_backup_restore_smoke`. Für Neon/Production muss die Restore-DB vorher bewusst leer angelegt werden.

Retention-Report:

```bash
DATABASE_URL="postgres://..." npm run admin -- retention-report --years 5
```

Retention-Cleanup als Dry-Run:

```bash
DATABASE_URL="postgres://..." npm run admin -- retention-cleanup --years 5
```

Retention-Cleanup mit Apply:

```bash
DATABASE_URL="postgres://..." npm run admin -- retention-cleanup --years 5 --apply --confirm-retention-cleanup
```

Der Cleanup redigiert pseudonyme Lernsignale. Kursinhalte, Materialien, Fragen, Reviews, Jobs und Standalone-Exporte werden als Content-Bestand berichtet und nicht automatisch gelöscht. Die verbindliche MVP-Policy liegt in `config/retention-policy.json`: Standalone-Artefakte sind als Langzeitarchiv mit mindestens 20 Jahren klassifiziert, Qualitätsaggregate dürfen nur ohne Personen- oder Sessionbezug erhalten bleiben.
