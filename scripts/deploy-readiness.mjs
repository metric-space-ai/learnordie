#!/usr/bin/env node

import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

const DEFAULT_TIMEOUT_MS = 20_000;
const REQUIRED_ENV = [
  "NEXT_PUBLIC_APP_URL",
  "LEARNBUDDY_DEPLOYMENT_ENV",
  "AUTH_SECRET",
  "DATABASE_URL",
  "LEARNBUDDY_MAIL_PROVIDER",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "LEARNBUDDY_JOB_PROVIDER",
  "LEARNBUDDY_WORKER_SECRET",
  "CRON_SECRET",
  "LEARNBUDDY_AI_PROVIDER",
  "LEARNBUDDY_LECTURER_ASSISTANT_PROVIDER",
  "LEARNBUDDY_CHAT_MODERATION_PROVIDER",
  "LEARNBUDDY_QUESTION_GENERATOR",
  "LEARNBUDDY_EMBEDDING_PROVIDER",
  "LEARNBUDDY_EMBEDDING_BASE_URL",
  "LEARNBUDDY_EMBEDDING_API_KEY",
  "LEARNBUDDY_OCR_PROVIDER",
  "LEARNBUDDY_OCR_BASE_URL",
  "LEARNBUDDY_OCR_API_KEY",
  "LEARNBUDDY_STT_PROVIDER",
  "LEARNBUDDY_STORAGE_PROVIDER"
];
const PREVIEW_RUNTIME_ENV = [
  "NEXT_PUBLIC_APP_URL"
];
const ALTERNATIVE_ENV_GROUPS = [
  {
    id: "llm_proxy_key",
    description: "Learnordie Responses proxy key",
    anyOf: ["LEARNORDIE_LLM_PROXY_API_KEY", "LEARNBUDDY_LLM_PROXY_API_KEY", "CTOX_LLM_PROXY_API_KEY"]
  },
  {
    id: "minimax_upstream_key",
    description: "MiniMax M3 upstream key for llm.learnordie.app",
    anyOf: ["LEARNORDIE_MINIMAX_API_KEY", "MINIMAX_API_KEY"]
  },
  {
    id: "stt_provider_key",
    description: "Mistral or self-hosted STT provider key",
    anyOf: ["MISTRAL_API_KEY", "LEARNBUDDY_STT_API_KEY"]
  },
  {
    id: "storage_backend",
    description: "Remote storage backend configuration",
    anyOf: ["BLOB_READ_WRITE_TOKEN", "LEARNBUDDY_STORAGE_TOKEN", "LEARNBUDDY_STORAGE_ENDPOINT"]
  }
];
const FORBIDDEN_DEPLOY_ENV = [
  {
    name: "LEARNBUDDY_ALLOW_LOCAL_URL_FETCH",
    reason: "Local/private URL material fetching is only allowed for local demos."
  }
];

