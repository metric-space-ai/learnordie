#!/usr/bin/env node
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const DEFAULT_OWNER = "admin@example.test";
const DEFAULT_AI_DAILY_LIMIT = 20;
const DEFAULT_AI_DAILY_TOKEN_LIMIT = 12000;
const retentionPolicy = JSON.parse(await readFile(new URL("../config/retention-policy.json", import.meta.url), "utf8"));

const demoLecture = {
  joinCode: "ME1-GL-2026",
  publicToken: "gleitlagerung-demo",
  title: "Gleitlagerung",
  seriesTitle: "Maschinenelemente I",
  language: "de",
  status: "learn_active",
  liveAt: "2026-06-17T10:00:00.000Z",
  examDate: "2026-07-24T00:00:00.000Z",
  aiAccessUntil: "2026-07-24T21:59:59.999Z",
  leaderboardEnabled: true,
  learnQuestionDensity: 4,
  evaluationConfig: {
    enabled: true,
    version: 1,
    updatedAt: "2026-06-17T00:00:00.000Z",
    title: "Evaluation",
    intro: "Kurze Rückmeldung zur Vorlesung.",
    understandingLabel: "Verständnis",
    paceLabel: "Tempo",
    aiHelpfulLabel: "KI-Hilfe",
    commentLabel: "Kommentar",
    submitLabel: "Evaluation senden"
  },
  slides: [
    {
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

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function numericArg(name, fallback, min, max) {
  const parsed = Number(argValue(name, fallback));
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return Math.min(max, Math.floor(parsed));
}

function resolvedRetentionPolicy(years, cutoffAt, asOf) {
  return {
    ...retentionPolicy,
    years,
    cutoffAt,
    asOf,
    pseudonymousLearningSignals: {
      ...retentionPolicy.pseudonymousLearningSignals,
      years
    }
  };
}

function printUsage() {
  console.log([
    "LearnBuddy Admin CLI",
    "",
    "Usage:",
    "  npm run admin -- seed-demo [--owner email@example.test]",
    "  npm run admin -- set-ai-budget --email email@example.test --questions 20 --tokens 12000",
    "  npm run admin -- retention-report [--years 5] [--lecture-token token]",
    "  npm run admin -- retention-cleanup [--years 5] [--lecture-token token] [--apply --confirm-retention-cleanup]",
    "  npm run admin -- worker-once --url http://localhost:3000 --secret secret [--limit 5]",
    "  npm run admin -- backup-sql --out backups/learnbuddy.sql",
    "  npm run admin -- restore-sql --file backups/learnbuddy.sql",
    "  npm run admin -- preflight [--profile local|preview|production]",
    "  npm run admin -- status",
    "",
    "Required environment:",
    "  DATABASE_URL=postgres://..."
  ].join("\n"));
}

function requiredDatabaseUrl() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for admin commands.");
  }
  return process.env.DATABASE_URL;
}

function requiredArg(name) {
  const value = argValue(name, "").trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function commandBinary(envName, fallback) {
  return process.env[envName] || fallback;
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} exited with ${code}: ${stderr || stdout}`));
    });
  });
}

async function fileSha256(filePath) {
  return crypto.createHash("sha256").update(await readFile(filePath)).digest("hex");
}

function envValue(name) {
  return (process.env[name] ?? "").trim();
}

function configuredPublicAppUrl() {
  const configured = envValue("NEXT_PUBLIC_APP_URL");
  if (configured) return configured;
  const vercelUrl = envValue("VERCEL_URL");
  if (!vercelUrl) return "";
  return vercelUrl.startsWith("http://") || vercelUrl.startsWith("https://")
    ? vercelUrl
    : `https://${vercelUrl}`;
}

function hasAnyEnv(names) {
  return names.some((name) => Boolean(envValue(name)));
}

function normalizeProfile(value) {
  const profile = (value || "local").trim().toLowerCase();
  if (profile === "prod") return "production";
  if (profile === "dev" || profile === "development" || profile === "test") return "local";
  return profile;
}

function selectedPreflightProfile() {
  return normalizeProfile(argValue("--profile", process.env.LEARNBUDDY_DEPLOYMENT_ENV || process.env.VERCEL_ENV || "local"));
}

function addPreflightCheck(checks, id, status, severity, message, details = undefined) {
  checks.push({
    id,
    status,
    severity,
    message,
    ...(details ? { details } : {})
  });
}

function failCheck(checks, id, severity, message, details = undefined) {
  addPreflightCheck(checks, id, "fail", severity, message, details);
}

function warnCheck(checks, id, message, details = undefined) {
  addPreflightCheck(checks, id, "warn", "warning", message, details);
}

function passCheck(checks, id, message, details = undefined) {
  addPreflightCheck(checks, id, "pass", "info", message, details);
}

function preflightBlockers(checks) {
  return checks
    .filter((check) => check.status === "fail" && check.severity === "critical")
    .map((check) => ({
      id: check.id,
      status: check.status,
      severity: check.severity,
      message: check.message,
      ...(check.details ? { details: check.details } : {})
    }));
}

function isLoopbackHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function normalizeHostname(hostname) {
  return hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
}

function ipv4Octets(address) {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return parts;
}

function isPrivateIpv4(address) {
  const octets = ipv4Octets(address);
  if (!octets) return false;
  const [first, second, third] = octets;
  return first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && (second === 0 || second === 168)) ||
    (first === 198 && (second === 18 || second === 19 || (second === 51 && third === 100))) ||
    (first === 203 && second === 0 && third === 113);
}

function isPrivateIpv6(address) {
  const lower = normalizeHostname(address);
  const mappedIpv4 = lower.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mappedIpv4) return isPrivateIpv4(mappedIpv4[1]);
  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("2001:db8:") || lower === "2001:db8::") return true;

  const firstSegment = Number.parseInt(lower.split(":")[0] || "0", 16);
  if (!Number.isFinite(firstSegment)) return false;
  return (firstSegment >= 0xfc00 && firstSegment <= 0xfdff) ||
    (firstSegment >= 0xfe80 && firstSegment <= 0xfebf) ||
    (firstSegment >= 0xff00 && firstSegment <= 0xffff);
}

function isLocalOrPrivateEndpointHost(hostname) {
  const lower = normalizeHostname(hostname);
  if (lower === "localhost" || lower.endsWith(".localhost") || lower.endsWith(".local")) return true;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(lower)) return isPrivateIpv4(lower);
  if (lower.includes(":")) return isPrivateIpv6(lower);
  return false;
}

function isReservedExampleEndpointHost(hostname) {
  const lower = normalizeHostname(hostname);
  return lower === "example.com" ||
    lower === "example.net" ||
    lower === "example.org" ||
    lower.endsWith(".example.com") ||
    lower.endsWith(".example.net") ||
    lower.endsWith(".example.org") ||
    lower === "example" ||
    lower.endsWith(".example") ||
    lower === "test" ||
    lower.endsWith(".test") ||
    lower === "invalid" ||
    lower.endsWith(".invalid");
}

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function deploymentEndpointError(name, value, profile, allowedProtocols = ["http:", "https:"]) {
  if (profile === "local" || !value) return "";
  const parsed = parseUrl(value);
  if (!parsed || !allowedProtocols.includes(parsed.protocol)) {
    return allowedProtocols.includes("ws:")
      ? `${name} muss eine gültige HTTP(S)- oder WS(S)-URL sein.`
      : `${name} muss eine gültige HTTP(S)-URL sein.`;
  }
  if (isLocalOrPrivateEndpointHost(parsed.hostname)) {
    return `${name} darf in Preview/Production nicht auf lokale oder private Netzwerkziele zeigen.`;
  }
  if (isReservedExampleEndpointHost(parsed.hostname)) {
    return `${name} darf in Preview/Production nicht auf reservierte Beispiel- oder Test-Hosts zeigen.`;
  }
  return "";
}

