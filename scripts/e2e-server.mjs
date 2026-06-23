#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const DEFAULT_DATABASE_URL = "postgres://michaelwelsch@127.0.0.1:55432/learnbuddy_e2e_smoke";
const databaseUrl = process.env.E2E_DATABASE_URL || DEFAULT_DATABASE_URL;
const host = process.env.E2E_HOST || "127.0.0.1";
const port = process.env.E2E_PORT || "3070";
const aiMockPort = process.env.E2E_AI_MOCK_PORT || "4070";
const appUrl = process.env.E2E_BASE_URL || `http://${host}:${port}`;
const ownerEmail = process.env.E2E_OWNER_EMAIL || "e2e@example.test";
const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
let aiMockServer;

const HELP_TEXT = `
Usage: node scripts/e2e-server.mjs

Starts the isolated LearnBuddy E2E server: resets the E2E database, migrates, seeds demo data, starts the AI mock and launches "npm start".

Environment:
  E2E_DATABASE_URL                  E2E Postgres URL. Defaults to learnbuddy_e2e_smoke.
  E2E_HOST                          Host for app and mock servers. Defaults to 127.0.0.1.
  E2E_PORT                          App port. Defaults to 3070.
  E2E_BASE_URL                      Public app URL passed to Next.js.
  E2E_AI_MOCK_PORT                  AI/OCR mock port. Defaults to 4070.
  E2E_OWNER_EMAIL                   Seeded lecturer owner email.

Options:
  --help, -h                        Print this usage text without starting servers or touching the database.
`;

function helpRequested() {
  return process.argv.slice(2).some((item) => item === "-h" || item === "--help" || item.startsWith("--help="));
}

if (helpRequested()) {
  console.log(HELP_TEXT.trim());
  process.exit(0);
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function targetDatabaseName(url) {
  const parsed = new URL(url);
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!name) throw new Error("E2E_DATABASE_URL must include a database name.");
  if (!name.includes("e2e") && process.env.LEARNBUDDY_E2E_ALLOW_RESET !== "1") {
    throw new Error(`Refusing to reset database "${name}". Use an e2e database name or set LEARNBUDDY_E2E_ALLOW_RESET=1.`);
  }
  return name;
}

function maintenanceDatabaseUrl(url) {
  const parsed = new URL(url);
  parsed.pathname = "/postgres";
  return parsed.toString();
}

function e2eEnv(extra = {}) {
  return {
    ...process.env,
    DATABASE_URL: databaseUrl,
    NEXT_PUBLIC_APP_URL: appUrl,
    AUTH_SECRET: "learnbuddy-e2e-secret-with-more-than-32-characters",
    LEARNBUDDY_DEPLOYMENT_ENV: "local",
    LEARNBUDDY_REPOSITORY: "postgres",
    LEARNBUDDY_AUTO_SEED: "0",
    LEARNBUDDY_MAIL_PROVIDER: "console",
    LEARNBUDDY_AI_PROVIDER: "openai-compatible",
    LEARNBUDDY_AI_BASE_URL: `http://${host}:${aiMockPort}`,
    LEARNBUDDY_AI_API_KEY: "e2e-ai-token",
    LEARNBUDDY_AI_MODEL: "mock-e2e-chat",
    LEARNBUDDY_LECTURER_ASSISTANT_PROVIDER: "ai",
    LEARNBUDDY_QUESTION_GENERATOR: "ai",
    LEARNBUDDY_CHAT_MODERATION_PROVIDER: "ai",
    LEARNBUDDY_CHAT_QUESTION_LIMIT_PER_WINDOW: "3",
    LEARNBUDDY_MAX_UPLOAD_BYTES: "1048576",
    LEARNBUDDY_EMBEDDING_PROVIDER: "learnbuddy-local-hash-v1",
    LEARNBUDDY_OCR_PROVIDER: "http",
    LEARNBUDDY_OCR_BASE_URL: `http://${host}:${aiMockPort}`,
    LEARNBUDDY_OCR_API_KEY: "e2e-ocr-token",
    LEARNBUDDY_OCR_MODEL: "mock-e2e-ocr",
    LEARNBUDDY_STT_PROVIDER: "local",
    LEARNBUDDY_JOB_PROVIDER: "inline",
    LEARNBUDDY_WORKER_SECRET: "e2e-worker-secret",
    CRON_SECRET: "e2e-cron-secret",
    LEARNBUDDY_STORAGE_PROVIDER: "local",
    LEARNBUDDY_STORAGE_DIR: path.join(rootDir, "output", "e2e-storage"),
    ...extra
  };
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      env: e2eEnv(options.env),
      stdio: options.stdio ?? "inherit"
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("error", reject);
    request.on("end", () => resolve(body));
  });
}

