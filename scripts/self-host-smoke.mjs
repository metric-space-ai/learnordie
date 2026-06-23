#!/usr/bin/env node

import { spawn } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_CONFIG_TIMEOUT_MS = 60_000;
const DEFAULT_HEALTH_URL = "http://127.0.0.1:3000/api/health";

const HELP_TEXT = `
Usage: npm run smoke:self-host -- [options]

Checks the Docker Compose self-host path and optionally starts the stack until /api/health is ready.

Options:
  --compose-file <path>             Compose file. Defaults to compose.yaml.
  --project-name <name>             Docker Compose project name.
  --health-url <url>                Health URL to poll after start.
  --config-only                     Only validate Docker/Compose/config, do not start containers.
  --no-start                        Alias for config-only.
  --keep                            Keep containers after the smoke.
  --config-timeout-ms <ms>          Timeout for config checks. Defaults to 60000.
  --timeout-ms <ms>                 Overall timeout. Defaults to 300000.

Example:
  npm run smoke:self-host -- --config-only
`;

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

function secretValues() {
  return Object.entries(process.env)
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

function smokeBlockers() {
  return checks
    .filter((check) => check.status === "fail")
    .map((check) => ({
      id: check.id,
      status: check.status,
      message: check.message,
      details: check.details
    }));
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
  const value = Number(args.get("timeout-ms") || process.env.LEARNBUDDY_SELF_HOST_SMOKE_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? Math.min(900_000, Math.round(value)) : DEFAULT_TIMEOUT_MS;
}

function configuredConfigTimeoutMs() {
  const value = Number(args.get("config-timeout-ms") || process.env.LEARNBUDDY_SELF_HOST_CONFIG_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? Math.min(180_000, Math.round(value)) : DEFAULT_CONFIG_TIMEOUT_MS;
}

function composeFile() {
  return args.get("compose-file") || process.env.LEARNBUDDY_SELF_HOST_COMPOSE_FILE || "compose.yaml";
}

function projectName() {
  return args.get("project-name") || process.env.LEARNBUDDY_SELF_HOST_PROJECT_NAME || "learnbuddy-self-host-smoke";
}

function healthUrl() {
  return args.get("health-url") || process.env.LEARNBUDDY_SELF_HOST_HEALTH_URL || DEFAULT_HEALTH_URL;
}

function noStart() {
  return args.has("no-start") || args.has("config-only") || process.env.LEARNBUDDY_SELF_HOST_CONFIG_ONLY === "1";
}

function keepContainers() {
  return args.has("keep") || process.env.LEARNBUDDY_SELF_HOST_KEEP === "1";
}

function run(command, commandArgs, timeoutMs) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(command, commandArgs, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${command} ${commandArgs.join(" ")} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function dockerComposeArgs(...commandArgs) {
  return ["compose", "-p", projectName(), "-f", composeFile(), ...commandArgs];
}

async function expectCommand(command, commandArgs, id, message, timeoutMs) {
  const result = await run(command, commandArgs, timeoutMs);
  if (result.code !== 0) {
    fail(id, `${message} failed.`, {
      exitCode: result.code,
      stderr: sanitize(result.stderr).slice(0, 800)
    });
    return false;
  }
  pass(id, message);
  return true;
}

async function waitForHealth(url, timeoutMs) {
  const started = Date.now();
  let lastError = "";
  while (Date.now() - started < timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(url, {
        cache: "no-store",
        signal: controller.signal
      });
      clearTimeout(timer);
      if (response.ok) {
        const payload = await response.json().catch(() => ({}));
        pass("container_health", "Self-host container health endpoint returned ok.", {
          url,
          status: response.status,
          payload
        });
        return true;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      clearTimeout(timer);
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  fail("container_health", "Self-host container health endpoint did not become ready.", {
    url,
    timeoutMs,
    lastError: sanitize(lastError)
  });
  return false;
}

async function cleanup() {
  if (keepContainers() || noStart()) return;
  const result = await run("docker", dockerComposeArgs("down", "--volumes", "--remove-orphans"), configuredConfigTimeoutMs());
  if (result.code === 0) {
    pass("compose_cleanup", "Docker Compose smoke stack was removed.");
    return;
  }
  fail("compose_cleanup", "Docker Compose smoke stack cleanup failed.", {
    exitCode: result.code,
    stderr: sanitize(result.stderr).slice(0, 800)
  });
}

async function main() {
  const dockerOk = await expectCommand("docker", ["--version"], "docker_cli", "Docker CLI is available.", configuredConfigTimeoutMs())
    .catch((error) => {
      fail("docker_cli", "Docker CLI is not available.", { error: sanitize(error) });
      return false;
    });
  if (!dockerOk) return;

  const composeOk = await expectCommand("docker", ["compose", "version"], "docker_compose", "Docker Compose plugin is available.", configuredConfigTimeoutMs());
  if (!composeOk) return;

  const configOk = await expectCommand("docker", dockerComposeArgs("config"), "compose_config", "Docker Compose configuration is valid.", configuredConfigTimeoutMs());
  if (!configOk) return;

  if (noStart()) {
    skip("container_start", "Container start skipped by --no-start/--config-only.");
    return;
  }

  const up = await run("docker", dockerComposeArgs("up", "--build", "-d"), configuredTimeoutMs());
  if (up.code !== 0) {
    fail("container_start", "Docker Compose self-host stack did not start.", {
      exitCode: up.code,
      stderr: sanitize(up.stderr).slice(0, 1200)
    });
    return;
  }
  pass("container_start", "Docker Compose self-host stack started.", {
    project: projectName()
  });

  await waitForHealth(healthUrl(), configuredTimeoutMs());
}

try {
  await main();
} catch (error) {
  fail("self_host_smoke", error);
} finally {
  try {
    await cleanup();
  } catch (error) {
    fail("compose_cleanup", error);
  }
}

const failed = checks.filter((check) => check.status === "fail").length;
const result = {
  ok: failed === 0,
  command: "self-host-smoke",
  composeFile: composeFile(),
  projectName: projectName(),
  healthUrl: healthUrl(),
  checks,
  blockers: smokeBlockers(),
  summary: {
    total: checks.length,
    passed: checks.filter((check) => check.status === "pass").length,
    skipped: checks.filter((check) => check.status === "skip").length,
    failed
  }
};

console.log(JSON.stringify(result, null, 2));
process.exit(failed === 0 ? 0 : 1);
