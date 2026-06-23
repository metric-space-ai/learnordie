#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_LECTURE_TOKEN = "gleitlagerung-demo";
const REQUIRED_FULL_PROVIDER_SMOKE_CHECKS = [
  "ai",
  "lecturer_assistant",
  "chat_moderation",
  "question_generator",
  "embedding",
  "ocr",
  "storage",
  "mail",
  "stt"
];

const HELP_TEXT = `
Usage: npm run release:gate -- [options]

Runs the LearnBuddy release gate and prints a machine-readable JSON result.

Core options:
  --mode full|preview-baseline       Full release gate or CI-safe baseline gate.
  --environment preview|production|development
                                    Target environment. "prod" aliases production.
  --url <https-url>                  Public app URL for live, load and worker smokes.
  --lecture-token <token>            Public lecture token used by live smokes.
  --email <email>                    Smoke-test lecturer email for provider/live checks.
  --timeout-ms <ms>                  Per-step timeout. Defaults to 120000.

Target configuration:
  --pull-vercel-env                  Pull target env through the Vercel CLI.
  --scope <vercel-scope>             Optional Vercel scope passed to "vercel env pull".
  --self-host                        Use process env and self-host deploy readiness.
  --allow-process-env                Diagnostic full-gate mode without Vercel env pull.

Provider and auth options:
  --provider-only <csv>              Restrict provider smokes. Full gates require all checks.
  --mock-providers                   Only allowed outside --mode full.
  --magic-link <url>                 Real Resend magic link for full live auth smoke.
  --preflight-profile <profile>      Override admin preflight profile.

Diagnostic skip flags:
  --skip-local
  --skip-e2e
  --skip-readiness
  --skip-preflight
  --skip-provider
  --skip-live
  --skip-load
  --skip-worker

Examples:
  npm run release:gate -- --mode preview-baseline --environment development --url http://127.0.0.1:3070 --skip-e2e --skip-readiness --skip-preflight --skip-provider --skip-live --skip-worker
  npm run release:gate -- --mode full --environment preview --pull-vercel-env --url https://<preview-url> --email referent@your-university.edu
`;

function helpRequested() {
  return process.argv.slice(2).some((item) => item === "-h" || item === "--help" || item.startsWith("--help="));
}

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

if (helpRequested()) {
  console.log(HELP_TEXT.trim());
  process.exit(0);
}

const args = parseArgs();
const checks = [];
let commandEnv = {};

function envValue(name) {
  const pulled = (commandEnv[name] ?? "").trim();
  if (pulled) return pulled;
  return (process.env[name] ?? "").trim();
}

function secretValues() {
  return Object.entries({ ...process.env, ...commandEnv })
    .filter(([key, value]) => value && /(KEY|TOKEN|SECRET|PASSWORD|AUTH|LINK|DATABASE_URL)/i.test(key))
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
    .replace(/token=[A-Za-z0-9._~+/=-]+/g, "token=[secret]")
    .replace(/postgres:\/\/[^\s"']+/g, "postgres://[secret]")
    .replace(/https?:\/\/[^\s"']*\/auth\/magic\?token=[A-Za-z0-9._~+/=-]+/g, "https://[redacted]/auth/magic?token=[secret]");
}

function sanitizeStructured(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string" || value instanceof Error) return sanitize(value);
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeStructured(item));

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, sanitizeStructured(item)])
  );
}

function record(id, status, message, details = {}) {
  checks.push({
    id,
    status,
    message: sanitize(message),
    details: sanitizeStructured(details)
  });
}

function pass(id, message, details) {
  record(id, "pass", message, details);
}

function fail(id, message, details) {
  record(id, "fail", message, details);
}

function skip(id, message, details) {
  record(id, "skip", message, details);
}

function configuredTimeoutMs() {
  const value = Number(args.get("timeout-ms") || envValue("LEARNBUDDY_RELEASE_GATE_TIMEOUT_MS"));
  return Number.isFinite(value) && value > 0 ? Math.min(900_000, Math.round(value)) : DEFAULT_TIMEOUT_MS;
}

function normalizeMode() {
  const mode = (args.get("mode") || envValue("LEARNBUDDY_RELEASE_GATE_MODE") || "full").trim().toLowerCase();
  if (mode === "full" || mode === "production" || mode === "release") return "full";
  if (mode === "preview-baseline" || mode === "baseline") return "preview-baseline";
  throw new Error("--mode must be full or preview-baseline.");
}

