#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const DEFAULT_TIMEOUT_MS = 120_000;

const HELP_TEXT = `
Usage: npm run smoke:backup-restore -- [options]

Checks pg_dump/psql availability and optionally performs a backup/restore roundtrip into an empty restore database.

Options:
  --source-url <postgres-url>       Source database. Defaults to LEARNBUDDY_BACKUP_SOURCE_DATABASE_URL or DATABASE_URL.
  --restore-url <postgres-url>      Restore target database. Required unless --config-only is used.
  --out <path>                      SQL dump output path.
  --expect-public-token <token>     Lecture token expected after restore. Defaults to gleitlagerung-demo.
  --config-only                     Only check pg_dump and psql.
  --reset-restore-database          Drop and recreate the restore database before restore.
  --timeout-ms <ms>                 Command timeout. Defaults to 120000.

Example:
  npm run smoke:backup-restore -- --config-only
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

function envValue(name) {
  return (process.env[name] ?? "").trim();
}

function configuredTimeoutMs() {
  const value = Number(args.get("timeout-ms") || envValue("LEARNBUDDY_BACKUP_RESTORE_SMOKE_TIMEOUT_MS"));
  return Number.isFinite(value) && value > 0 ? Math.min(600_000, Math.round(value)) : DEFAULT_TIMEOUT_MS;
}

function sourceDatabaseUrl() {
  return args.get("source-url") || envValue("LEARNBUDDY_BACKUP_SOURCE_DATABASE_URL") || envValue("DATABASE_URL");
}

function restoreDatabaseUrl() {
  return args.get("restore-url") || envValue("LEARNBUDDY_RESTORE_DATABASE_URL") || envValue("RESTORE_DATABASE_URL");
}

function outputPath() {
  const configured = args.get("out") || envValue("LEARNBUDDY_BACKUP_RESTORE_SMOKE_OUT");
  if (configured) return path.resolve(configured);
  return path.resolve("output", "backup-restore-smoke", `learnbuddy-${Date.now()}.sql`);
}

function expectedPublicToken() {
  return args.get("expect-public-token") || envValue("LEARNBUDDY_BACKUP_RESTORE_EXPECT_TOKEN") || "gleitlagerung-demo";
}

function configOnly() {
  return args.has("config-only") || envValue("LEARNBUDDY_BACKUP_RESTORE_CONFIG_ONLY") === "1";
}

function resetRestoreDatabase() {
  return args.has("reset-restore-database") || envValue("LEARNBUDDY_BACKUP_RESTORE_RESET_DATABASE") === "1";
}

function commandBinary(envName, fallback) {
  return envValue(envName) || fallback;
}

function secretValues() {
  return Object.entries(process.env)
    .filter(([key, value]) => value && /(KEY|TOKEN|SECRET|PASSWORD|AUTH|DATABASE_URL|DATABASE)/i.test(key))
    .map(([, value]) => String(value))
    .filter((value) => value.length >= 8);
}

function sanitize(value) {
  let text = value instanceof Error ? value.message : String(value);
  for (const secret of secretValues()) {
    text = text.split(secret).join("[secret]");
  }
  return text
    .replace(/postgres:\/\/[^\s"']+/g, "postgres://[secret]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [secret]");
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

function run(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(command, commandArgs, {
      cwd: process.cwd(),
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${command} ${commandArgs.join(" ")} timed out after ${options.timeoutMs ?? configuredTimeoutMs()}ms`));
    }, options.timeoutMs ?? configuredTimeoutMs());
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