function mockModerationAnswer(input) {
  const lower = input.toLowerCase();
  const accepted = /viskos|stribeck|mischreibung|gleitlager|schmier|welle|sommerfeld/.test(lower);
  return JSON.stringify({
    status: accepted ? "accepted" : "ignored",
    reason: accepted
      ? "Fachlicher Bezug zur Gleitlagerung erkannt."
      : "Kein zielfuehrender Bezug zur aktuellen Vorlesung erkannt.",
    sourceTopic: accepted ? "Gleitlagerung" : "",
    confidence: accepted ? 94 : 88,
    signals: accepted ? ["Stribeck", "Viskosität", "Gleitlagerung"] : ["Off-Topic"]
  });
}

function mockQuestionGeneratorAnswer() {
  return JSON.stringify({
    variants: [
      {
        level: "4.0",
        text: "Welche Komponente trägt im hydrodynamischen Gleitlager die Last?",
        answers: [
          { text: "Der durch Relativbewegung aufgebaute Schmierfilm.", correct: true },
          { text: "Der dauerhafte Festkörperkontakt.", correct: false },
          { text: "Die Passfeder der Welle.", correct: false },
          { text: "Die trockene Lagerstelle ohne Schmierstoff.", correct: false }
        ],
        explanation: "Auf 4.0-Niveau wird der zentrale Begriff Schmierfilm korrekt zugeordnet."
      },
      {
        level: "3.0",
        text: "Welche bekannte Bedingung aus der Vorlesung begünstigt den Schmierfilmaufbau?",
        answers: [
          { text: "Relativbewegung mit keilförmigem Spalt.", correct: true },
          { text: "Stillstand bei maximaler Last.", correct: false },
          { text: "Schmierstoffentfernung vor dem Anlauf.", correct: false },
          { text: "Beliebige Verringerung des Lagerspiels.", correct: false }
        ],
        explanation: "Die bekannte Anwendung verbindet Bewegung und Keilspalt mit Druckaufbau."
      },
      {
        level: "2.0",
        text: "Warum ist Mischreibung beim Anlauf eines Gleitlagers kritisch?",
        answers: [
          { text: "Weil Schmierfilm und Festkörperkontakt gleichzeitig auftreten können.", correct: true },
          { text: "Weil der Schmierfilm bereits in jeder Betriebsphase voll trägt.", correct: false },
          { text: "Weil die Reibung unabhängig von Viskosität und Drehzahl ist.", correct: false },
          { text: "Weil Festkörperkontakt den Verschleiß sicher verhindert.", correct: false }
        ],
        explanation: "Auf 2.0-Niveau wird Ursache und Wirkung der Übergangsphase erklärt."
      },
      {
        level: "1.0",
        text: "Eine schwere Welle startet häufig langsam. Welche Maßnahme überträgt das Gleitlagerprinzip am besten?",
        answers: [
          { text: "Die Startphase entlasten oder eine zusätzliche Schmierfilmversorgung vorsehen.", correct: true },
          { text: "Nur die spätere Enddrehzahl erhöhen.", correct: false },
          { text: "Den Schmierstoff entfernen, damit keine Mischreibung entsteht.", correct: false },
          { text: "Das Lagerspiel ohne Auslegung beliebig verkleinern.", correct: false }
        ],
        explanation: "Auf 1.0-Niveau wird das Prinzip auf einen neuen technischen Startfall übertragen."
      }
    ]
  });
}

function mockChatAnswer(input) {
  if (input.includes("Schwierigkeitsstufen:") && input.includes("JSON-Schema:")) {
    return mockQuestionGeneratorAnswer();
  }

  if (input.includes("LEARNBUDDY_LECTURER_ASSISTANT_TOOL_PLAN_V1")) {
    const referentenfrage = input.match(/Referentenfrage:\s*(.*)/)?.[1] ?? "";
    const lower = referentenfrage.toLowerCase();
    if (/fragedichte|dichte|hotspot|learn|lernmodus|nacharbeit|uebung|übung/.test(lower)) {
      return JSON.stringify({
        strategy: "Learn-Fragedichte für die Nacharbeit einstellen",
        toolPlan: [
          {
            action: "learn_density",
            label: "Learn-Fragedichte setzen",
            reason: "Mehr Übungsanker helfen bei der Nacharbeit im Learn-Modus.",
            order: 1,
            status: "suggested"
          },
          {
            action: "review_draft",
            label: "Fragenentwurf anlegen",
            reason: "Die erhöhte Dichte braucht passende Fragevarianten.",
            order: 2,
            status: "suggested"
          }
        ]
      });
    }
    if (/evaluation|feedback|rueckmeldung|rückmeldung|verständnis|verstaendnis|tempo/.test(lower)) {
      return JSON.stringify({
        strategy: "Evaluation folienbezogen schärfen",
        toolPlan: [
          {
            action: "evaluation_focus",
            label: "Evaluation schärfen",
            reason: "Die Rückmeldung soll auf die sichtbare Folie zielen.",
            order: 1,
            status: "suggested"
          },
          {
            action: "review_draft",
            label: "Fragenentwurf anlegen",
            reason: "Aus der Evaluation entsteht danach eine Nacharbeitsfrage.",
            order: 2,
            status: "suggested"
          }
        ]
      });
    }
    return JSON.stringify({
      strategy: "Lernziel schärfen und Review-Draft erzeugen",
      toolPlan: [
        {
          action: "slide_point",
          label: "Folienpunkt übernehmen",
          reason: "Die Kernaussage soll direkt auf der sichtbaren Folie landen.",
          order: 1,
          status: "suggested"
        },
        {
          action: "review_draft",
          label: "Fragenentwurf anlegen",
          reason: "Aus dem Folienpunkt entsteht danach eine 4-Niveau-Fragefamilie.",
          order: 2,
          status: "suggested",
          prerequisite: "Folienpunkt übernehmen"
        }
      ]
    });
  }
  return input.toLowerCase().includes("stribeck")
    ? "Mock-Erklärung: Die Stribeck-Kurve zeigt den Übergang von Grenz- über Misch- zu Flüssigkeitsreibung."
    : "Mock-Erklärung: Die Antwort bleibt im Kontext der aktuellen Vorlesung.";
}