function normalizeEnvironment() {
  const value = (args.get("environment") || envValue("LEARNBUDDY_RELEASE_GATE_ENVIRONMENT") || "preview").trim().toLowerCase();
  if (value === "prod") return "production";
  if (value === "production" || value === "preview" || value === "development") return value;
  throw new Error("--environment must be preview, production or development.");
}

function normalizeBaseUrl(value) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  const parsed = new URL(trimmed);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Release gate URL must be HTTP(S).");
  }
  return parsed.toString().replace(/\/+$/, "");
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

function isLocalReleaseHost(hostname) {
  const normalized = normalizeHostname(hostname);
  if (normalized === "localhost" || normalized.endsWith(".localhost") || normalized.endsWith(".local")) {
    return true;
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized)) return isPrivateIpv4(normalized);
  if (normalized.includes(":")) return isPrivateIpv6(normalized);
  return false;
}

function isReservedReleaseHost(hostname) {
  const normalized = normalizeHostname(hostname);
  return normalized === "example.com" ||
    normalized === "example.net" ||
    normalized === "example.org" ||
    normalized.endsWith(".example.com") ||
    normalized.endsWith(".example.net") ||
    normalized.endsWith(".example.org") ||
    normalized === "example" ||
    normalized.endsWith(".example") ||
    normalized === "test" ||
    normalized.endsWith(".test") ||
    normalized === "invalid" ||
    normalized.endsWith(".invalid");
}

function checkFullReleaseTarget(environment, baseUrl) {
  if (environment !== "preview" && environment !== "production") {
    fail("release_target", "Full release gate is only valid for preview or production targets.", { environment });
    return;
  }
  if (!baseUrl) return;
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== "https:") {
    fail("release_target", "Full release gate requires a public HTTPS URL.", {
      origin: parsed.origin,
      protocol: parsed.protocol
    });
    return;
  }
  if (isLocalReleaseHost(parsed.hostname)) {
    fail("release_target", "Full release gate cannot use localhost, .local, link-local or private network targets.", {
      origin: parsed.origin,
      hostname: parsed.hostname
    });
    return;
  }
  if (isReservedReleaseHost(parsed.hostname)) {
    fail("release_target", "Full release gate cannot use reserved example or test targets.", {
      origin: parsed.origin,
      hostname: parsed.hostname
    });
    return;
  }
  pass("release_target", "Full release target is a public HTTPS preview/production URL.", {
    environment,
    origin: parsed.origin
  });
}

function checkProductionCanonicalUrl(environment, baseUrl) {
  if (environment !== "production") return;
  const configured = envValue("NEXT_PUBLIC_APP_URL");
  if (!configured) {
    fail("release_canonical_url", "Production full release gate requires NEXT_PUBLIC_APP_URL.");
    return;
  }

  try {
    const checked = new URL(baseUrl);
    const canonical = new URL(normalizeBaseUrl(configured));
    if (canonical.origin !== checked.origin) {
      fail("release_canonical_url", "Production full release gate URL must match NEXT_PUBLIC_APP_URL origin.", {
        checkedOrigin: checked.origin,
        canonicalOrigin: canonical.origin
      });
      return;
    }
    pass("release_canonical_url", "Production release URL matches NEXT_PUBLIC_APP_URL origin.", {
      origin: checked.origin
    });
  } catch {
    fail("release_canonical_url", "NEXT_PUBLIC_APP_URL is not a valid HTTP(S) URL.");
  }
}

function magicLinkTargetProblem(magicLink, baseUrl) {
  try {
    const app = new URL(baseUrl);
    const trimmed = magicLink.trim();
    if (!/^https:\/\//i.test(trimmed)) {
      return {
        message: "Full release gate magic link must be an absolute HTTPS URL.",
        details: {
          requiredScheme: "https"
        }
      };
    }

    const parsed = new URL(trimmed);
    if (parsed.origin !== app.origin) {
      return {
        message: "Full release gate magic link must belong to the checked app origin.",
        details: {
          expectedOrigin: app.origin,
          actualOrigin: parsed.origin
        }
      };
    }
    if (parsed.pathname !== "/auth/magic") {
      return {
        message: "Full release gate magic link must target /auth/magic.",
        details: {
          expectedPath: "/auth/magic",
          actualPath: parsed.pathname
        }
      };
    }
    if (!parsed.searchParams.get("token")) {
      return {
        message: "Full release gate magic link is missing its token parameter.",
        details: {
          origin: parsed.origin,
          path: parsed.pathname
        }
      };
    }
  } catch {
    return {
      message: "Full release gate received an invalid magic link URL.",
      details: {}
    };
  }
  return null;
}