function databaseInfo(databaseUrl) {
  const parsed = new URL(databaseUrl);
  return {
    hostname: parsed.hostname,
    port: parsed.port || null,
    database: decodeURIComponent(parsed.pathname.replace(/^\//, ""))
  };
}

function maintenanceDatabaseUrl(databaseUrl) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = "/postgres";
  return parsed.toString();
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function restoreDatabaseCanBeReset(databaseUrl) {
  const info = databaseInfo(databaseUrl);
  const hostAllowed = ["localhost", "127.0.0.1", "::1"].includes(info.hostname);
  const nameAllowed = /(^|[_-])(backup[_-]?restore|restore|smoke)([_-]|$)/i.test(info.database);
  return hostAllowed && nameAllowed;
}

async function resetRestoreTarget(databaseUrl) {
  if (!restoreDatabaseCanBeReset(databaseUrl)) {
    fail("restore_reset", "Refusing to reset restore database because it is not a clearly local smoke target.", {
      target: databaseInfo(databaseUrl)
    });
    return false;
  }

  const info = databaseInfo(databaseUrl);
  const admin = postgres(maintenanceDatabaseUrl(databaseUrl), { max: 1, prepare: false });
  try {
    await admin`
      select pg_terminate_backend(pid)
      from pg_stat_activity
      where datname = ${info.database}
        and pid <> pg_backend_pid()
    `;
    await admin.unsafe(`drop database if exists ${quoteIdentifier(info.database)}`);
    await admin.unsafe(`create database ${quoteIdentifier(info.database)}`);
    pass("restore_reset", "Local restore smoke database was reset.", { target: info });
    return true;
  } catch (error) {
    fail("restore_reset", "Local restore smoke database reset failed.", { error: sanitize(error) });
    return false;
  } finally {
    await admin.end();
  }
}

async function tableCount(databaseUrl) {
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    const [row] = await sql`
      select count(*)::int as count
      from information_schema.tables
      where table_schema in ('public', 'drizzle')
        and table_type = 'BASE TABLE'
    `;
    return Number(row?.count ?? 0);
  } finally {
    await sql.end();
  }
}

async function expectTool(command, commandArgs, id, message) {
  const result = await run(command, commandArgs, { timeoutMs: 30_000 });
  if (result.code !== 0) {
    fail(id, `${message} failed.`, {
      exitCode: result.code,
      stderr: sanitize(result.stderr).slice(0, 800)
    });
    return false;
  }
  pass(id, message, { stdout: sanitize(result.stdout || result.stderr).trim().slice(0, 200) });
  return true;
}

async function runAdmin(commandArgs, databaseUrl, allowFailure = false) {
  const result = await run(process.execPath, ["scripts/admin.mjs", ...commandArgs], {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl
    },
    timeoutMs: configuredTimeoutMs()
  });
  if (result.code !== 0 && !allowFailure) {
    throw new Error(result.stderr || result.stdout || `admin ${commandArgs.join(" ")} failed with ${result.code}`);
  }
  if (result.code !== 0) return { ok: false, stderr: result.stderr, stdout: result.stdout };
  return JSON.parse(result.stdout);
}

function compareCounts(source, restored) {
  const keys = new Set([...Object.keys(source ?? {}), ...Object.keys(restored ?? {})]);
  const mismatches = [];
  for (const key of keys) {
    if (Number(source?.[key] ?? -1) !== Number(restored?.[key] ?? -2)) {
      mismatches.push({ key, source: source?.[key], restored: restored?.[key] });
    }
  }
  return mismatches;
}