const HELP_TEXT = `
Usage: npm run deploy:readiness -- [options]

Checks whether a Vercel, local or self-host target has the required LearnBuddy deployment configuration.

Options:
  --environment preview|production|development
                                    Target environment. Defaults to preview.
  --pull-vercel-env                 Pull target values with "vercel env pull".
  --scope <vercel-scope>            Optional Vercel scope for env pull/list commands.
  --local                           Read names and values from process.env.
  --self-host                       Check the portable self-host contract and process.env.
  --timeout-ms <ms>                 Per-command timeout. Defaults to 20000.

Examples:
  npm run deploy:readiness -- --environment preview --pull-vercel-env --scope metric-spaces-projects
  npm run deploy:readiness -- --environment production --self-host
`;
const REQUIRED_ENV_GUIDANCE = {
  NEXT_PUBLIC_APP_URL: {
    provider: "runtime",
    purpose: "Canonical public app URL. Required for production; Vercel preview can use VERCEL_URL at runtime."
  },
  LEARNBUDDY_DEPLOYMENT_ENV: {
    provider: "runtime",
    purpose: "Runtime hardening profile: preview or production."
  },
  AUTH_SECRET: {
    provider: "auth",
    purpose: "Long random secret for signed lecturer sessions and CSRF material."
  },
  DATABASE_URL: {
    provider: "postgres",
    purpose: "Postgres/Neon connection string with pgvector-enabled schema."
  },
  LEARNBUDDY_MAIL_PROVIDER: {
    provider: "mail",
    purpose: "Set to resend for preview/production magic links."
  },
  RESEND_API_KEY: {
    provider: "mail",
    purpose: "Resend API key for lecturer magic-link delivery."
  },
  EMAIL_FROM: {
    provider: "mail",
    purpose: "Verified sender, for example LearnBuddy <noreply@your-university.edu>."
  },
  LEARNBUDDY_JOB_PROVIDER: {
    provider: "jobs",
    purpose: "Use database for the portable worker/queue path."
  },
  LEARNBUDDY_WORKER_SECRET: {
    provider: "jobs",
    purpose: "Bearer secret for protected worker endpoints."
  },
  CRON_SECRET: {
    provider: "jobs",
    purpose: "Bearer secret for Vercel Cron worker trigger."
  },
  LEARNBUDDY_AI_PROVIDER: {
    provider: "ai",
    purpose: "Use learnordie-responses for the llm.learnordie.app Responses proxy path."
  },
  LEARNBUDDY_LECTURER_ASSISTANT_PROVIDER: {
    provider: "ai",
    purpose: "Set to ai for provider-backed lecturer assistant."
  },
  LEARNBUDDY_CHAT_MODERATION_PROVIDER: {
    provider: "ai",
    purpose: "Set to ai for provider-backed student-question moderation."
  },
  LEARNBUDDY_QUESTION_GENERATOR: {
    provider: "ai",
    purpose: "Set to ai so material-review questions are synthesized through the server-side AI provider."
  },
  LEARNBUDDY_EMBEDDING_PROVIDER: {
    provider: "embeddings",
    purpose: "Set to openai-compatible for external embedding retrieval."
  },
  LEARNBUDDY_EMBEDDING_BASE_URL: {
    provider: "embeddings",
    purpose: "Public OpenAI-compatible embeddings endpoint."
  },
  LEARNBUDDY_EMBEDDING_API_KEY: {
    provider: "embeddings",
    purpose: "Server-side embedding provider key."
  },
  LEARNBUDDY_OCR_PROVIDER: {
    provider: "ocr",
    purpose: "Set to http for provider-backed OCR/vision extraction of scanned materials."
  },
  LEARNBUDDY_OCR_BASE_URL: {
    provider: "ocr",
    purpose: "Public OCR/vision endpoint. The app normalizes this to /v1/ocr."
  },
  LEARNBUDDY_OCR_API_KEY: {
    provider: "ocr",
    purpose: "Server-side OCR/vision provider key."
  },
  LEARNBUDDY_STT_PROVIDER: {
    provider: "stt",
    purpose: "Set to mistral-voxtral, openai-compatible, self-hosted-vllm or self-hosted-vllm-realtime for external STT."
  },
  MISTRAL_API_KEY: {
    provider: "stt",
    purpose: "Mistral API key for Voxtral transcription."
  },
  LEARNORDIE_MINIMAX_API_KEY: {
    provider: "ai",
    purpose: "Server-side MiniMax M3 upstream key for the llm.learnordie.app Responses proxy."
  },
  MINIMAX_API_KEY: {
    provider: "ai",
    purpose: "Server-side MiniMax M3 upstream key for the llm.learnordie.app Responses proxy."
  },
  LEARNBUDDY_STT_API_KEY: {
    provider: "stt",
    purpose: "Server-side key for an OpenAI-compatible or self-hosted Voxtral/vLLM transcription endpoint."
  },
  LEARNBUDDY_STORAGE_PROVIDER: {
    provider: "storage",
    purpose: "Use vercel-blob, http or another configured remote storage provider."
  }
};
const DEPLOYMENT_ENDPOINT_ENV = [
  "LEARNBUDDY_RESEND_BASE_URL",
  "RESEND_BASE_URL",
  "LEARNBUDDY_AI_BASE_URL",
  "LEARNORDIE_LLM_PROXY_BASE_URL",
  "LEARNBUDDY_LLM_PROXY_BASE_URL",
  "CTOX_LLM_PROXY_BASE_URL",
  "LEARNBUDDY_EMBEDDING_BASE_URL",
  "LEARNBUDDY_OCR_BASE_URL",
  "LEARNBUDDY_STT_BASE_URL",
  "LEARNBUDDY_STT_REALTIME_BASE_URL",
  "MISTRAL_STT_BASE_URL",
  "LEARNBUDDY_JOB_ENDPOINT",
  "LEARNBUDDY_STORAGE_ENDPOINT"
];
const DEPLOYMENT_SECRET_ENV = [
  "AUTH_SECRET",
  "RESEND_API_KEY",
  "LEARNBUDDY_WORKER_SECRET",
  "CRON_SECRET",
  "LEARNBUDDY_AI_API_KEY",
  "LEARNORDIE_LLM_PROXY_API_KEY",
  "LEARNBUDDY_LLM_PROXY_API_KEY",
  "CTOX_LLM_PROXY_API_KEY",
  "LEARNORDIE_MINIMAX_API_KEY",
  "MINIMAX_API_KEY",
  "LEARNBUDDY_EMBEDDING_API_KEY",
  "LEARNBUDDY_OCR_API_KEY",
  "LEARNBUDDY_STT_API_KEY",
  "MISTRAL_API_KEY",
  "BLOB_READ_WRITE_TOKEN",
  "LEARNBUDDY_STORAGE_TOKEN",
  "LEARNBUDDY_STORAGE_API_KEY",
  "LEARNBUDDY_JOB_API_KEY"
];
const DEPLOYMENT_MAIL_SENDER_ENV = [
  "EMAIL_FROM"
];
const DEPLOYMENT_PROVIDER_MODE_ENV = [
  "LEARNBUDDY_DEPLOYMENT_ENV",
  "LEARNBUDDY_MAIL_PROVIDER",
  "LEARNBUDDY_STORAGE_PROVIDER",
  "LEARNBUDDY_JOB_PROVIDER",
  "LEARNBUDDY_AI_PROVIDER",
  "LEARNBUDDY_LECTURER_ASSISTANT_PROVIDER",
  "LEARNBUDDY_CHAT_MODERATION_PROVIDER",
  "LEARNBUDDY_QUESTION_GENERATOR",
  "LEARNBUDDY_EMBEDDING_PROVIDER",
  "LEARNBUDDY_OCR_PROVIDER",
  "LEARNBUDDY_STT_PROVIDER"
];
const SELF_HOSTING_FILES = [
  {
    file: "Dockerfile",
    expectations: [
      ["node_runtime", "FROM node:24-bookworm-slim"],
      ["deterministic_install", "npm ci"],
      ["production_build", "npm run build"],
      ["startup_migration", "npm run db:migrate"],
      ["public_bind", "0.0.0.0"],
      ["http_port", "EXPOSE 3000"]
    ]
  },
  {
    file: "compose.yaml",
    expectations: [
      ["pgvector_postgres", "pgvector/pgvector:pg16"],
      ["postgres_health_dependency", "condition: service_healthy"],
      ["database_url", "DATABASE_URL: postgres://learnbuddy:learnbuddy@postgres:5432/learnbuddy"],
      ["database_jobs", "LEARNBUDDY_JOB_PROVIDER: database"],
      ["local_artifact_volume", "LEARNBUDDY_STORAGE_DIR: /data/artifacts"],
      ["app_healthcheck", "http://127.0.0.1:3000/api/health"],
      ["postgres_volume", "postgres-data:"],
      ["app_volume", "app-data:"]
    ]
  },
  {
    file: ".dockerignore",
    expectations: [
      ["node_modules_excluded", "node_modules"],
      ["next_build_excluded", ".next"],
      ["env_excluded", ".env"],
      ["output_excluded", "output"],
      ["test_results_excluded", "test-results"]
    ]
  },
  {
    file: "package.json",
    expectations: [
      ["script_syntax_check_script", "\"scripts:check\""],
      ["live_load_smoke_script", "\"smoke:live-load\""],
      ["self_host_smoke_script", "\"smoke:self-host\""],
      ["backup_restore_smoke_script", "\"smoke:backup-restore\""],
      ["deploy_readiness_script", "\"deploy:readiness\""],
      ["release_gate_script", "\"release:gate\""]
    ]
  },
  {
    file: "scripts/script-syntax-check.mjs",
    expectations: [
      ["node_check_invocation", "\"--check\""],
      ["scripts_directory", "scripts"],
      ["json_command", "script-syntax-check"]
    ]
  },
  {
    file: "scripts/live-load-smoke.mjs",
    expectations: [
      ["student_join_load_check", "student_join_load"],
      ["answer_load_check", "answer_load"],
      ["leaderboard_consistency_check", "leaderboard_consistency"],
      ["default_participants", "DEFAULT_PARTICIPANTS = 30"]
    ]
  },
  {
    file: "scripts/self-host-smoke.mjs",
    expectations: [
      ["docker_cli_check", "docker_cli"],
      ["docker_compose_check", "docker_compose"],
      ["compose_config_check", "compose_config"],
      ["container_health_check", "container_health"],
      ["compose_cleanup", "compose_cleanup"]
    ]
  },
  {
    file: "scripts/backup-restore-smoke.mjs",
    expectations: [
      ["pg_dump_check", "pg_dump"],
      ["psql_check", "psql"],
      ["backup_check", "backup_sql"],
      ["restore_check", "restore_sql"],
      ["nonempty_guard", "nonempty_restore_guard"]
    ]
  },
  {
    file: ".env.example",
    expectations: [
      ["production_host_example", "learnbuddy.your-university.edu"],
      ["storage_host_example", "object-storage.your-university.edu"],
      ["verified_sender_example", "noreply@your-university.edu"],
      ["operator_email_example", "referent@your-university.edu"],
      ["release_gate_self_host", "LEARNBUDDY_RELEASE_GATE_SELF_HOST=0"]
    ]
  }
];
const ENV_EXAMPLE_EXPECTATIONS = [
  ["deploy_readiness_command", "npm run deploy:readiness -- --environment preview --pull-vercel-env"],
  ["deploy_readiness_environment", "LEARNBUDDY_DEPLOY_READINESS_ENVIRONMENT=preview"],
  ["deploy_readiness_pull_vercel_env", "LEARNBUDDY_DEPLOY_READINESS_PULL_VERCEL_ENV=0"],
  ["deploy_readiness_self_host", "LEARNBUDDY_DEPLOY_READINESS_SELF_HOST=0"],
  ["deploy_readiness_local", "LEARNBUDDY_DEPLOY_READINESS_LOCAL=0"],
  ["deploy_readiness_vercel_scope", "LEARNBUDDY_DEPLOY_READINESS_VERCEL_SCOPE=metric-spaces-projects"],
  ["deploy_readiness_timeout", "LEARNBUDDY_DEPLOY_READINESS_TIMEOUT_MS=20000"],
  ["release_gate_pull_vercel_env", "LEARNBUDDY_RELEASE_GATE_PULL_VERCEL_ENV=0"],
  ["release_gate_self_host", "LEARNBUDDY_RELEASE_GATE_SELF_HOST=0"],
  ["release_gate_allow_process_env", "LEARNBUDDY_RELEASE_GATE_ALLOW_PROCESS_ENV=0"]
];