function commandTimeoutMs(kind) {
  if (kind === "e2e") return Math.max(configuredTimeoutMs(), 600_000);
  if (kind === "build") return Math.max(configuredTimeoutMs(), 300_000);
  return configuredTimeoutMs();
}

function outputExcerpt(stdout, stderr) {
  const text = sanitize(`${stdout}\n${stderr}`.trim());
  if (!text) return "";
  return text.length > 2000 ? `${text.slice(0, 2000)}...` : text;
}

function parseJsonPayload(stdout, stderr) {
  const text = `${stdout}\n${stderr}`;
  const indexes = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "{") indexes.push(index);
  }
  for (const index of indexes) {
    try {
      return JSON.parse(text.slice(index));
    } catch {
      // Try the next JSON-looking offset.
    }
  }
  return null;
}

function failedLabel(label) {
  const normalized = String(label).trim();
  if (normalized.endsWith(" passed.")) {
    return `${normalized.slice(0, -" passed.".length)} failed.`;
  }
  if (normalized.endsWith(" passed")) {
    return `${normalized.slice(0, -" passed".length)} failed.`;
  }
  return `${normalized.replace(/\.$/, "")} failed.`;
}

function parseDotenvValue(rawValue) {
  const trimmed = rawValue.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    return trimmed
      .slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\"/g, "\"")
      .replace(/\\\\/g, "\\");
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed.replace(/\s+#.*$/, "").trim();
}

function parseDotenv(content) {
  const parsed = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const equalsIndex = normalized.indexOf("=");
    if (equalsIndex <= 0) continue;
    const key = normalized.slice(0, equalsIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    parsed[key] = parseDotenvValue(normalized.slice(equalsIndex + 1));
  }
  return parsed;
}