function senderDomain(value) {
  const trimmed = value.trim();
  if (!trimmed) return { domain: "", error: "" };
  const angleMatch = trimmed.match(/<([^<>]+)>$/);
  const address = (angleMatch ? angleMatch[1] : trimmed).trim().replace(/^mailto:/i, "");
  const addressMatch = address.match(/^[^\s@<>]+@([A-Za-z0-9.-]+|\[[^\]]+\])$/);
  if (!addressMatch) {
    return { domain: "", error: "EMAIL_FROM ist keine parsebare E-Mail-Adresse." };
  }
  return {
    domain: normalizeHostname(addressMatch[1] ?? ""),
    error: ""
  };
}

function mailSenderError(name, value, profile) {
  if (profile === "local" || !value) return "";
  const { domain, error } = senderDomain(value);
  if (error) return `${name} muss eine gültige Absenderadresse sein.`;
  if (isLocalOrPrivateEndpointHost(domain)) {
    return `${name} darf in Preview/Production keine lokale oder private Absenderdomain nutzen.`;
  }
  if (isReservedExampleEndpointHost(domain)) {
    return `${name} darf in Preview/Production keine reservierte Beispiel- oder Test-Absenderdomain nutzen.`;
  }
  return "";
}

function secretLooksProductionReady(value) {
  const secret = value.trim();
  const lower = secret.toLowerCase();
  return secret.length >= 32
    && !lower.includes("replace")
    && !lower.includes("placeholder")
    && !lower.includes("change-me")
    && !lower.includes("changeme")
    && lower !== "secret";
}

function selectedMailProvider() {
  return (envValue("LEARNBUDDY_MAIL_PROVIDER") || (envValue("RESEND_API_KEY") ? "resend" : "console")).toLowerCase();
}

function selectedStorageProvider() {
  return (envValue("LEARNBUDDY_STORAGE_PROVIDER") || "local").toLowerCase();
}

function selectedJobProvider() {
  return (envValue("LEARNBUDDY_JOB_PROVIDER") || "inline").toLowerCase();
}

function selectedAIProvider() {
  return (envValue("LEARNBUDDY_AI_PROVIDER") || "learnbuddy-demo").toLowerCase();
}

function selectedLecturerAssistantProvider() {
  return (envValue("LEARNBUDDY_LECTURER_ASSISTANT_PROVIDER") || "local").toLowerCase();
}

function selectedChatModerationProvider() {
  return (envValue("LEARNBUDDY_CHAT_MODERATION_PROVIDER") || "local").toLowerCase();
}

function selectedQuestionGenerator() {
  return (envValue("LEARNBUDDY_QUESTION_GENERATOR") || "local").toLowerCase();
}

function selectedEmbeddingProvider() {
  return (envValue("LEARNBUDDY_EMBEDDING_PROVIDER") || "learnbuddy-local-hash-v1").toLowerCase();
}

function selectedOCRProvider() {
  return (envValue("LEARNBUDDY_OCR_PROVIDER") || "disabled").toLowerCase();
}

function selectedSTTProvider() {
  const selected = envValue("LEARNBUDDY_STT_PROVIDER").toLowerCase();
  if (selected) return selected;
  if (envValue("LEARNBUDDY_STT_API_KEY")) return "openai-compatible";
  return envValue("MISTRAL_API_KEY") ? "mistral-voxtral" : "local";
}

function secretIsSet(name) {
  const value = envValue(name).toLowerCase();
  return Boolean(value)
    && !value.includes("replace")
    && !value.includes("placeholder")
    && !value.includes("changeme");
}

async function tableColumnExists(sql, tableName, columnName) {
  const [result] = await sql`
    select exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = ${tableName}
        and column_name = ${columnName}
    ) as ok
  `;
  return Boolean(result?.ok);
}

async function tableExists(sql, tableName) {
  const [result] = await sql`
    select exists (
      select 1
      from information_schema.tables
      where table_schema = 'public'
        and table_name = ${tableName}
        and table_type = 'BASE TABLE'
    ) as ok
  `;
  return Boolean(result?.ok);
}