function parseArgs() {
  const result = new Map();
  for (let index = 2; index < process.argv.length; index += 1) {
    const item = process.argv[index];
    if (!item.startsWith("--")) continue;
    const [rawKey, inlineValue] = item.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      result.set(rawKey, inlineValue);
      continue;
    }
    const next = process.argv[index + 1];
    if (!next || next.startsWith("--")) {
      result.set(rawKey, "1");
      continue;
    }
    result.set(rawKey, next);
    index += 1;
  }
  return result;
}

function helpRequested() {
  return process.argv.slice(2).some((item) => item === "-h" || item === "--help" || item.startsWith("--help="));
}

if (helpRequested()) {
  console.log(HELP_TEXT.trim());
  process.exit(0);
}

const args = parseArgs();
const checks = [];
let targetEnvValues = null;

function envValue(name) {
  if (targetEnvValues) return (targetEnvValues[name] ?? "").trim();
  return (process.env[name] ?? "").trim();
}

function activeEnvNames() {
  if (targetEnvValues) {
    return new Set(Object.keys(targetEnvValues).filter((name) => Boolean(envValue(name))));
  }
  return localEnvNames();
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
    lower.endsWith(".test") ||
    lower.endsWith(".invalid");
}

function secretValues() {
  return Object.entries({ ...process.env, ...(targetEnvValues ?? {}) })
    .filter(([key, value]) => value && /(KEY|TOKEN|SECRET|PASSWORD|AUTH|DATABASE_URL)/i.test(key))
    .map(([, value]) => String(value))
    .filter((value) => value.length >= 8);
}