function streamMockChatCompletion(response, content) {
  const chunks = content.match(/.{1,24}(?:\s|$)/g)?.map((chunk) => chunk.trim()).filter(Boolean) ?? [content];
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store"
  });
  for (const chunk of chunks) {
    response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `${chunk} ` } }] })}\n\n`);
  }
  response.write(`data: ${JSON.stringify({
    choices: [],
    usage: {
      prompt_tokens: 21,
      completion_tokens: 13,
      total_tokens: 34
    }
  })}\n\n`);
  response.write("data: [DONE]\n\n");
  response.end();
}

function mockOCRAnswer(payload) {
  const images = Array.isArray(payload.images) ? payload.images : [];
  const decoded = images
    .map((image) => {
      if (typeof image?.contentBase64 !== "string") return "";
      try {
        return Buffer.from(image.contentBase64, "base64").toString("utf8");
      } catch {
        return "";
      }
    })
    .join("\n");
  const markerMatch = decoded.match(/OCR_TEXT:\s*([\s\S]+)/);
  return markerMatch?.[1]?.trim() || "";
}

function startAIProviderMock() {
  if (process.env.E2E_AI_MOCK === "0") return Promise.resolve();
  aiMockServer = createServer(async (request, response) => {
    if (request.method === "POST" && request.url?.endsWith("/v1/ocr")) {
      const body = await readRequestBody(request);
      const payload = JSON.parse(body || "{}");
      const text = mockOCRAnswer(payload);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        text,
        confidence: text ? 0.94 : 0,
        model: "mock-e2e-ocr",
        regions: text
          ? [
            {
              page: 1,
              label: "Hauptdiagramm",
              text: "Stribeck-Layoutanker",
              bbox: { x: 120, y: 180, width: 360, height: 210 },
              confidence: 0.92
            }
          ]
          : []
      }));
      return;
    }

    if (request.method !== "POST" || !request.url?.endsWith("/v1/chat/completions")) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "Not found" } }));
      return;
    }

    const body = await readRequestBody(request);
    const payload = JSON.parse(body || "{}");
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const prompt = messages
      .map((message) => typeof message?.content === "string" ? message.content : "")
      .join("\n");
    const content = prompt.includes("LEARNBUDDY_CHAT_QUESTION_MODERATION_V1")
      ? mockModerationAnswer(prompt)
      : mockChatAnswer(prompt);

    if (payload.stream === true) {
      streamMockChatCompletion(response, content);
      return;
    }

    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      choices: [{ message: { content } }],
      usage: {
        prompt_tokens: 21,
        completion_tokens: 13,
        total_tokens: 34
      }
    }));
  });

  return new Promise((resolve, reject) => {
    aiMockServer?.once("error", reject);
    aiMockServer?.listen(Number(aiMockPort), host, () => resolve());
  });
}

async function resetDatabase() {
  const name = targetDatabaseName(databaseUrl);
  const admin = postgres(maintenanceDatabaseUrl(databaseUrl), { max: 1, prepare: false });
  try {
    await admin`
      select pg_terminate_backend(pid)
      from pg_stat_activity
      where datname = ${name}
        and pid <> pg_backend_pid()
    `;
    await admin.unsafe(`drop database if exists ${quoteIdentifier(name)}`);
    await admin.unsafe(`create database ${quoteIdentifier(name)}`);
  } finally {
    await admin.end();
  }
}

async function prepare() {
  await mkdir(path.join(rootDir, "output", "e2e-storage"), { recursive: true });
  await resetDatabase();
  await run("npm", ["run", "db:migrate"]);
  await run("npm", ["run", "admin", "--", "seed-demo", "--owner", ownerEmail]);
}

async function startServer() {
  await startAIProviderMock();
  await prepare();
  const child = spawn("npm", ["run", "start", "--", "-H", host, "-p", port], {
    cwd: rootDir,
    env: e2eEnv(),
    stdio: "inherit"
  });

  const stop = () => {
    if (!child.killed) child.kill("SIGTERM");
    aiMockServer?.close();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  child.on("exit", (code, signal) => {
    aiMockServer?.close();
    if (signal) process.exit(0);
    process.exit(code ?? 1);
  });
  child.on("error", (error) => {
    console.error(error);
    process.exit(1);
  });
}

startServer().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