async function runPreflight(sql) {
  const profile = selectedPreflightProfile();
  const strict = profile === "production";
  const checks = [];

  if (!["local", "preview", "production"].includes(profile)) {
    failCheck(checks, "profile", "critical", "Unbekanntes Preflight-Profil.", {
      allowedProfiles: ["local", "preview", "production"]
    });
  } else {
    passCheck(checks, "profile", "Preflight-Profil erkannt.", { profile });
  }

  if (envValue("DATABASE_URL")) {
    passCheck(checks, "database_url", "DATABASE_URL ist gesetzt.");
  } else {
    failCheck(checks, "database_url", "critical", "DATABASE_URL fehlt.");
  }

  try {
    const [result] = await sql`select now() as now`;
    passCheck(checks, "database_connectivity", "Postgres-Verbindung erfolgreich.", {
      serverTime: result?.now instanceof Date ? result.now.toISOString() : String(result?.now)
    });
  } catch {
    failCheck(checks, "database_connectivity", "critical", "Postgres-Verbindung fehlgeschlagen.");
  }

  try {
    const [result] = await sql`
      select exists (
        select 1
        from pg_extension
        where extname = 'vector'
      ) as ok
    `;
    if (result?.ok) passCheck(checks, "pgvector_extension", "pgvector ist installiert.");
    else failCheck(checks, "pgvector_extension", "critical", "pgvector fehlt; Material-Retrieval benötigt die Extension.");
  } catch {
    failCheck(checks, "pgvector_extension", "critical", "pgvector-Check fehlgeschlagen.");
  }

  try {
    const [result] = await sql`
      select exists (
        select 1
        from information_schema.tables
        where table_schema = 'drizzle'
          and table_name = '__drizzle_migrations'
      ) as ok
    `;
    if (result?.ok) passCheck(checks, "drizzle_migrations", "Drizzle-Migrationstabelle ist vorhanden.");
    else failCheck(checks, "drizzle_migrations", strict ? "critical" : "warning", "Drizzle-Migrationstabelle fehlt.");
  } catch {
    failCheck(checks, "drizzle_migrations", strict ? "critical" : "warning", "Drizzle-Migrationscheck fehlgeschlagen.");
  }

  try {
    const schemaChecks = [
      ["users", "email"],
      ["magic_login_tokens", "token_hash"],
      ["magic_login_tokens", "consumed_at"],
      ["magic_login_rate_limits", "bucket_hash"],
      ["magic_login_rate_limits", "attempt_count"],
      ["magic_login_rate_limits", "blocked_until"],
      ["lectures", "public_token"],
      ["asset_chunks", "embedding"],
      ["material_processing_runs", "dead_letter_at"],
      ["standalone_export_jobs", "dead_letter_at"],
      ["transcript_segments", "provider"],
      ["lecturer_assistant_messages", "metadata_json"]
    ];
    const missing = [];
    for (const [tableName, columnName] of schemaChecks) {
      if (!(await tableColumnExists(sql, tableName, columnName))) {
        missing.push(`${tableName}.${columnName}`);
      }
    }

    const requiredTables = ["question_review_items", "analytics_events", "standalone_exports"];
    for (const tableName of requiredTables) {
      if (!(await tableExists(sql, tableName))) {
        missing.push(tableName);
      }
    }

    if (missing.length === 0) {
      passCheck(checks, "schema_readiness", "Erwartete Tabellen und Spalten sind vorhanden.");
    } else {
      failCheck(checks, "schema_readiness", "critical", "Schema ist nicht auf dem erwarteten Stand.", { missing });
    }
  } catch {
    failCheck(checks, "schema_readiness", "critical", "Schema-Readiness-Check fehlgeschlagen.");
  }

  const appUrl = strict ? envValue("NEXT_PUBLIC_APP_URL") : configuredPublicAppUrl();
  const parsedAppUrl = parseUrl(appUrl);
  if (!appUrl) {
    failCheck(checks, "canonical_url", strict ? "critical" : "warning", strict ? "NEXT_PUBLIC_APP_URL fehlt." : "NEXT_PUBLIC_APP_URL oder VERCEL_URL fehlt.");
  } else if (!parsedAppUrl || !["http:", "https:"].includes(parsedAppUrl.protocol)) {
    failCheck(checks, "canonical_url", strict ? "critical" : "warning", "Canonical App URL ist keine gültige HTTP(S)-URL.");
  } else if (strict && parsedAppUrl.protocol !== "https:") {
    failCheck(checks, "canonical_url", "critical", "Production benötigt eine HTTPS-NEXT_PUBLIC_APP_URL.");
  } else if (strict && isLoopbackHost(parsedAppUrl.hostname)) {
    failCheck(checks, "canonical_url", "critical", "Production darf keine Loopback-NEXT_PUBLIC_APP_URL nutzen.");
  } else if (strict && isReservedExampleEndpointHost(parsedAppUrl.hostname)) {
    failCheck(checks, "canonical_url", "critical", "Production darf keine reservierte Beispiel- oder Test-NEXT_PUBLIC_APP_URL nutzen.");
  } else {
    passCheck(checks, "canonical_url", strict ? "NEXT_PUBLIC_APP_URL ist plausibel." : "Preview-App-URL ist plausibel.", {
      origin: parsedAppUrl.origin
    });
  }

  if (strict && !secretLooksProductionReady(envValue("AUTH_SECRET"))) {
    failCheck(checks, "auth_secret", "critical", "Production benötigt ein nicht triviales AUTH_SECRET mit mindestens 32 Zeichen.");
  } else if (!envValue("AUTH_SECRET")) {
    warnCheck(checks, "auth_secret", "AUTH_SECRET fehlt; lokale Entwicklung nutzt Fallback-Verhalten.");
  } else {
    passCheck(checks, "auth_secret", "AUTH_SECRET ist gesetzt und wird nicht ausgegeben.");
  }

  const mailProvider = selectedMailProvider();
  if (strict && (mailProvider === "console" || mailProvider === "local" || mailProvider === "blackhole" || mailProvider === "test")) {
    failCheck(checks, "mail_provider", "critical", "Production darf keinen Test-Mailprovider nutzen.", { provider: mailProvider });
  } else if (mailProvider === "resend") {
    const missing = [];
    if (!envValue("RESEND_API_KEY")) missing.push("RESEND_API_KEY");
    if (!envValue("EMAIL_FROM")) missing.push("EMAIL_FROM");
    const resendEndpointError = deploymentEndpointError(
      "LEARNBUDDY_RESEND_BASE_URL/RESEND_BASE_URL",
      envValue("LEARNBUDDY_RESEND_BASE_URL") || envValue("RESEND_BASE_URL"),
      profile
    );
    const senderError = mailSenderError("EMAIL_FROM", envValue("EMAIL_FROM"), profile);
    if (resendEndpointError) {
      failCheck(checks, "mail_provider", "critical", resendEndpointError);
    } else if (missing.length) {
      failCheck(checks, "mail_provider", strict ? "critical" : "warning", "Resend ist ausgewählt, aber Mail-Konfiguration ist unvollständig.", { missing });
    } else if (senderError) {
      failCheck(checks, "mail_provider", "critical", senderError);
    } else {
      passCheck(checks, "mail_provider", "Resend-Mailprovider ist vollständig konfiguriert.", { provider: "resend" });
    }
  } else {
    warnCheck(checks, "mail_provider", "Nicht-produktiver Mailprovider aktiv.", { provider: mailProvider });
  }

  const storageProvider = selectedStorageProvider();
  if (strict && ["", "local", "filesystem"].includes(storageProvider)) {
    failCheck(checks, "storage_provider", "critical", "Production benötigt Remote-Storage für Archive und Uploads.", { provider: storageProvider });
  } else if (["vercel", "vercel-blob", "blob"].includes(storageProvider)) {
    if (hasAnyEnv(["BLOB_READ_WRITE_TOKEN", "LEARNBUDDY_STORAGE_TOKEN"])) {
      passCheck(checks, "storage_provider", "Vercel Blob ist konfiguriert.", { provider: "vercel-blob" });
    } else {
      failCheck(checks, "storage_provider", strict ? "critical" : "warning", "Vercel Blob benötigt BLOB_READ_WRITE_TOKEN oder LEARNBUDDY_STORAGE_TOKEN.");
    }
  } else if (["http", "object-http", "external"].includes(storageProvider)) {
    const endpointError = deploymentEndpointError("LEARNBUDDY_STORAGE_ENDPOINT", envValue("LEARNBUDDY_STORAGE_ENDPOINT"), profile);
    if (endpointError) {
      failCheck(checks, "storage_provider", "critical", endpointError, { provider: "http" });
    } else if (envValue("LEARNBUDDY_STORAGE_ENDPOINT")) {
      passCheck(checks, "storage_provider", "HTTP-Object-Storage ist konfiguriert.", { provider: "http" });
    } else {
      failCheck(checks, "storage_provider", strict ? "critical" : "warning", "HTTP-Storage benötigt LEARNBUDDY_STORAGE_ENDPOINT.");
    }
  } else if (["local", "filesystem"].includes(storageProvider)) {
    warnCheck(checks, "storage_provider", "Lokaler Filesystem-Storage ist nur für Entwicklung geeignet.", { provider: storageProvider });
  } else {
    failCheck(checks, "storage_provider", "critical", "Unbekannter StorageProvider.", { provider: storageProvider });
  }

  const jobProvider = selectedJobProvider();
  if (strict && ["", "inline", "local"].includes(jobProvider)) {
    failCheck(checks, "job_provider", "critical", "Production benötigt database-, queue- oder HTTP-Jobausführung.", { provider: jobProvider });
  } else if (["database", "queue", "worker", "async"].includes(jobProvider)) {
    const missing = [];
    if (!envValue("LEARNBUDDY_WORKER_SECRET")) missing.push("LEARNBUDDY_WORKER_SECRET");
    if (strict && !envValue("CRON_SECRET")) missing.push("CRON_SECRET");
    if (strict && !envValue("LEARNBUDDY_WORKER_APP_URL") && !envValue("NEXT_PUBLIC_APP_URL")) missing.push("LEARNBUDDY_WORKER_APP_URL or NEXT_PUBLIC_APP_URL");
    if (missing.length) {
      failCheck(checks, "job_provider", strict ? "critical" : "warning", "Database-Worker ist unvollständig konfiguriert.", { provider: "database", missing });
    } else {
      passCheck(checks, "job_provider", "Database-Worker ist konfiguriert.", { provider: "database" });
    }
  } else if (["http", "webhook", "external"].includes(jobProvider)) {
    const endpointError = deploymentEndpointError("LEARNBUDDY_JOB_ENDPOINT", envValue("LEARNBUDDY_JOB_ENDPOINT"), profile);
    if (endpointError) {
      failCheck(checks, "job_provider", "critical", endpointError, { provider: "http" });
    } else if (envValue("LEARNBUDDY_JOB_ENDPOINT")) {
      passCheck(checks, "job_provider", "HTTP-Jobprovider ist konfiguriert.", { provider: "http" });
    } else {
      failCheck(checks, "job_provider", strict ? "critical" : "warning", "HTTP-Jobprovider benötigt LEARNBUDDY_JOB_ENDPOINT.");
    }
  } else if (["inline", "local"].includes(jobProvider)) {
    warnCheck(checks, "job_provider", "Inline-Jobs sind nur für Entwicklung und kleine lokale Smokes geeignet.", { provider: jobProvider });
  } else {
    failCheck(checks, "job_provider", "critical", "Unbekannter JobProvider.", { provider: jobProvider });
  }

  const aiProvider = selectedAIProvider();
  if (strict && ["", "learnbuddy-demo", "demo", "local"].includes(aiProvider)) {
    failCheck(checks, "ai_provider", "critical", "Production benötigt den serverseitigen KI-Proxyprovider.", { provider: aiProvider });
  } else if (["ctox-responses", "ctox", "llm.ctox.dev", "responses"].includes(aiProvider)) {
    const endpointName = envValue("LEARNBUDDY_LLM_PROXY_BASE_URL")
      ? "LEARNBUDDY_LLM_PROXY_BASE_URL"
      : envValue("CTOX_LLM_PROXY_BASE_URL")
        ? "CTOX_LLM_PROXY_BASE_URL"
        : envValue("LEARNBUDDY_AI_BASE_URL")
          ? "LEARNBUDDY_AI_BASE_URL"
          : "";
    const endpointValue = endpointName ? envValue(endpointName) : "";
    const endpointError = deploymentEndpointError(endpointName, endpointValue, profile);
    if (endpointError) {
      failCheck(checks, "ai_provider", "critical", endpointError, { provider: "ctox-responses" });
    } else if (hasAnyEnv(["LEARNBUDDY_LLM_PROXY_API_KEY", "CTOX_LLM_PROXY_API_KEY", "FALLBACK_LLM_PROXY_TOKEN", "LEARNBUDDY_AI_API_KEY"])) {
      passCheck(checks, "ai_provider", "CTOX Responses KI-Proxy ist konfiguriert.", { provider: "ctox-responses" });
    } else {
      failCheck(checks, "ai_provider", strict ? "critical" : "warning", "CTOX Responses KI-Proxy benötigt ein serverseitiges Proxy-Token.");
    }
  } else if (["openai-compatible", "http"].includes(aiProvider)) {
    const missing = [];
    if (!envValue("LEARNBUDDY_AI_BASE_URL")) missing.push("LEARNBUDDY_AI_BASE_URL");
    if (!envValue("LEARNBUDDY_AI_API_KEY")) missing.push("LEARNBUDDY_AI_API_KEY");
    const endpointError = deploymentEndpointError("LEARNBUDDY_AI_BASE_URL", envValue("LEARNBUDDY_AI_BASE_URL"), profile);
    if (endpointError) {
      failCheck(checks, "ai_provider", "critical", endpointError, { provider: "openai-compatible" });
    } else if (missing.length) {
      failCheck(checks, "ai_provider", strict ? "critical" : "warning", "OpenAI-kompatibler KI-Provider ist unvollständig.", { missing });
    } else {
      passCheck(checks, "ai_provider", "OpenAI-kompatibler KI-Provider ist konfiguriert.", { provider: "openai-compatible" });
    }
  } else if (["learnbuddy-demo", "demo", "local"].includes(aiProvider)) {
    warnCheck(checks, "ai_provider", "Lokaler Demo-KI-Provider ist nur für Entwicklung geeignet.", { provider: aiProvider });
  } else {
    failCheck(checks, "ai_provider", "critical", "Unbekannter AIProvider.", { provider: aiProvider });
  }

  const lecturerAssistantProvider = selectedLecturerAssistantProvider();
  if (strict && ["", "local", "deterministic", "demo"].includes(lecturerAssistantProvider)) {
    failCheck(checks, "lecturer_assistant_provider", "critical", "Production benötigt providerbasierte Referenten-Assistenz.", {
      provider: lecturerAssistantProvider || "local"
    });
  } else if (["ai", "llm", "external", "provider", "ctox", "ctox-responses", "openai-compatible", "http"].includes(lecturerAssistantProvider)) {
    passCheck(checks, "lecturer_assistant_provider", "Referenten-Assistent nutzt den serverseitigen AIProvider.", {
      provider: lecturerAssistantProvider,
      aiProvider
    });
  } else if (["", "local", "deterministic", "demo"].includes(lecturerAssistantProvider)) {
    warnCheck(checks, "lecturer_assistant_provider", "Lokaler Referenten-Assistent ist nur ein Entwicklungsfallback.", {
      provider: lecturerAssistantProvider || "local"
    });
  } else {
    failCheck(checks, "lecturer_assistant_provider", "critical", "Unbekannter LecturerAssistantProvider.", {
      provider: lecturerAssistantProvider
    });
  }

  const chatModerationProvider = selectedChatModerationProvider();
  if (strict && ["", "local", "rubric", "deterministic"].includes(chatModerationProvider)) {
    failCheck(checks, "chat_moderation_provider", "critical", "Production benötigt providerbasierte Chatfragenmoderation.", {
      provider: chatModerationProvider || "local"
    });
  } else if (["ai", "llm", "external", "provider", "ctox", "ctox-responses", "openai-compatible", "http"].includes(chatModerationProvider)) {
    passCheck(checks, "chat_moderation_provider", "Chatfragenmoderation nutzt den serverseitigen AIProvider.", {
      provider: chatModerationProvider,
      aiProvider
    });
  } else if (["", "local", "rubric", "deterministic"].includes(chatModerationProvider)) {
    warnCheck(checks, "chat_moderation_provider", "Lokale Chatfragenmoderation ist nur ein Entwicklungsfallback.", {
      provider: chatModerationProvider || "local"
    });
  } else {
    failCheck(checks, "chat_moderation_provider", "critical", "Unbekannter ChatModerationProvider.", {
      provider: chatModerationProvider
    });
  }

  const questionGenerator = selectedQuestionGenerator();
  if (strict && ["", "local", "deterministic", "demo"].includes(questionGenerator)) {
    failCheck(checks, "question_generator_provider", "critical", "Production benötigt providerbasierte Material-Fragegenerierung.", {
      provider: questionGenerator || "local"
    });
  } else if (["ai", "llm", "external", "provider", "ctox", "ctox-responses", "openai-compatible", "http"].includes(questionGenerator)) {
    passCheck(checks, "question_generator_provider", "Material-Fragegenerator nutzt den serverseitigen AIProvider.", {
      provider: questionGenerator,
      aiProvider
    });
  } else if (["", "local", "deterministic", "demo"].includes(questionGenerator)) {
    warnCheck(checks, "question_generator_provider", "Lokaler Material-Fragegenerator ist nur ein Entwicklungsfallback.", {
      provider: questionGenerator || "local"
    });
  } else {
    failCheck(checks, "question_generator_provider", "critical", "Unbekannter QuestionGenerator.", {
      provider: questionGenerator
    });
  }

  const embeddingProvider = selectedEmbeddingProvider();
  if (strict && ["", "learnbuddy-local-hash-v1", "local"].includes(embeddingProvider)) {
    failCheck(checks, "embedding_provider", "critical", "Production benötigt einen echten serverseitigen Embedding-Provider.", { provider: embeddingProvider });
  } else if (["openai-compatible", "http"].includes(embeddingProvider)) {
    const missing = [];
    if (!envValue("LEARNBUDDY_EMBEDDING_BASE_URL")) missing.push("LEARNBUDDY_EMBEDDING_BASE_URL");
    if (!envValue("LEARNBUDDY_EMBEDDING_API_KEY")) missing.push("LEARNBUDDY_EMBEDDING_API_KEY");
    const endpointError = deploymentEndpointError("LEARNBUDDY_EMBEDDING_BASE_URL", envValue("LEARNBUDDY_EMBEDDING_BASE_URL"), profile);
    if (endpointError) {
      failCheck(checks, "embedding_provider", "critical", endpointError, { provider: "openai-compatible" });
    } else if (missing.length) {
      failCheck(checks, "embedding_provider", strict ? "critical" : "warning", "Embedding-Provider ist unvollständig.", { missing });
    } else {
      passCheck(checks, "embedding_provider", "Externer Embedding-Provider ist konfiguriert.", { provider: "openai-compatible" });
    }
  } else if (["learnbuddy-local-hash-v1", "local"].includes(embeddingProvider)) {
    warnCheck(checks, "embedding_provider", "Lokaler Hash-Embedding-Provider ist nur für Entwicklung und Tests geeignet.", { provider: embeddingProvider });
  } else {
    failCheck(checks, "embedding_provider", "critical", "Unbekannter EmbeddingProvider.", { provider: embeddingProvider });
  }

  const ocrProvider = selectedOCRProvider();
  if (strict && ["", "disabled", "local", "none"].includes(ocrProvider)) {
    failCheck(checks, "ocr_provider", "critical", "Production benötigt einen externen OCR-/Vision-Provider für gescannte Materialien.", { provider: ocrProvider });
  } else if (["http", "external", "vision", "ocr"].includes(ocrProvider)) {
    const missing = [];
    if (!envValue("LEARNBUDDY_OCR_BASE_URL")) missing.push("LEARNBUDDY_OCR_BASE_URL");
    if (!envValue("LEARNBUDDY_OCR_API_KEY")) missing.push("LEARNBUDDY_OCR_API_KEY");
    const endpointError = deploymentEndpointError("LEARNBUDDY_OCR_BASE_URL", envValue("LEARNBUDDY_OCR_BASE_URL"), profile);
    if (endpointError) {
      failCheck(checks, "ocr_provider", "critical", endpointError, { provider: "http" });
    } else if (missing.length) {
      failCheck(checks, "ocr_provider", strict ? "critical" : "warning", "OCR-/Vision-Provider ist unvollständig.", { missing });
    } else {
      passCheck(checks, "ocr_provider", "OCR-/Vision-Provider ist konfiguriert.", {
        provider: "http",
        model: envValue("LEARNBUDDY_OCR_MODEL") || "learnbuddy-ocr"
      });
    }
  } else if (["", "disabled", "local", "none"].includes(ocrProvider)) {
    warnCheck(checks, "ocr_provider", "OCR-/Vision-Provider ist deaktiviert; gescannte Materialien liefern nur Warnhinweise.", { provider: ocrProvider || "disabled" });
  } else {
    failCheck(checks, "ocr_provider", "critical", "Unbekannter OCRProvider.", { provider: ocrProvider });
  }

  const sttProvider = selectedSTTProvider();
  if (strict && ["", "local", "placeholder", "demo"].includes(sttProvider)) {
    failCheck(checks, "stt_provider", "critical", "Production benötigt einen externen STTProvider.", { provider: sttProvider });
  } else if (["mistral", "mistral-voxtral", "voxtral", "external"].includes(sttProvider)) {
    const endpointName = envValue("LEARNBUDDY_STT_BASE_URL")
      ? "LEARNBUDDY_STT_BASE_URL"
      : envValue("MISTRAL_STT_BASE_URL")
        ? "MISTRAL_STT_BASE_URL"
        : "";
    const endpointValue = endpointName ? envValue(endpointName) : "";
    const endpointError = deploymentEndpointError(endpointName, endpointValue, profile);
    if (endpointError) {
      failCheck(checks, "stt_provider", "critical", endpointError, { provider: "mistral-voxtral" });
    } else if (secretIsSet("MISTRAL_API_KEY")) {
      passCheck(checks, "stt_provider", "Mistral/Voxtral STT ist konfiguriert.", {
        provider: "mistral-voxtral",
        model: envValue("LEARNBUDDY_STT_MODEL") || envValue("MISTRAL_STT_MODEL") || "voxtral-mini-latest"
      });
    } else if (secretIsSet("LEARNBUDDY_STT_API_KEY")) {
      passCheck(checks, "stt_provider", "Mistral/Voxtral STT ist mit generischem STT-Key konfiguriert.", {
        provider: "mistral-voxtral",
        model: envValue("LEARNBUDDY_STT_MODEL") || envValue("MISTRAL_STT_MODEL") || "voxtral-mini-latest"
      });
    } else {
      failCheck(checks, "stt_provider", strict ? "critical" : "warning", "Mistral/Voxtral STT benötigt MISTRAL_API_KEY oder LEARNBUDDY_STT_API_KEY.");
    }
  } else if (["openai-compatible", "http", "self-hosted", "self-hosted-vllm", "vllm"].includes(sttProvider)) {
    const missing = [];
    if (!envValue("LEARNBUDDY_STT_BASE_URL")) missing.push("LEARNBUDDY_STT_BASE_URL");
    if (!secretIsSet("LEARNBUDDY_STT_API_KEY")) missing.push("LEARNBUDDY_STT_API_KEY");
    const endpointError = deploymentEndpointError("LEARNBUDDY_STT_BASE_URL", envValue("LEARNBUDDY_STT_BASE_URL"), profile);
    if (endpointError) {
      failCheck(checks, "stt_provider", "critical", endpointError, { provider: sttProvider });
    } else if (missing.length) {
      failCheck(checks, "stt_provider", strict ? "critical" : "warning", "OpenAI-kompatibler STTProvider ist unvollständig.", { provider: sttProvider, missing });
    } else {
      passCheck(checks, "stt_provider", "OpenAI-kompatibler STTProvider ist konfiguriert.", {
        provider: sttProvider,
        model: envValue("LEARNBUDDY_STT_MODEL") || "voxtral-mini-latest"
      });
    }
  } else if (["vllm-realtime", "self-hosted-vllm-realtime", "openai-realtime"].includes(sttProvider)) {
    const missing = [];
    const endpointName = envValue("LEARNBUDDY_STT_REALTIME_BASE_URL")
      ? "LEARNBUDDY_STT_REALTIME_BASE_URL"
      : "LEARNBUDDY_STT_BASE_URL";
    const endpointValue = envValue("LEARNBUDDY_STT_REALTIME_BASE_URL") || envValue("LEARNBUDDY_STT_BASE_URL");
    if (!endpointValue) missing.push("LEARNBUDDY_STT_BASE_URL");
    if (!secretIsSet("LEARNBUDDY_STT_API_KEY")) missing.push("LEARNBUDDY_STT_API_KEY");
    const endpointError = deploymentEndpointError(endpointName, endpointValue, profile, ["http:", "https:", "ws:", "wss:"]);
    if (endpointError) {
      failCheck(checks, "stt_provider", "critical", endpointError, { provider: sttProvider });
    } else if (missing.length > 0) {
      failCheck(checks, "stt_provider", strict ? "critical" : "warning", "Realtime-STTProvider ist unvollständig.", { provider: sttProvider, missing });
    } else {
      passCheck(checks, "stt_provider", "Realtime-STTProvider ist konfiguriert.", {
        provider: "self-hosted-vllm-realtime",
        model: envValue("LEARNBUDDY_STT_MODEL") || "mistralai/Voxtral-Mini-4B-Realtime-2602",
        transport: "websocket"
      });
    }
  } else if (["local"].includes(sttProvider)) {
    warnCheck(checks, "stt_provider", "Aktueller STT-Adapter ist nur ein lokaler Platzhalter.", { provider: sttProvider });
  } else {
    failCheck(checks, "stt_provider", "critical", "Unbekannter STTProvider.", { provider: sttProvider });
  }

  const criticalFailures = checks.filter((check) => check.status === "fail" && check.severity === "critical");
  const warnings = checks.filter((check) => check.status === "warn" || (check.status === "fail" && check.severity === "warning"));
  const payload = {
    ok: criticalFailures.length === 0,
    command: "preflight",
    profile,
    checks,
    blockers: preflightBlockers(checks),
    summary: {
      passed: checks.filter((check) => check.status === "pass").length,
      warnings: warnings.length,
      criticalFailures: criticalFailures.length
    }
  };

  console.log(JSON.stringify(payload, null, 2));
  if (criticalFailures.length > 0) {
    process.exitCode = 1;
  }
}