function sanitize(value) {
  let text = value instanceof Error ? value.message : String(value);
  for (const secret of secretValues()) {
    text = text.split(secret).join("[secret]");
  }
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [secret]")
    .replace(/postgres:\/\/[^\s"']+/g, "postgres://[secret]");
}

function record(id, status, message, details = {}) {
  checks.push({
    id,
    status,
    message: sanitize(message),
    details
  });
}

function pass(id, message, details) {
  record(id, "pass", message, details);
}

function skip(id, message, details) {
  record(id, "skip", message, details);
}

function fail(id, message, details) {
  record(id, "fail", message, details);
}

function timeoutMs() {
  const configured = Number(args.get("timeout-ms") || envValue("LEARNBUDDY_DEPLOY_READINESS_TIMEOUT_MS"));
  return Number.isFinite(configured) && configured > 0 ? Math.min(120_000, Math.round(configured)) : DEFAULT_TIMEOUT_MS;
}

function normalizeEnvironment(value) {
  const environment = (value || envValue("LEARNBUDDY_DEPLOY_READINESS_ENVIRONMENT") || "preview").trim().toLowerCase();
  if (environment === "prod") return "production";
  if (environment === "production" || environment === "preview" || environment === "development") return environment;
  throw new Error("--environment must be preview, production or development.");
}

function shouldPullVercelEnv() {
  return args.has("pull-vercel-env") || envValue("LEARNBUDDY_DEPLOY_READINESS_PULL_VERCEL_ENV") === "1";
}

function vercelScope() {
  return args.get("scope") || envValue("LEARNBUDDY_DEPLOY_READINESS_VERCEL_SCOPE") || envValue("VERCEL_SCOPE");
}

async function commandExists(command, commandArgs = ["--version"]) {
  try {
    await runCommand(command, commandArgs, 5_000);
    return true;
  } catch {
    return false;
  }
}

function runCommand(command, commandArgs, commandTimeoutMs = timeoutMs()) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${command} timed out after ${commandTimeoutMs}ms.`));
    }, commandTimeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} ${commandArgs.join(" ")} exited with ${code}: ${stderr || stdout}`));
    });
  });
}

async function readProjectLink() {
  try {
    await access(".vercel/project.json");
    const payload = JSON.parse(await readFile(".vercel/project.json", "utf8"));
    return {
      linked: Boolean(payload.projectId && payload.orgId),
      projectId: typeof payload.projectId === "string" ? payload.projectId : "",
      orgId: typeof payload.orgId === "string" ? payload.orgId : ""
    };
  } catch {
    return { linked: false, projectId: "", orgId: "" };
  }
}

function envNamesFromVercelPayload(payload) {
  const candidates = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.envs)
      ? payload.envs
      : Array.isArray(payload?.environmentVariables)
        ? payload.environmentVariables
        : Array.isArray(payload?.records)
          ? payload.records
          : [];

  return new Set(candidates
    .map((item) => item?.key ?? item?.name)
    .filter((name) => typeof name === "string" && name.trim())
    .map((name) => name.trim()));
}

async function vercelEnvNames(environment) {
  const { stdout } = await runCommand("vercel", ["env", "list", environment, "--format=json"]);
  const payload = JSON.parse(stdout);
  return envNamesFromVercelPayload(payload);
}

function localEnvNames() {
  return new Set(Object.keys(process.env).filter((name) => Boolean(envValue(name))));
}

function parseDotenvValue(rawValue) {
  let value = rawValue.trim();
  if (!value) return "";
  const quote = value[0];
  if ((quote === "\"" || quote === "'") && value.endsWith(quote)) {
    value = value.slice(1, -1);
  }
  if (quote === "\"") {
    value = value
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, "\"")
      .replace(/\\\\/g, "\\");
  }
  return value;
}

function parseDotenv(content) {
  const parsed = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const normalized = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
    const equalsIndex = normalized.indexOf("=");
    if (equalsIndex <= 0) continue;
    const key = normalized.slice(0, equalsIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    parsed[key] = parseDotenvValue(normalized.slice(equalsIndex + 1));
  }
  return parsed;
}