function runCommand(command, commandArgs, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, {
      cwd: process.cwd(),
      env: { ...process.env, ...commandEnv, ...(options.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({
        ok: false,
        timedOut: true,
        code: null,
        stdout,
        stderr: `${stderr}\nTimed out after ${options.timeoutMs ?? configuredTimeoutMs()}ms.`
      });
    }, options.timeoutMs ?? configuredTimeoutMs());
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      resolve({ ok: false, error, code: null, stdout, stderr });
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}

function shouldPullVercelEnv() {
  return args.has("pull-vercel-env") || (process.env.LEARNBUDDY_RELEASE_GATE_PULL_VERCEL_ENV ?? "").trim() === "1";
}

function selfHostReleaseTarget() {
  return args.has("self-host") || envValue("LEARNBUDDY_RELEASE_GATE_SELF_HOST") === "1";
}

function allowProcessEnvSource() {
  return args.has("allow-process-env") || envValue("LEARNBUDDY_RELEASE_GATE_ALLOW_PROCESS_ENV") === "1";
}

function checkFullEnvironmentSource() {
  if (selfHostReleaseTarget()) {
    if (shouldPullVercelEnv()) {
      fail("release_env_source", "Self-host full release gate cannot pull Vercel env; use process.env for the target configuration.", {
        target: "self-host"
      });
      return;
    }
    pass("release_env_source", "Full self-host release gate uses process.env for provider and preflight checks.", {
      source: "process.env",
      target: "self-host"
    });
    return;
  }

  if (shouldPullVercelEnv()) {
    pass("release_env_source", "Full release gate uses the pulled Vercel target environment.", {
      source: "vercel-env-pull"
    });
    return;
  }

  if (allowProcessEnvSource()) {
    pass("release_env_source", "Full release gate explicitly uses process.env for provider and preflight checks.", {
      source: "process.env"
    });
    return;
  }

  fail("release_env_source", "Full release gate requires --pull-vercel-env or explicit --allow-process-env so checks use the intended deployment configuration.", {
    required: ["--pull-vercel-env", "--allow-process-env"]
  });
}

async function pullVercelEnv(environment, timeoutMs) {
  const scope = args.get("scope") || process.env.LEARNBUDDY_RELEASE_GATE_VERCEL_SCOPE || process.env.VERCEL_SCOPE || "";
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "learnbuddy-release-gate-"));
  const envPath = path.join(tempRoot, `vercel-${environment}.env`);
  try {
    const commandArgs = ["env", "pull", envPath, `--environment=${environment}`];
    if (scope) commandArgs.push("--scope", scope);
    const result = await runCommand("vercel", commandArgs, { timeoutMs: Math.max(timeoutMs, 30_000) });
    if (!result.ok) {
      fail("vercel_env_pull", "Could not pull Vercel environment variables.", {
        exitCode: result.code,
        timedOut: Boolean(result.timedOut),
        output: outputExcerpt(result.stdout, result.stderr)
      });
      return {};
    }

    const parsed = Object.fromEntries(
      Object.entries(parseDotenv(await readFile(envPath, "utf8")))
        .filter(([, value]) => value.trim())
    );
    pass("vercel_env_pull", "Vercel environment variables were loaded into the release-gate process.", {
      environment,
      scope: scope || null,
      count: Object.keys(parsed).length
    });
    return parsed;
  } catch (error) {
    fail("vercel_env_pull", error);
    return {};
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function runJsonStep(id, label, command, commandArgs, options = {}) {
  const result = await runCommand(command, commandArgs, options);
  const payload = parseJsonPayload(result.stdout, result.stderr);
  const normalizeChild = (check) => ({
    id: check.id,
    status: check.status,
    severity: check.severity ?? undefined,
    message: sanitize(check.message ?? ""),
    details: check.status !== "pass" && check.details ? sanitizeStructured(check.details) : undefined
  });
  const details = payload
    ? {
      ok: payload.ok ?? null,
      command: payload.command ?? null,
      summary: payload.summary ?? null,
      checks: Array.isArray(payload.checks)
        ? payload.checks.map(normalizeChild)
        : undefined,
      blockers: Array.isArray(payload.blockers)
        ? payload.blockers.map(normalizeChild)
        : undefined
    }
    : { output: outputExcerpt(result.stdout, result.stderr) };

  if (result.ok && !payload) {
    fail(id, failedLabel(label), {
      exitCode: result.code,
      timedOut: Boolean(result.timedOut),
      output: outputExcerpt(result.stdout, result.stderr),
      reason: "missing_json"
    });
    return false;
  }

  if (result.ok && payload?.ok !== false) {
    pass(id, label, details);
    return true;
  }

  fail(id, failedLabel(label), {
    exitCode: result.code,
    timedOut: Boolean(result.timedOut),
    ...details
  });
  return false;
}

async function runPlainStep(id, label, command, commandArgs, options = {}) {
  const result = await runCommand(command, commandArgs, options);
  if (result.ok) {
    pass(id, label);
    return true;
  }
  fail(id, `${label} failed.`, {
    exitCode: result.code,
    timedOut: Boolean(result.timedOut),
    output: outputExcerpt(result.stdout, result.stderr)
  });
  return false;
}

function blockerDetails(details = {}) {
  if (!details || typeof details !== "object" || Array.isArray(details)) return undefined;

  const { checks: childChecks, blockers: providedChildBlockers, ...rest } = details;
  const output = sanitizeStructured(rest);
  const childBlockerSource = Array.isArray(providedChildBlockers)
    ? providedChildBlockers
    : Array.isArray(childChecks)
      ? childChecks.filter((check) => check.status === "fail")
      : [];
  const childBlockers = childBlockerSource.length > 0
    ? childBlockerSource.map((check) => ({
      id: check.id,
      status: check.status,
      severity: check.severity ?? undefined,
      message: sanitize(check.message ?? ""),
      details: check.details ? sanitizeStructured(check.details) : undefined
    }))
    : [];

  if (childBlockers.length > 0) {
    output.childChecks = childBlockers;
  }

  return Object.keys(output).length > 0 ? output : undefined;
}

function releaseBlockers(failed, skipped) {
  return [...failed, ...skipped].map((check) => {
    const details = blockerDetails(check.details);
    return {
      id: check.id,
      status: check.status,
      message: check.message,
      ...(details ? { details } : {})
    };
  });
}

function skippedByFlag(flagName) {
  return args.has(flagName) || envValue(`LEARNBUDDY_RELEASE_GATE_${flagName.replace(/-/g, "_").toUpperCase()}`) === "1";
}

function liveSmokeArgs(baseUrl, lectureToken, mode) {
  const commandArgs = ["run", "smoke:live", "--", "--url", baseUrl, "--lecture-token", lectureToken];
  if (mode === "full") {
    commandArgs.push("--auth", "--require-auth", "--include-ai", "--require-ai-provider", "--include-assistant", "--require-assistant-provider");
    const email = releaseGateEmail();
    if (email) commandArgs.push("--email", email);
  }
  return commandArgs;
}

function liveLoadSmokeArgs(baseUrl, lectureToken) {
  const commandArgs = ["run", "smoke:live-load", "--", "--url", baseUrl, "--lecture-token", lectureToken];
  const participants = args.get("load-participants") || envValue("LEARNBUDDY_RELEASE_GATE_LOAD_PARTICIPANTS");
  const concurrency = args.get("load-concurrency") || envValue("LEARNBUDDY_RELEASE_GATE_LOAD_CONCURRENCY");
  const anchorRounds = args.get("load-anchor-rounds") || envValue("LEARNBUDDY_RELEASE_GATE_LOAD_ANCHOR_ROUNDS");
  const answers = args.get("load-answers") || envValue("LEARNBUDDY_RELEASE_GATE_LOAD_ANSWERS");
  const maxP95Ms = args.get("load-max-p95-ms") || envValue("LEARNBUDDY_RELEASE_GATE_LOAD_MAX_P95_MS");
  if (participants) commandArgs.push("--participants", participants);
  if (concurrency) commandArgs.push("--concurrency", concurrency);
  if (anchorRounds) commandArgs.push("--anchor-rounds", anchorRounds);
  if (answers) commandArgs.push("--answers", answers);
  if (maxP95Ms) commandArgs.push("--max-p95-ms", maxP95Ms);
  return commandArgs;
}

function releaseGateEmail() {
  return args.get("email") || envValue("LEARNBUDDY_RELEASE_GATE_EMAIL");
}

function providerSmokeEnv() {
  const email = releaseGateEmail();
  if (!email || envValue("LEARNBUDDY_PROVIDER_SMOKE_EMAIL") || envValue("LEARNBUDDY_SMOKE_EMAIL")) return {};
  return { LEARNBUDDY_PROVIDER_SMOKE_EMAIL: email };
}

function providerOnlyChecks() {
  const raw = args.get("provider-only") || envValue("LEARNBUDDY_RELEASE_GATE_PROVIDER_ONLY");
  if (!raw) return null;
  return new Set(String(raw).split(",").map((item) => item.trim()).filter(Boolean));
}

function fullProviderSmokeCoverage() {
  const selected = providerOnlyChecks();
  if (!selected) return {
    ok: true,
    selected: null,
    missing: [],
    unknown: []
  };

  const missing = REQUIRED_FULL_PROVIDER_SMOKE_CHECKS.filter((check) => !selected.has(check));
  const unknown = [...selected].filter((check) => !REQUIRED_FULL_PROVIDER_SMOKE_CHECKS.includes(check));
  return {
    ok: missing.length === 0 && unknown.length === 0 && selected.size === REQUIRED_FULL_PROVIDER_SMOKE_CHECKS.length,
    selected: [...selected],
    missing,
    unknown
  };
}

function providerSmokeArgs(mode) {
  const commandArgs = ["run", "provider:smoke", "--", "--profile", mode === "full" ? "production" : "preview"];
  const only = args.get("provider-only") || envValue("LEARNBUDDY_RELEASE_GATE_PROVIDER_ONLY");
  if (only) commandArgs.push("--only", only);
  if (mode !== "full" && args.has("mock-providers")) commandArgs.push("--mock");
  return commandArgs;
}

function mockProvidersRequested() {
  return args.has("mock-providers") || envValue("LEARNBUDDY_PROVIDER_SMOKE_MOCK") === "1";
}

function preflightProfile(environment) {
  const configured = args.get("preflight-profile") || envValue("LEARNBUDDY_RELEASE_GATE_PREFLIGHT_PROFILE");
  if (configured) return configured;
  return environment === "production" ? "production" : "preview";
}

function preflightEnv(environment, baseUrl) {
  if (environment === "production" || !baseUrl) return {};
  return { VERCEL_URL: baseUrl };
}

async function main() {
  let mode;
  let environment;
  let baseUrl;
  const timeoutMs = configuredTimeoutMs();
  try {
    environment = normalizeEnvironment();
    if (shouldPullVercelEnv() && !selfHostReleaseTarget()) {
      commandEnv = await pullVercelEnv(environment, timeoutMs);
    }
    mode = normalizeMode();
    baseUrl = normalizeBaseUrl(args.get("url") || envValue("LEARNBUDDY_RELEASE_GATE_URL") || envValue("NEXT_PUBLIC_APP_URL"));
  } catch (error) {
    fail("configuration", error);
  }

  const lectureToken = args.get("lecture-token") || envValue("LEARNBUDDY_RELEASE_GATE_LECTURE_TOKEN") || DEFAULT_LECTURE_TOKEN;
  const strictProductionCandidate = mode === "full";

  if (!mode || !environment) {
    // Configuration errors were already recorded.
  } else {
    if (strictProductionCandidate) {
      checkFullReleaseTarget(environment, baseUrl);
      checkProductionCanonicalUrl(environment, baseUrl);
      checkFullEnvironmentSource();
    }

    if (skippedByFlag("skip-local")) {
      skip("local_gates", "Skipped local gates by flag.");
    } else {
      await runJsonStep("script_syntax", "Operational script syntax passed.", "npm", ["run", "scripts:check"], { timeoutMs });
      await runPlainStep("typecheck", "TypeScript typecheck passed.", "npm", ["run", "typecheck"], { timeoutMs });
      await runPlainStep("lint", "ESLint passed.", "npm", ["run", "lint"], { timeoutMs });
      await runPlainStep("build", "Next.js production build passed.", "npm", ["run", "build"], { timeoutMs: commandTimeoutMs("build") });
      await runPlainStep("audit", "npm audit passed at moderate threshold.", "npm", ["audit", "--audit-level=moderate"], { timeoutMs });
      await runPlainStep("motion_contract", "LearnBuddy motion/design contract passed.", "npm", ["run", "motion:contract"], { timeoutMs });
      await runJsonStep("backup_restore_config", "Backup/restore config smoke passed.", "npm", [
        "run", "smoke:backup-restore", "--", "--config-only"
      ], { timeoutMs });
      if (skippedByFlag("skip-e2e")) {
        skip("e2e", "Skipped E2E browser tests by flag.");
      } else {
        await runPlainStep("e2e", "Playwright E2E suite passed.", "npm", ["run", "test:e2e"], { timeoutMs: commandTimeoutMs("e2e") });
      }
    }

    if (skippedByFlag("skip-readiness")) {
      skip("deploy_readiness", "Skipped deploy readiness by flag.");
    } else {
      const readinessArgs = ["run", "deploy:readiness", "--", "--environment", environment];
      if (selfHostReleaseTarget()) readinessArgs.push("--self-host");
      else if (shouldPullVercelEnv()) readinessArgs.push("--local");
      await runJsonStep("deploy_readiness", "Deploy readiness passed.", "npm", [
        ...readinessArgs
      ], { timeoutMs });
    }

    if (skippedByFlag("skip-preflight")) {
      skip("admin_preflight", "Skipped admin preflight by flag.");
    } else {
      const profile = preflightProfile(environment);
      await runJsonStep("admin_preflight", "Admin preflight passed.", "npm", [
        "run", "admin", "--", "preflight", "--profile", profile
      ], { timeoutMs, env: preflightEnv(environment, baseUrl) });
    }

    if (skippedByFlag("skip-provider")) {
      skip("provider_smoke", "Skipped provider smoke by flag.");
    } else {
      if (mode === "full" && mockProvidersRequested()) {
        fail("provider_smoke", "Full release gate requires real provider smoke; mock providers are only allowed outside --mode full.");
      } else if (mode === "full") {
        const coverage = fullProviderSmokeCoverage();
        if (!coverage.ok) {
          fail("provider_smoke_coverage", "Full release gate requires the complete provider-smoke set; --provider-only is only valid here when it includes every required check.", {
            required: REQUIRED_FULL_PROVIDER_SMOKE_CHECKS,
            selected: coverage.selected,
            missing: coverage.missing,
            unknown: coverage.unknown
          });
        } else {
          await runJsonStep("provider_smoke", "Provider smoke passed.", "npm", providerSmokeArgs(mode), { timeoutMs, env: providerSmokeEnv() });
        }
      } else {
        await runJsonStep("provider_smoke", "Provider smoke passed.", "npm", providerSmokeArgs(mode), { timeoutMs, env: providerSmokeEnv() });
      }
    }

    if (!baseUrl) {
      fail("public_url", "--url or LEARNBUDDY_RELEASE_GATE_URL is required for live and worker smokes.");
    } else if (skippedByFlag("skip-live")) {
      skip("live_smoke", "Skipped public browser live smoke by flag.");
    } else {
      const magicLink = args.get("magic-link") || envValue("LEARNBUDDY_RELEASE_GATE_MAGIC_LINK") || envValue("LEARNBUDDY_LIVE_SMOKE_MAGIC_LINK");
      if (mode === "full" && !magicLink) {
        fail("live_auth_precondition", "Full release gate requires a real Resend magic link via --magic-link or LEARNBUDDY_RELEASE_GATE_MAGIC_LINK.");
      } else {
        const magicLinkProblem = mode === "full" && magicLink ? magicLinkTargetProblem(magicLink, baseUrl) : null;
        if (magicLinkProblem) {
          fail("magic_link_target", magicLinkProblem.message, magicLinkProblem.details);
        } else {
          await runJsonStep("live_smoke", "Public browser live smoke passed.", "npm", liveSmokeArgs(baseUrl, lectureToken, mode), {
            timeoutMs,
            env: magicLink ? { LEARNBUDDY_LIVE_SMOKE_MAGIC_LINK: magicLink } : {}
          });
        }
      }
    }

    if (!baseUrl) {
      // Already reported as public_url.
    } else if (skippedByFlag("skip-live")) {
      skip("live_load_smoke", "Skipped live load smoke because public browser live smoke was skipped.");
    } else if (skippedByFlag("skip-load")) {
      skip("live_load_smoke", "Skipped live load smoke by flag.");
    } else {
      await runJsonStep("live_load_smoke", "Public 30-participant live load smoke passed.", "npm", liveLoadSmokeArgs(baseUrl, lectureToken), {
        timeoutMs: Math.max(timeoutMs, 120_000)
      });
    }

    if (!baseUrl) {
      // Already reported as public_url.
    } else if (skippedByFlag("skip-worker")) {
      skip("worker_smoke", "Skipped worker/storage smoke by flag.");
    } else {
      await runJsonStep("worker_smoke", "Worker/storage smoke passed.", "npm", [
        "run", "smoke:worker", "--", "--url", baseUrl, "--lecture-token", lectureToken, "--timeout-ms", String(Math.max(timeoutMs, 180_000))
      ], { timeoutMs: Math.max(timeoutMs, 180_000) });
    }
  }

  const skipped = checks.filter((check) => check.status === "skip");

  if (strictProductionCandidate && skipped.length > 0) {
    fail("release_coverage", "Full release gate cannot be release-ready with skipped checks.", {
      skipped: skipped.map((check) => check.id)
    });
  }

  const finalFailed = checks.filter((check) => check.status === "fail");
  const finalSkipped = checks.filter((check) => check.status === "skip");
  const finalOk = finalFailed.length === 0 && (!strictProductionCandidate || finalSkipped.length === 0);
  const releaseReady = strictProductionCandidate && finalOk;
  const blockers = releaseBlockers(finalFailed, finalSkipped);

  console.log(JSON.stringify({
    ok: finalOk,
    releaseReady,
    productionReady: releaseReady && environment === "production",
    command: "release-gate",
    mode,
    environment,
    target: selfHostReleaseTarget() ? "self-host" : "vercel",
    url: baseUrl || null,
    lectureToken,
    checks,
    blockers,
    summary: {
      total: checks.length,
      passed: checks.filter((check) => check.status === "pass").length,
      skipped: finalSkipped.length,
      failed: finalFailed.length
    }
  }, null, 2));

  if (!finalOk) process.exitCode = 1;
}

main().catch((error) => {
  fail("release_gate", error);
  const failed = checks.filter((check) => check.status === "fail");
  const skipped = checks.filter((check) => check.status === "skip");
  console.log(JSON.stringify({
    ok: false,
    releaseReady: false,
    productionReady: false,
    command: "release-gate",
    checks,
    blockers: releaseBlockers(failed, skipped),
    summary: {
      total: checks.length,
      passed: checks.filter((check) => check.status === "pass").length,
      skipped: skipped.length,
      failed: failed.length
    }
  }, null, 2));
  process.exitCode = 1;
});