async function findOrCreateUser(sql, email) {
  const cleanEmail = email.trim().toLowerCase();
  const [user] = await sql`
    insert into users (email, role, ai_daily_limit, ai_daily_token_limit)
    values (${cleanEmail}, 'lecturer', ${DEFAULT_AI_DAILY_LIMIT}, ${DEFAULT_AI_DAILY_TOKEN_LIMIT})
    on conflict (email) do update set email = excluded.email
    returning id, email, ai_daily_limit, ai_daily_token_limit
  `;
  return user;
}

async function seedDemo(sql) {
  const ownerEmail = argValue("--owner", DEFAULT_OWNER);
  const owner = await findOrCreateUser(sql, ownerEmail);

  const [existingSeries] = await sql`
    select id
    from lecture_series
    where title = ${demoLecture.seriesTitle}
    order by created_at asc
    limit 1
  `;
  const [targetSeries] = existingSeries
    ? await sql`
        update lecture_series
        set owner_id = coalesce(owner_id, ${owner.id}),
            ai_daily_limit = ${DEFAULT_AI_DAILY_LIMIT},
            ai_daily_token_limit = ${DEFAULT_AI_DAILY_TOKEN_LIMIT},
            evaluation_config = cast(${JSON.stringify(demoLecture.evaluationConfig)} as jsonb)
        where id = ${existingSeries.id}
        returning id
      `
    : await sql`
        insert into lecture_series (title, language, owner_id, ai_daily_limit, ai_daily_token_limit, evaluation_config)
        values (
          ${demoLecture.seriesTitle},
          ${demoLecture.language},
          ${owner.id},
          ${DEFAULT_AI_DAILY_LIMIT},
          ${DEFAULT_AI_DAILY_TOKEN_LIMIT},
          cast(${JSON.stringify(demoLecture.evaluationConfig)} as jsonb)
        )
        returning id
      `;

  const [lecture] = await sql`
    insert into lectures (
      series_id,
      public_token,
      title,
      status,
      live_at,
      exam_date,
      ai_access_until,
      ai_daily_limit,
      ai_daily_token_limit,
      leaderboard_enabled,
      learn_question_density,
      evaluation_config
    )
    values (
      ${targetSeries.id},
      ${demoLecture.publicToken},
      ${demoLecture.title},
      ${demoLecture.status},
      ${demoLecture.liveAt},
      ${demoLecture.examDate},
      ${demoLecture.aiAccessUntil},
      ${DEFAULT_AI_DAILY_LIMIT},
      ${DEFAULT_AI_DAILY_TOKEN_LIMIT},
      ${demoLecture.leaderboardEnabled},
      ${demoLecture.learnQuestionDensity},
      cast(${JSON.stringify(demoLecture.evaluationConfig)} as jsonb)
    )
    on conflict (public_token) do update set
      series_id = excluded.series_id,
      title = excluded.title,
      status = excluded.status,
      live_at = excluded.live_at,
      exam_date = excluded.exam_date,
      ai_access_until = excluded.ai_access_until,
      ai_daily_limit = excluded.ai_daily_limit,
      ai_daily_token_limit = excluded.ai_daily_token_limit,
      leaderboard_enabled = excluded.leaderboard_enabled,
      learn_question_density = excluded.learn_question_density,
      evaluation_config = excluded.evaluation_config
    returning id, public_token
  `;

  const [joinCode] = await sql`
    insert into join_codes (
      code,
      normalized_code,
      scope,
      series_id,
      created_by_user_id,
      enabled
    )
    values (
      ${demoLecture.joinCode},
      ${demoLecture.joinCode},
      'series',
      ${targetSeries.id},
      ${owner.id},
      true
    )
    on conflict (normalized_code) where enabled = true do update set
      code = excluded.code,
      scope = excluded.scope,
      series_id = excluded.series_id,
      lecture_id = null,
      created_by_user_id = excluded.created_by_user_id,
      enabled = true,
      updated_at = now()
    returning id, code
  `;

  await sql`
    update lecture_series
    set default_join_code_id = ${joinCode.id}
    where id = ${targetSeries.id}
  `;

  const existingQuestions = await sql`select id from questions where lecture_id = ${lecture.id}`;
  if (existingQuestions.length > 0) {
    await sql`delete from question_variants where question_id in ${sql(existingQuestions.map((question) => question.id))}`;
    await sql`delete from questions where lecture_id = ${lecture.id}`;
  }
  await sql`delete from slides where lecture_id = ${lecture.id}`;

  for (const [index, slide] of demoLecture.slides.entries()) {
    await sql`
      insert into slides (lecture_id, position, title, content_json)
      values (
        ${lecture.id},
        ${index + 1},
        ${slide.title},
        cast(${JSON.stringify({
          eyebrow: slide.eyebrow,
          topic: slide.topic,
          copy: slide.copy,
          diagram: slide.diagram
        })} as jsonb)
      )
    `;
  }

  const [question] = await sql`
    insert into questions (lecture_id, source)
    values (${lecture.id}, 'admin_seed')
    returning id
  `;
  for (const variant of demoLecture.questions) {
    const correctAnswer = variant.answers.find((answer) => answer.correct)?.key ?? "A";
    await sql`
      insert into question_variants (
        question_id,
        level,
        points,
        text,
        answers_json,
        correct_answer_key,
        explanation,
        prompt_version
      )
      values (
        ${question.id},
        ${variant.level},
        ${variant.points},
        ${variant.text},
        cast(${JSON.stringify(variant.answers)} as jsonb),
        ${correctAnswer},
        ${variant.explanation},
        'admin-seed-v1'
      )
    `;
  }

  console.log(JSON.stringify({
    ok: true,
    command: "seed-demo",
    ownerEmail: owner.email,
    lectureToken: lecture.public_token,
    joinCode: joinCode.code,
    slides: demoLecture.slides.length,
    questionVariants: demoLecture.questions.length
  }, null, 2));
}