async function pullVercelEnv(environment) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "learnbuddy-deploy-readiness-"));
  const envPath = path.join(tempRoot, `vercel-${environment}.env`);
  try {
    const commandArgs = ["env", "pull", envPath, `--environment=${environment}`];
    const scope = vercelScope();
    if (scope) commandArgs.push("--scope", scope);
    await runCommand("vercel", commandArgs, Math.max(timeoutMs(), 30_000));
    const parsed = Object.fromEntries(
      Object.entries(parseDotenv(await readFile(envPath, "utf8")))
        .filter(([, value]) => String(value).trim())
    );
    pass("vercel_env_pull", "Vercel environment variables were loaded for value checks.", {
      environment,
      scope: scope || null,
      count: Object.keys(parsed).length
    });
    return parsed;
  } catch (error) {
    fail("vercel_env_pull", "Could not pull Vercel environment variables.", {
      error: sanitize(error)
    });
    return null;
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function requiredEnvFor(environment) {
  if (environment === "preview") {
    return REQUIRED_ENV.filter((name) => !PREVIEW_RUNTIME_ENV.includes(name));
  }
  return REQUIRED_ENV;
}

function checkEnvSet(source, names) {
  const required = requiredEnvFor(environment);
  const missing = required.filter((name) => !names.has(name));
  const missingGroups = ALTERNATIVE_ENV_GROUPS
    .filter((group) => !group.anyOf.some((name) => names.has(name)))
    .map((group) => ({ id: group.id, description: group.description, anyOf: group.anyOf }));
  const forbidden = environment === "development"
    ? []
    : FORBIDDEN_DEPLOY_ENV.filter((item) => names.has(item.name));

  if (missing.length === 0 && missingGroups.length === 0) {
    pass("required_env", "All required deployment environment names are present.", {
      source,
      required: required.length,
      alternativeGroups: ALTERNATIVE_ENV_GROUPS.length,
      runtimeProvided: environment === "preview" ? PREVIEW_RUNTIME_ENV : []
    });
  } else {
    fail("required_env", "Deployment environment is missing required names.", {
      source,
      missing,
      missingGroups,
      runtimeProvided: environment === "preview" ? PREVIEW_RUNTIME_ENV : [],
      remediation: envRemediation(source, missing, missingGroups)
    });
  }

  if (forbidden.length === 0) {
    pass("forbidden_env", "No deployment-forbidden environment names are present.", {
      source,
      checked: FORBIDDEN_DEPLOY_ENV.map((item) => item.name)
    });
    return;
  }

  fail("forbidden_env", "Deployment environment contains local-only names.", {
    source,
    forbidden
  });
}

function envRemediation(source, missing, missingGroups) {
  const commandTarget = environment === "production" ? "production" : environment === "preview" ? "preview" : "development";
  const commandPrefix = source.startsWith("vercel:") ? "vercel env add" : "export";
  const isVercelPreview = commandPrefix === "vercel env add" && commandTarget === "preview";
  const commandFor = (name) => commandPrefix === "vercel env add"
    ? `${commandPrefix} ${name} ${commandTarget}`
    : `${commandPrefix} ${name}=...`;
  const branchCommandFor = (name) => isVercelPreview
    ? `${commandPrefix} ${name} ${commandTarget} <git-branch>`
    : null;
  const required = missing.map((name) => ({
    name,
    provider: REQUIRED_ENV_GUIDANCE[name]?.provider ?? "runtime",
    purpose: REQUIRED_ENV_GUIDANCE[name]?.purpose ?? "Required deployment value.",
    command: commandFor(name),
    branchCommand: branchCommandFor(name)
  }));
  const alternativeGroups = missingGroups.map((group) => ({
    id: group.id,
    description: group.description,
    provider: providerForAlternativeGroup(group.id),
    anyOf: group.anyOf,
    commands: group.anyOf.map((name) => commandFor(name)),
    branchCommands: group.anyOf
      .map((name) => branchCommandFor(name))
      .filter(Boolean)
  }));

  return {
    source,
    target: selfHostOnly ? "self-host" : "vercel",
    required,
    alternativeGroups,
    completionGroups: remediationCompletionGroups(required, alternativeGroups),
    notes: isVercelPreview
      ? [
        "Vercel CLI 52 may require a Preview Git Branch for non-interactive env-add calls. For all Preview branches, set the value in the Vercel Dashboard or through the Vercel API upsert endpoint; for a branch-specific value use the branchCommand form."
      ]
      : []
  };
}

function providerForAlternativeGroup(id) {
  if (id === "llm_proxy_key") return "ai";
  if (id === "minimax_upstream_key") return "ai";
  if (id === "stt_provider_key") return "stt";
  return "storage";
}

function remediationCompletionGroups(required, alternativeGroups) {
  const providerOrder = [
    "runtime",
    "auth",
    "postgres",
    "mail",
    "jobs",
    "ai",
    "embeddings",
    "ocr",
    "stt",
    "storage"
  ];
  const groups = new Map();
  const ensure = (provider) => {
    if (!groups.has(provider)) {
      groups.set(provider, {
        provider,
        missingRequired: [],
        missingAlternativeGroups: [],
        openItemCount: 0
      });
    }
    return groups.get(provider);
  };

  for (const item of required) {
    const group = ensure(item.provider);
    group.missingRequired.push({
      name: item.name,
      purpose: item.purpose,
      command: item.command,
      branchCommand: item.branchCommand
    });
    group.openItemCount += 1;
  }

  for (const item of alternativeGroups) {
    const group = ensure(item.provider);
    group.missingAlternativeGroups.push({
      id: item.id,
      description: item.description,
      anyOf: item.anyOf,
      commands: item.commands,
      branchCommands: item.branchCommands
    });
    group.openItemCount += 1;
  }

  return Array.from(groups.values())
    .sort((left, right) => {
      const leftIndex = providerOrder.indexOf(left.provider);
      const rightIndex = providerOrder.indexOf(right.provider);
      const normalizedLeft = leftIndex === -1 ? providerOrder.length : leftIndex;
      const normalizedRight = rightIndex === -1 ? providerOrder.length : rightIndex;
      return normalizedLeft - normalizedRight || left.provider.localeCompare(right.provider);
    });
}

function checkProviderEndpointValues(source) {
  if (environment === "development") {
    skip("provider_endpoint_values", "Skipped for development environment.");
    return;
  }

  if (!envSourceHasValues(source)) {
    skip("provider_endpoint_values", "Skipped because Vercel env listing exposes names only, not values.", { source });
    return;
  }

  const invalid = [];
  for (const name of DEPLOYMENT_ENDPOINT_ENV) {
    const value = envValue(name);
    if (!value) continue;
    try {
      const url = new URL(value);
      const allowedProtocols = name === "LEARNBUDDY_STT_REALTIME_BASE_URL"
        ? ["http:", "https:", "ws:", "wss:"]
        : ["http:", "https:"];
      if (!allowedProtocols.includes(url.protocol)) {
        invalid.push({ name, reason: name === "LEARNBUDDY_STT_REALTIME_BASE_URL" ? "Endpoint is not HTTP(S) or WS(S)." : "Endpoint is not HTTP(S)." });
        continue;
      }
      if (isLocalOrPrivateEndpointHost(url.hostname)) {
        invalid.push({ name, reason: "Endpoint points to a local or private network target." });
        continue;
      }
      if (isReservedExampleEndpointHost(url.hostname)) {
        invalid.push({ name, reason: "Endpoint points to a reserved example/test hostname." });
      }
    } catch {
      invalid.push({ name, reason: "Endpoint is not a valid absolute URL." });
    }
  }

  if (invalid.length === 0) {
    pass("provider_endpoint_values", "Deployment provider endpoint values are public-looking.", {
      source,
      checked: DEPLOYMENT_ENDPOINT_ENV
    });
    return;
  }

  fail("provider_endpoint_values", "Deployment provider endpoint values include invalid or local/private targets.", {
    source,
    invalid
  });
}

function placeholderSecretReason(name, value) {
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  if (!trimmed) return "";
  if (name === "AUTH_SECRET" && trimmed.length < 32) return "AUTH_SECRET must be at least 32 characters.";
  const placeholderTokens = [
    "replace",
    "placeholder",
    "change-me",
    "changeme",
    "mock",
    "dummy",
    "test_key",
    "_test_",
    "resend_test",
    "learnordie_llm_mock",
    "ctox_llm_mock",
    "re_xxx",
    "xxx"
  ];
  const matched = placeholderTokens.find((token) => lower.includes(token));
  return matched ? `Value looks like a placeholder (${matched}).` : "";
}

function checkPlaceholderEnvValues(source) {
  if (environment === "development") {
    skip("placeholder_env_values", "Skipped for development environment.");
    return;
  }
  if (!envSourceHasValues(source)) {
    skip("placeholder_env_values", "Skipped because Vercel env listing exposes names only, not values.", { source });
    return;
  }

  const invalid = DEPLOYMENT_SECRET_ENV
    .map((name) => {
      const reason = placeholderSecretReason(name, envValue(name));
      return reason ? { name, reason } : null;
    })
    .filter(Boolean);

  if (invalid.length === 0) {
    pass("placeholder_env_values", "Deployment secret values do not look like obvious placeholders.", {
      source,
      checked: DEPLOYMENT_SECRET_ENV
    });
    return;
  }

  fail("placeholder_env_values", "Deployment secret values include obvious placeholders.", {
    source,
    invalid
  });
}

function senderDomain(value) {
  const trimmed = value.trim();
  if (!trimmed) return { domain: "", error: "" };
  const angleMatch = trimmed.match(/<([^<>]+)>$/);
  const address = (angleMatch ? angleMatch[1] : trimmed).trim().replace(/^mailto:/i, "");
  const addressMatch = address.match(/^[^\s@<>]+@([A-Za-z0-9.-]+|\[[^\]]+\])$/);
  if (!addressMatch) {
    return { domain: "", error: "Sender is not a parseable email address." };
  }
  return {
    domain: normalizeHostname(addressMatch[1] ?? ""),
    error: ""
  };
}