async function main() {
  const sourceUrl = sourceDatabaseUrl();
  const targetUrl = restoreDatabaseUrl();

  await expectTool(commandBinary("PG_DUMP_BIN", "pg_dump"), ["--version"], "pg_dump", "pg_dump is available.");
  await expectTool(commandBinary("PSQL_BIN", "psql"), ["--version"], "psql", "psql is available.");

  if (configOnly()) {
    skip("backup_restore", "Backup/restore database roundtrip skipped by --config-only.");
    return;
  }

  if (!sourceUrl) {
    fail("source_database", "Source database URL is required. Set DATABASE_URL, LEARNBUDDY_BACKUP_SOURCE_DATABASE_URL or --source-url.");
    return;
  }
  if (!targetUrl) {
    fail("restore_database", "Restore database URL is required. Set RESTORE_DATABASE_URL, LEARNBUDDY_RESTORE_DATABASE_URL or --restore-url.");
    return;
  }

  pass("source_database", "Source database URL is configured.", { source: databaseInfo(sourceUrl) });
  pass("restore_database", "Restore database URL is configured.", { target: databaseInfo(targetUrl) });

  if (resetRestoreDatabase()) {
    const resetOk = await resetRestoreTarget(targetUrl);
    if (!resetOk) return;
  }

  let sourceStatus;
  try {
    sourceStatus = await runAdmin(["status"], sourceUrl);
    pass("source_status", "Source database status is readable.", {
      counts: sourceStatus.counts,
      lectures: sourceStatus.lectures?.map((lecture) => lecture.public_token).slice(0, 10)
    });
  } catch (error) {
    fail("source_status", "Source database status check failed.", { error: sanitize(error) });
    return;
  }

  const dumpPath = outputPath();
  await mkdir(path.dirname(dumpPath), { recursive: true });
  let backup;
  try {
    backup = await runAdmin(["backup-sql", "--out", dumpPath], sourceUrl);
    pass("backup_sql", "Source database backup was written.", {
      file: backup.file,
      bytes: backup.bytes,
      sha256: backup.sha256
    });
  } catch (error) {
    fail("backup_sql", "Source database backup failed.", { error: sanitize(error) });
    return;
  }

  try {
    const count = await tableCount(targetUrl);
    if (count > 0) {
      fail("restore_target_empty", "Restore target database is not empty.", { tableCount: count });
      return;
    }
    pass("restore_target_empty", "Restore target database is empty.", { tableCount: count });
  } catch (error) {
    fail("restore_target_empty", "Restore target empty check failed.", { error: sanitize(error) });
    return;
  }

  try {
    const restored = await runAdmin(["restore-sql", "--file", dumpPath], targetUrl);
    pass("restore_sql", "Backup was restored into target database.", {
      file: restored.file,
      bytes: restored.bytes,
      sha256: restored.sha256
    });
  } catch (error) {
    fail("restore_sql", "Backup restore failed.", { error: sanitize(error) });
    return;
  }

  let restoredStatus;
  try {
    restoredStatus = await runAdmin(["status"], targetUrl);
  } catch (error) {
    fail("restored_status", "Restored database status check failed.", { error: sanitize(error) });
    return;
  }

  const mismatches = compareCounts(sourceStatus.counts, restoredStatus.counts);
  const token = expectedPublicToken();
  const tokenExists = !token || restoredStatus.lectures?.some((lecture) => lecture.public_token === token);
  if (mismatches.length > 0 || !tokenExists) {
    fail("restored_status", "Restored database does not match the source status contract.", {
      mismatches,
      expectedPublicToken: token || null,
      restoredLectures: restoredStatus.lectures?.map((lecture) => lecture.public_token).slice(0, 10)
    });
  } else {
    pass("restored_status", "Restored database status matches source counts and expected lecture token.", {
      counts: restoredStatus.counts,
      expectedPublicToken: token || null
    });
  }

  const secondRestore = await runAdmin(["restore-sql", "--file", dumpPath], targetUrl, true);
  if (secondRestore.ok === false && /not empty/i.test(secondRestore.stderr || secondRestore.stdout || "")) {
    pass("nonempty_restore_guard", "Restore into a non-empty target is blocked without --allow-nonempty.");
  } else {
    fail("nonempty_restore_guard", "Restore into a non-empty target was not blocked as expected.", {
      stdout: sanitize(secondRestore.stdout ?? "").slice(0, 600),
      stderr: sanitize(secondRestore.stderr ?? "").slice(0, 600)
    });
  }
}

await main().catch((error) => {
  fail("backup_restore_smoke", "Backup/restore smoke failed unexpectedly.", { error: sanitize(error) });
});

const summary = {
  total: checks.length,
  passed: checks.filter((check) => check.status === "pass").length,
  skipped: checks.filter((check) => check.status === "skip").length,
  failed: checks.filter((check) => check.status === "fail").length
};
const ok = summary.failed === 0;

console.log(JSON.stringify({
  ok,
  command: "backup-restore-smoke",
  checks,
  blockers: smokeBlockers(),
  summary
}, null, 2));

process.exit(ok ? 0 : 1);