async function setAiBudget(sql) {
  const email = argValue("--email", "");
  if (!email) throw new Error("--email is required.");
  const questions = numericArg("--questions", DEFAULT_AI_DAILY_LIMIT, 1, 200);
  const tokens = numericArg("--tokens", DEFAULT_AI_DAILY_TOKEN_LIMIT, 100, 200000);
  const user = await findOrCreateUser(sql, email);
  const [updated] = await sql`
    update users
    set ai_daily_limit = ${questions},
        ai_daily_token_limit = ${tokens}
    where id = ${user.id}
    returning email, ai_daily_limit, ai_daily_token_limit
  `;
  console.log(JSON.stringify({ ok: true, command: "set-ai-budget", user: updated }, null, 2));
}

async function status(sql) {
  const [counts] = await sql`
    select
      (select count(*)::int from users) as users,
      (select count(*)::int from lecture_series) as series,
      (select count(*)::int from lectures) as lectures,
      (select count(*)::int from slides) as slides,
      (select count(*)::int from question_variants) as question_variants
  `;
  const lectures = await sql`
    select l.public_token, l.title, s.title as series_title, u.email as owner_email
    from lectures l
    left join lecture_series s on s.id = l.series_id
    left join users u on u.id = s.owner_id
    order by l.created_at desc
    limit 10
  `;
  console.log(JSON.stringify({ ok: true, command: "status", counts, lectures }, null, 2));
}