function mailSenderReason(name, value) {
  const { domain, error } = senderDomain(value);
  if (error) return error;
  if (!domain) return "";
  if (isLocalOrPrivateEndpointHost(domain)) {
    return "Sender domain points to a local or private hostname.";
  }
  if (isReservedExampleEndpointHost(domain)) {
    return "Sender domain is a reserved example/test hostname.";
  }
  return "";
}

function checkMailSenderValues(source) {
  if (environment === "development") {
    skip("mail_sender_values", "Skipped for development environment.");
    return;
  }
  if (!envSourceHasValues(source)) {
    skip("mail_sender_values", "Skipped because Vercel env listing exposes names only, not values.", { source });
    return;
  }

  const invalid = DEPLOYMENT_MAIL_SENDER_ENV
    .map((name) => {
      const reason = mailSenderReason(name, envValue(name));
      return reason ? { name, reason } : null;
    })
    .filter(Boolean);

  if (invalid.length === 0) {
    pass("mail_sender_values", "Deployment mail sender values are public-looking.", {
      source,
      checked: DEPLOYMENT_MAIL_SENDER_ENV
    });
    return;
  }

  fail("mail_sender_values", "Deployment mail sender values include invalid or reserved domains.", {
    source,
    invalid
  });
}

function normalizeProviderMode(value) {
  return value.trim().toLowerCase();
}