async function retentionReport(sql) {
  const years = numericArg("--years", 5, 1, 50);
  const lectureToken = argValue("--lecture-token", "").trim();
  const asOf = new Date();
  const cutoff = new Date(asOf);
  cutoff.setFullYear(cutoff.getFullYear() - years);

  let lecture = null;
  if (lectureToken) {
    [lecture] = await sql`
      select id, public_token, title
      from lectures
      where public_token = ${lectureToken}
      limit 1
    `;
    if (!lecture) throw new Error(`Lecture token not found: ${lectureToken}`);
  }

  const lectureFilter = lecture ? sql`and lecture_id = ${lecture.id}` : sql``;
  const cleanupCounts = await retentionCleanupCounts(sql, cutoff, lectureFilter);
  const contentCounts = await retentionContentCounts(sql, cutoff, lectureFilter);
  const counts = { ...cleanupCounts, ...contentCounts };
  const staleTotal = Object.values(counts).reduce((sum, value) => sum + Number(value ?? 0), 0);
  const cleanupTotal = Object.values(cleanupCounts).reduce((sum, value) => sum + Number(value ?? 0), 0);
  const contentTotal = Object.values(contentCounts).reduce((sum, value) => sum + Number(value ?? 0), 0);

  console.log(JSON.stringify({
    ok: true,
    command: "retention-report",
    policy: resolvedRetentionPolicy(years, cutoff.toISOString(), asOf.toISOString()),
    scope: lecture ? {
      lectureToken: lecture.public_token,
      lectureTitle: lecture.title
    } : {
      lectureToken: null,
      lectureTitle: "all"
    },
    staleTotal,
    cleanupTotal,
    contentTotal,
    counts,
    recommendation: staleTotal === 0
      ? "No records outside the retention window."
      : "Run retention-cleanup for pseudonymous learning signals; course content and standalone artifacts are reported but not changed automatically."
  }, null, 2));
}