function providerModeRules() {
  const deploymentEnvAllowed = environment === "production"
    ? ["production"]
    : environment === "preview"
      ? ["preview"]
      : ["development", "local"];
  const aiProviderAllowed = selfHostOnly
    ? ["learnordie-responses", "learnordie", "llm.learnordie.app", "ctox-responses", "ctox", "llm.ctox.dev", "responses", "openai-compatible", "http"]
    : ["learnordie-responses", "learnordie", "llm.learnordie.app", "ctox-responses", "ctox", "llm.ctox.dev", "responses"];
  const storageProviderAllowed = selfHostOnly
    ? ["vercel", "vercel-blob", "blob", "http", "object-http", "external"]
    : ["vercel", "vercel-blob", "blob"];
  const jobProviderAllowed = selfHostOnly
    ? ["database", "queue", "worker", "async", "http", "webhook", "external"]
    : ["database", "queue", "worker", "async"];

  return [
    {
      name: "LEARNBUDDY_DEPLOYMENT_ENV",
      allowed: deploymentEnvAllowed,
      reason: `Expected ${environment} runtime hardening for this target.`
    },
    {
      name: "LEARNBUDDY_MAIL_PROVIDER",
      allowed: ["resend"],
      reason: "Preview/production lecturer login must use Resend magic-link delivery."
    },
    {
      name: "LEARNBUDDY_STORAGE_PROVIDER",
      allowed: storageProviderAllowed,
      reason: selfHostOnly
        ? "Self-host targets must use a remote or app-proxied storage backend."
        : "Vercel targets must use Vercel Blob storage for uploaded and exported artifacts."
    },
    {
      name: "LEARNBUDDY_JOB_PROVIDER",
      allowed: jobProviderAllowed,
      reason: "Preview/production jobs must run outside the request path."
    },
    {
      name: "LEARNBUDDY_AI_PROVIDER",
      allowed: aiProviderAllowed,
      reason: selfHostOnly
        ? "Self-host targets may use Learnordie Responses or an OpenAI-compatible provider."
        : "Vercel targets must use the Learnordie Responses proxy path."
    },
    {
      name: "LEARNBUDDY_LECTURER_ASSISTANT_PROVIDER",
      allowed: ["ai"],
      reason: "Lecturer assistant must use the server-side AI provider."
    },
    {
      name: "LEARNBUDDY_CHAT_MODERATION_PROVIDER",
      allowed: ["ai"],
      reason: "Student chat moderation must use the server-side AI provider."
    },
    {
      name: "LEARNBUDDY_QUESTION_GENERATOR",
      allowed: ["ai"],
      reason: "Material questions must be generated through the server-side AI provider."
    },
    {
      name: "LEARNBUDDY_EMBEDDING_PROVIDER",
      allowed: ["openai-compatible", "http", "learnbuddy-local-hash-v1", "local-hash", "deterministic"],
      reason: "Material retrieval in preview/production needs a configured embedding provider."
    },
    {
      name: "LEARNBUDDY_OCR_PROVIDER",
      allowed: ["http", "external", "vision", "ocr", "openai-compatible", "openai-vision", "vision-chat"],
      reason: "Scanned material handling needs an external OCR/vision provider."
    },
    {
      name: "LEARNBUDDY_STT_PROVIDER",
      allowed: [
        "mistral",
        "mistral-voxtral",
        "voxtral",
        "external",
        "openai-compatible",
        "http",
        "self-hosted",
        "self-hosted-vllm",
        "vllm",
        "vllm-realtime",
        "self-hosted-vllm-realtime",
        "openai-realtime"
      ],
      reason: "Live transcripts need a configured external STT provider."
    }
  ];
}

function checkProviderModeValues(source) {
  if (environment === "development") {
    skip("provider_mode_values", "Skipped for development environment.");
    return;
  }
  if (!envSourceHasValues(source)) {
    skip("provider_mode_values", "Skipped because Vercel env listing exposes names only, not values.", { source });
    return;
  }

  const invalid = providerModeRules()
    .map((rule) => {
      const value = normalizeProviderMode(envValue(rule.name));
      if (!value || rule.allowed.includes(value)) return null;
      return {
        name: rule.name,
        value,
        expected: rule.allowed,
        reason: rule.reason
      };
    })
    .filter(Boolean);

  if (invalid.length === 0) {
    pass("provider_mode_values", "Deployment provider modes are production-capable.", {
      source,
      checked: DEPLOYMENT_PROVIDER_MODE_ENV
    });
    return;
  }

  fail("provider_mode_values", "Deployment provider modes include local, fallback or unsupported values.", {
    source,
    invalid
  });
}

async function checkLocalConfigFiles() {
  try {
    const config = JSON.parse(await readFile("vercel.json", "utf8"));
    const cronPaths = Array.isArray(config.crons)
      ? config.crons.map((cron) => cron?.path).filter((path) => typeof path === "string")
      : [];
    const regions = Array.isArray(config.regions)
      ? config.regions.filter((region) => typeof region === "string")
      : [];
    if (config.framework !== "nextjs") {
      fail("vercel_config", "vercel.json must declare the Next.js framework preset.", {
        file: "vercel.json",
        framework: config.framework ?? null
      });
    } else if (!cronPaths.includes("/api/jobs/worker/cron")) {
      fail("vercel_config", "vercel.json is missing the protected worker cron path.", {
        file: "vercel.json",
        cronPaths
      });
    } else if (!regions.includes("fra1")) {
      fail("vercel_config", "vercel.json must run Vercel Functions near the EU Neon database.", {
        file: "vercel.json",
        regions
      });
    } else {
      pass("vercel_config", "vercel.json declares Next.js, Frankfurt functions and the worker cron path.", {
        file: "vercel.json",
        framework: config.framework,
        regions,
        cronPaths
      });
    }
  } catch (error) {
    fail("vercel_config", error);
  }

  try {
    const nextConfig = await readFile("next.config.ts", "utf8");
    const requiredHeaders = [
      "Cache-Control",
      "Content-Security-Policy",
      "Referrer-Policy",
      "X-Content-Type-Options",
      "X-Frame-Options",
      "Permissions-Policy",
      "Strict-Transport-Security"
    ];
    const missing = requiredHeaders.filter((header) => !nextConfig.includes(header));
    const requiredNoStoreSources = ["/api/:path*", "/auth/:path*", "/lecturer/:path*", "/l/:path*", "/learn/:path*"];
    const missingNoStoreSources = requiredNoStoreSources.filter((source) => !nextConfig.includes(source));
    if (missing.length > 0 || missingNoStoreSources.length > 0 || !nextConfig.includes("headers()") || !nextConfig.includes("no-store")) {
      fail("security_headers", "Next.js security headers are incomplete.", {
        file: "next.config.ts",
        missing,
        missingNoStoreSources
      });
    } else {
      pass("security_headers", "Next.js global security headers are configured.", {
        file: "next.config.ts",
        headers: requiredHeaders,
        noStoreSources: requiredNoStoreSources
      });
    }
  } catch (error) {
    fail("security_headers", error);
  }

  try {
    const envExample = await readFile(".env.example", "utf8");
    const missing = ENV_EXAMPLE_EXPECTATIONS
      .filter(([, expected]) => !envExample.includes(expected))
      .map(([id]) => id);
    if (missing.length > 0) {
      fail("env_example_contract", ".env.example is missing deploy/readiness environment guidance.", {
        file: ".env.example",
        missing
      });
    } else {
      pass("env_example_contract", ".env.example documents deploy/readiness environment switches.", {
        file: ".env.example",
        expectations: ENV_EXAMPLE_EXPECTATIONS.map(([id]) => id)
      });
    }
  } catch (error) {
    fail("env_example_contract", error);
  }

  const missingFiles = [];
  const missingExpectations = {};
  for (const contract of SELF_HOSTING_FILES) {
    try {
      const content = await readFile(contract.file, "utf8");
      const missing = contract.expectations
        .filter(([, expected]) => !content.includes(expected))
        .map(([id]) => id);
      if (missing.length > 0) {
        missingExpectations[contract.file] = missing;
      }
    } catch {
      missingFiles.push(contract.file);
    }
  }

  if (missingFiles.length > 0 || Object.keys(missingExpectations).length > 0) {
    fail("self_hosting_files", "Self-hosting Docker/Compose contract is incomplete.", {
      missingFiles,
      missingExpectations
    });
  } else {
    pass("self_hosting_files", "Self-hosting Docker/Compose contract is present.", {
      files: SELF_HOSTING_FILES.map((contract) => contract.file)
    });
  }
}