async function retentionCleanup(sql) {
  const years = numericArg("--years", 5, 1, 50);
  const lectureToken = argValue("--lecture-token", "").trim();
  const apply = process.argv.includes("--apply");
  const confirmed = process.argv.includes("--confirm-retention-cleanup");
  const asOf = new Date();
  const cutoff = new Date(asOf);
  cutoff.setFullYear(cutoff.getFullYear() - years);
  const retainedAt = new Date().toISOString();

  if (apply && !confirmed) {
    throw new Error("retention-cleanup --apply requires --confirm-retention-cleanup.");
  }

  let lecture = null;
  if (lectureToken) {
    [lecture] = await sql`
      select id, public_token, title
      from lectures
      where public_token = ${lectureToken}
      limit 1
    `;
    if (!lecture) throw new Error(`Lecture token not found: ${lectureToken}`);
  }

  const lectureFilter = lecture ? sql`and lecture_id = ${lecture.id}` : sql``;
  const contentSkipped = await retentionContentCounts(sql, cutoff, lectureFilter);
  const targetCounts = await retentionCleanupCounts(sql, cutoff, lectureFilter);

  const result = apply
    ? await sql.begin(async (tx) => {
      const participantResult = await tx`
        update participant_sessions
        set
          pseudonym = 'Anonymisiert',
          anonymous_key = 'retained:' || id::text
        where last_seen_at < ${cutoff}
          ${lectureFilter}
          and anonymous_key not like 'retained:%'
        returning id
      `;
      const analyticsResult = await tx`
        update analytics_events
        set
          participant_session_id = null,
          event_payload = jsonb_build_object(
            'retained', true,
            'eventType', event_type,
            'retainedAt', ${retainedAt}::text
          )
        where occurred_at < ${cutoff}
          ${lectureFilter}
          and coalesce(event_payload->>'retained', 'false') <> 'true'
        returning id
      `;
      const answersResult = await tx`
        update answers
        set participant_session_id = null
        where created_at < ${cutoff}
          ${lectureFilter}
          and participant_session_id is not null
        returning id
      `;
      const chatResult = await tx`
        update student_chat_questions
        set
          participant_session_id = null,
          pseudonym = 'Anonymisiert',
          anonymous_key = null,
          question_text = '[nach Aufbewahrungsfrist anonymisiert]',
          relevance_reason = 'Nach Aufbewahrungsfrist redigiert.',
          source_topic = null,
          moderation_signals = '[]'::jsonb
        where created_at < ${cutoff}
          ${lectureFilter}
          and question_text <> '[nach Aufbewahrungsfrist anonymisiert]'
        returning id
      `;
      const transcriptResult = await tx`
        update transcript_segments
        set
          text = '[nach Aufbewahrungsfrist redigiert]',
          relevance_reason = 'Nach Aufbewahrungsfrist redigiert.',
          source_topic = null
        where created_at < ${cutoff}
          ${lectureFilter}
          and text <> '[nach Aufbewahrungsfrist redigiert]'
        returning id
      `;

      return {
        participant_sessions: participantResult.count,
        analytics_events: analyticsResult.count,
        answers: answersResult.count,
        student_chat_questions: chatResult.count,
        transcript_segments: transcriptResult.count
      };
    })
    : targetCounts;

  const touchedTotal = Object.values(result).reduce((sum, value) => sum + Number(value ?? 0), 0);
  const skippedTotal = Object.values(contentSkipped).reduce((sum, value) => sum + Number(value ?? 0), 0);

  console.log(JSON.stringify({
    ok: true,
    command: "retention-cleanup",
    applied: apply,
    strategy: "anonymize-pseudonymous-learning-signals",
    policy: {
      ...resolvedRetentionPolicy(years, cutoff.toISOString(), asOf.toISOString()),
      retainedAt
    },
    scope: lecture ? {
      lectureToken: lecture.public_token,
      lectureTitle: lecture.title
    } : {
      lectureToken: null,
      lectureTitle: "all"
    },
    touchedTotal,
    affected: result,
    skippedContentTotal: skippedTotal,
    skippedContent: contentSkipped,
    recommendation: skippedTotal === 0
      ? "Pseudonyme Altbestände sind bereinigt; keine Kursinhalte außerhalb der Frist gefunden."
      : "Pseudonyme Altbestände sind bereinigbar. Kursinhalte und Standalone-Artefakte werden gemäß Content-Policy nur berichtet und nicht automatisch verändert."
  }, null, 2));
}

async function retentionCleanupCounts(sql, cutoff, lectureFilter) {
  const [counts] = await sql`
    select
      (select count(*)::int from participant_sessions where last_seen_at < ${cutoff} ${lectureFilter} and anonymous_key not like 'retained:%') as participant_sessions,
      (select count(*)::int from analytics_events where occurred_at < ${cutoff} ${lectureFilter} and coalesce(event_payload->>'retained', 'false') <> 'true') as analytics_events,
      (select count(*)::int from answers where created_at < ${cutoff} ${lectureFilter} and participant_session_id is not null) as answers,
      (select count(*)::int from student_chat_questions where created_at < ${cutoff} ${lectureFilter} and question_text <> '[nach Aufbewahrungsfrist anonymisiert]') as student_chat_questions,
      (select count(*)::int from transcript_segments where created_at < ${cutoff} ${lectureFilter} and text <> '[nach Aufbewahrungsfrist redigiert]') as transcript_segments
  `;
  return counts;
}

async function retentionContentCounts(sql, cutoff, lectureFilter) {
  const [counts] = await sql`
    select
      (select count(*)::int from lecture_assets where created_at < ${cutoff} ${lectureFilter}) as lecture_assets,
      (select count(*)::int from material_processing_runs where started_at < ${cutoff} ${lectureFilter}) as material_processing_runs,
      (select count(*)::int from question_review_items where created_at < ${cutoff} ${lectureFilter}) as question_review_items,
      (select count(*)::int from questions where created_at < ${cutoff} ${lectureFilter}) as questions,
      (select count(*)::int from standalone_exports where created_at < ${cutoff} ${lectureFilter}) as standalone_exports,
      (select count(*)::int from standalone_export_jobs where created_at < ${cutoff} ${lectureFilter}) as standalone_export_jobs
  `;
  return counts;
}

async function backupSql() {
  const outputPath = path.resolve(requiredArg("--out"));
  await mkdir(path.dirname(outputPath), { recursive: true });
  const pgDump = commandBinary("PG_DUMP_BIN", "pg_dump");
  const databaseUrl = requiredDatabaseUrl();

  const result = await runCommand(pgDump, [
    "--no-owner",
    "--no-privileges",
    "--format=plain",
    "--file",
    outputPath,
    databaseUrl
  ]);
  const info = await stat(outputPath);

  console.log(JSON.stringify({
    ok: true,
    command: "backup-sql",
    file: outputPath,
    bytes: info.size,
    sha256: await fileSha256(outputPath),
    tool: pgDump,
    warnings: result.stderr.trim() || null
  }, null, 2));
}

async function restoreSql(sql) {
  const inputPath = path.resolve(requiredArg("--file"));
  const allowNonempty = process.argv.includes("--allow-nonempty");
  const [{ count }] = await sql`
    select count(*)::int as count
    from information_schema.tables
    where table_schema in ('public', 'drizzle')
      and table_type = 'BASE TABLE'
  `;
  if (Number(count) > 0 && !allowNonempty) {
    throw new Error("Target database is not empty. Use a fresh database or pass --allow-nonempty intentionally.");
  }

  const psql = commandBinary("PSQL_BIN", "psql");
  const result = await runCommand(psql, [
    "--set",
    "ON_ERROR_STOP=1",
    "--file",
    inputPath,
    requiredDatabaseUrl()
  ]);
  const info = await stat(inputPath);

  console.log(JSON.stringify({
    ok: true,
    command: "restore-sql",
    file: inputPath,
    bytes: info.size,
    sha256: await fileSha256(inputPath),
    tool: psql,
    warnings: result.stderr.trim() || null
  }, null, 2));
}

async function workerOnce() {
  const baseUrl = argValue("--url", process.env.LEARNBUDDY_WORKER_APP_URL || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/+$/, "");
  const secret = argValue("--secret", process.env.LEARNBUDDY_WORKER_SECRET || "");
  const limit = numericArg("--limit", 1, 1, 25);
  if (!baseUrl) throw new Error("--url or LEARNBUDDY_WORKER_APP_URL is required.");
  if (!secret) throw new Error("--secret or LEARNBUDDY_WORKER_SECRET is required.");

  const response = await fetch(`${baseUrl}/api/jobs/worker?limit=${limit}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`
    }
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`Worker request failed with ${response.status}: ${text}`);
  }
  console.log(JSON.stringify({
    ok: true,
    command: "worker-once",
    url: baseUrl,
    limit,
    result: payload
  }, null, 2));
}

async function main() {
  const command = process.argv[2];
  if (!command || command === "--help" || command === "-h") {
    printUsage();
    return;
  }

  const sql = postgres(requiredDatabaseUrl(), { max: 1, prepare: false });
  try {
    if (command === "seed-demo") await seedDemo(sql);
    else if (command === "set-ai-budget") await setAiBudget(sql);
    else if (command === "retention-report") await retentionReport(sql);
    else if (command === "retention-cleanup") await retentionCleanup(sql);
    else if (command === "backup-sql") await backupSql();
    else if (command === "restore-sql") await restoreSql(sql);
    else if (command === "worker-once") await workerOnce();
    else if (command === "preflight") await runPreflight(sql);
    else if (command === "status") await status(sql);
    else {
      printUsage();
      process.exitCode = 1;
    }
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