const environment = (() => {
  try {
    return normalizeEnvironment(args.get("environment"));
  } catch (error) {
    fail("configuration", error);
    return "preview";
  }
})();
const localOnly = args.has("local") || envValue("LEARNBUDDY_DEPLOY_READINESS_LOCAL") === "1";
const selfHostOnly = args.has("self-host") || envValue("LEARNBUDDY_DEPLOY_READINESS_SELF_HOST") === "1";

function envSourceHasValues(source) {
  return source === "process.env" || source.endsWith(":env-pull");
}

await checkLocalConfigFiles();

let projectLink = { linked: false, projectId: "", orgId: "" };
if (selfHostOnly) {
  skip("vercel_cli", "Skipped for self-host readiness.");
  skip("vercel_auth", "Skipped for self-host readiness.");
  skip("vercel_project_link", "Skipped for self-host readiness.");
  if (shouldPullVercelEnv()) {
    fail("vercel_env_pull", "--pull-vercel-env cannot be combined with --self-host; self-host readiness uses process.env.", {
      target: "self-host"
    });
  }
} else {
  if (await commandExists("vercel")) {
    const { stdout } = await runCommand("vercel", ["--version"], 5_000);
    pass("vercel_cli", "Vercel CLI is installed.", { version: stdout.trim() });
  } else {
    fail("vercel_cli", "Vercel CLI is not installed or not on PATH.");
  }

  try {
    const { stdout } = await runCommand("vercel", ["whoami"], 10_000);
    pass("vercel_auth", "Vercel CLI is authenticated.", { account: stdout.trim() });
  } catch (error) {
    fail("vercel_auth", error);
  }

  projectLink = await readProjectLink();
  if (projectLink.linked) {
    pass("vercel_project_link", "Local directory is linked to a Vercel project.", {
      projectId: projectLink.projectId,
      orgId: projectLink.orgId
    });
  } else {
    fail("vercel_project_link", "Local directory is not linked. Run `vercel link --yes --team <team-id> --project <project-name-or-id>`.");
  }
}

if (localOnly || selfHostOnly) {
  const source = "process.env";
  if (localOnly && shouldPullVercelEnv()) {
    fail("vercel_env_pull", "--pull-vercel-env cannot be combined with --local; local readiness uses process.env.", {
      target: "local"
    });
  }
  checkEnvSet(source, activeEnvNames());
  checkProviderModeValues(source);
  checkProviderEndpointValues(source);
  checkPlaceholderEnvValues(source);
  checkMailSenderValues(source);
} else if (projectLink.linked) {
  let source = `vercel:${environment}`;
  let names = null;
  if (shouldPullVercelEnv()) {
    const pulled = await pullVercelEnv(environment);
    if (pulled) {
      targetEnvValues = pulled;
      source = `${source}:env-pull`;
      try {
        names = await vercelEnvNames(environment);
      } catch (error) {
        fail("vercel_env_list", error);
        names = activeEnvNames();
      }
    }
  }
  if (!names) {
    try {
      names = await vercelEnvNames(environment);
    } catch (error) {
      fail("vercel_env_list", error);
      names = new Set();
    }
  }
  checkEnvSet(source, names);
  checkProviderModeValues(source);
  checkProviderEndpointValues(source);
  checkPlaceholderEnvValues(source);
  checkMailSenderValues(source);
} else {
  skip("vercel_env_list", "Skipped because the project is not linked.");
  const source = "process.env";
  checkEnvSet(source, localEnvNames());
  checkProviderModeValues(source);
  checkProviderEndpointValues(source);
  checkPlaceholderEnvValues(source);
  checkMailSenderValues(source);
}

const summary = {
  total: checks.length,
  passed: checks.filter((check) => check.status === "pass").length,
  warnings: checks.filter((check) => check.status === "warn").length,
  skipped: checks.filter((check) => check.status === "skip").length,
  failed: checks.filter((check) => check.status === "fail").length
};
const ok = summary.failed === 0;
const blockers = checks
  .filter((check) => check.status === "fail")
  .map((check) => ({
    id: check.id,
    status: check.status,
    message: check.message,
    details: check.details
  }));

console.log(JSON.stringify({
  ok,
  command: "deploy-readiness",
  environment,
  target: selfHostOnly ? "self-host" : "vercel",
  checks,
  blockers,
  summary
}, null, 2));

process.exit(ok ? 0 : 1);
