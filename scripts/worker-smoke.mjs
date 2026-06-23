#!/usr/bin/env node

import crypto from "node:crypto";
import postgres from "postgres";

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_LECTURE_TOKEN = "gleitlagerung-demo";

const HELP_TEXT = `
Usage: npm run smoke:worker -- [options]

Checks protected worker access, archive job processing and stored artifact retrieval.

Options:
  --url <app-url>                   Public app URL. Required unless LEARNBUDDY_WORKER_APP_URL is set.
  --lecture-token <token>           Lecture token. Defaults to gleitlagerung-demo.
  --verify-job-id <id>              Verify an existing archive job instead of creating one.
  --limit <n>                       Worker processing limit. Defaults to 5, max 25.
  --timeout-ms <ms>                 Worker timeout. Defaults to 120000.

Example:
  npm run smoke:worker -- --url https://<preview-url> --lecture-token gleitlagerung-demo
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

function secretValues() {
  return Object.entries(process.env)
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
    .replace(/token=[A-Za-z0-9._~+/=-]+/g, "token=[secret]");
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

function fail(id, message, details) {
  record(id, "fail", message, details);
}

function warn(id, message, details) {
  record(id, "warn", message, details);
}

function configuredTimeoutMs() {
  const value = Number(args.get("timeout-ms") || envValue("LEARNBUDDY_WORKER_SMOKE_TIMEOUT_MS"));
  return Number.isFinite(value) && value > 0 ? Math.min(300_000, Math.round(value)) : DEFAULT_TIMEOUT_MS;
}

function configuredLimit() {
  const value = Number(args.get("limit") || envValue("LEARNBUDDY_WORKER_SMOKE_LIMIT"));
  return Number.isFinite(value) && value > 0 ? Math.min(25, Math.round(value)) : 5;
}

function normalizeBaseUrl(value) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("--url or LEARNBUDDY_WORKER_APP_URL is required.");
  const parsed = new URL(trimmed);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Worker smoke URL must be HTTP(S).");
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

function isLocalOrPrivateHost(hostname) {
  const lower = normalizeHostname(hostname);
  if (lower === "localhost" || lower.endsWith(".localhost") || lower.endsWith(".local")) return true;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(lower)) return isPrivateIpv4(lower);
  if (lower.includes(":")) return isPrivateIpv6(lower);
  return false;
}

function workerTargetProblem(baseUrl) {
  const parsed = new URL(baseUrl);
  if (parsed.protocol === "https:" || isLocalOrPrivateHost(parsed.hostname)) return null;
  return {
    message: "Public worker smoke requires a HTTPS app URL.",
    details: {
      origin: parsed.origin,
      protocol: parsed.protocol
    }
  };
}

function requiredValue(name, fallback = "") {
  const value = fallback || envValue(name);
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function appUrl(baseUrl, path) {
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function readJson(response) {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function checkUnauthorizedWorker(baseUrl, timeoutMs) {
  const response = await fetchWithTimeout(appUrl(baseUrl, "/api/jobs/worker?limit=1"), {
    method: "POST"
  }, timeoutMs);
  if (response.status === 401) {
    pass("worker_auth_guard", "Worker endpoint rejects unauthenticated requests.", { status: response.status });
    return;
  }
  fail("worker_auth_guard", "Worker endpoint did not reject an unauthenticated request.", { status: response.status });
}

async function createArchiveJob(sql, lectureToken) {
  const [lecture] = await sql`
    select id, title, public_token
    from lectures
    where public_token = ${lectureToken}
    limit 1
  `;

  if (!lecture) {
    throw new Error(`Lecture token not found: ${lectureToken}`);
  }

  const requestedBy = `worker-smoke:${new Date().toISOString()}:${crypto.randomUUID()}`;
  const [job] = await sql`
    insert into standalone_export_jobs (lecture_id, status, format, requested_by, max_attempts)
    values (${lecture.id}, 'queued', 'archive_zip', ${requestedBy}, 1)
    returning id, lecture_id, status, requested_by, created_at
  `;

  pass("database_enqueue", "Standalone archive job was queued in Postgres.", {
    lectureTitle: lecture.title,
    lectureToken: lecture.public_token,
    jobId: job.id,
    requestedBy
  });

  return job;
}

async function fetchJob(sql, id) {
  const [job] = await sql`
    select
      id,
      status,
      standalone_export_id,
      storage_url,
      sha256,
      message,
      attempt_count,
      provider,
      provider_job_id,
      started_at,
      completed_at,
      duration_ms
    from standalone_export_jobs
    where id = ${id}
    limit 1
  `;
  return job ?? null;
}

async function triggerWorker(baseUrl, secret, limit, timeoutMs) {
  const response = await fetchWithTimeout(appUrl(baseUrl, `/api/jobs/worker?limit=${limit}`), {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`
    }
  }, timeoutMs);
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(`Worker request failed with HTTP ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function waitForJobCompletion(sql, baseUrl, secret, jobId, limit, timeoutMs) {
  const startedAt = Date.now();
  let lastStatus = "queued";
  let triggerCount = 0;

  while (Date.now() - startedAt < timeoutMs) {
    triggerCount += 1;
    await triggerWorker(baseUrl, secret, limit, Math.min(30_000, timeoutMs));
    const job = await fetchJob(sql, jobId);
    if (!job) throw new Error(`Job disappeared: ${jobId}`);
    lastStatus = job.status;

    if (job.status === "succeeded") {
      pass("worker_archive_job", "Worker completed the standalone archive job.", {
        jobId,
        triggerCount,
        provider: job.provider,
        providerJobId: job.provider_job_id,
        exportId: job.standalone_export_id,
        durationMs: job.duration_ms,
        attemptCount: job.attempt_count
      });
      return job;
    }

    if (job.status === "failed" || job.status === "dead_letter") {
      throw new Error(`Job ended with ${job.status}: ${job.message ?? "no message"}`);
    }

    await sleep(1500);
  }

  throw new Error(`Timed out waiting for job ${jobId}; last status was ${lastStatus}.`);
}

function artifactUrl(baseUrl, storageUrl) {
  if (!storageUrl) throw new Error("Worker job did not produce a storage_url.");
  if (/^https?:\/\//i.test(storageUrl)) {
    throw new Error("Worker job storage_url must use an app-internal artifact route, not an absolute URL.");
  }
  if (!storageUrl.startsWith("/api/storage-artifacts/") && !storageUrl.startsWith("/api/local-artifacts/")) {
    throw new Error("Worker job storage_url must point to /api/storage-artifacts/ or /api/local-artifacts/.");
  }
  return appUrl(baseUrl, storageUrl);
}

async function verifyArtifact(baseUrl, job, timeoutMs) {
  if (!job.standalone_export_id) {
    throw new Error("Worker job did not attach a standalone_export_id.");
  }
  if (!/^[a-f0-9]{64}$/i.test(job.sha256 ?? "")) {
    throw new Error("Worker job did not produce a valid sha256 checksum.");
  }

  const url = artifactUrl(baseUrl, job.storage_url);
  const response = await fetchWithTimeout(url, { method: "GET" }, timeoutMs);
  const bytes = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") ?? "";
  const checksum = crypto.createHash("sha256").update(bytes).digest("hex");
  const isZip = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;

  if (!response.ok) {
    throw new Error(`Stored artifact could not be fetched: HTTP ${response.status}`);
  }
  if (!contentType.includes("application/zip")) {
    throw new Error(`Stored artifact has unexpected content-type: ${contentType || "missing"}`);
  }
  if (!isZip) {
    throw new Error("Stored artifact does not look like a ZIP archive.");
  }
  if (checksum !== job.sha256) {
    throw new Error("Stored artifact checksum does not match database checksum.");
  }

  pass("storage_artifact", "Stored standalone ZIP is readable through the artifact route.", {
    status: response.status,
    contentType,
    bytes: bytes.length,
    sha256: checksum,
    storageUrl: job.storage_url
  });
}

async function main() {
  let baseUrl = "";
  const lectureToken = args.get("lecture-token") || envValue("LEARNBUDDY_WORKER_SMOKE_LECTURE_TOKEN") || DEFAULT_LECTURE_TOKEN;
  let sql;

  try {
    baseUrl = normalizeBaseUrl(args.get("url") || envValue("LEARNBUDDY_WORKER_APP_URL") || envValue("NEXT_PUBLIC_APP_URL"));
    const targetProblem = workerTargetProblem(baseUrl);
    if (targetProblem) {
      fail("worker_target", targetProblem.message, targetProblem.details);
    } else {
      const verifyJobId = (args.get("verify-job-id") || envValue("LEARNBUDDY_WORKER_SMOKE_VERIFY_JOB_ID")).trim();
      const databaseUrl = requiredValue("DATABASE_URL");
      const workerSecret = verifyJobId ? "" : requiredValue("LEARNBUDDY_WORKER_SECRET");
      const timeoutMs = configuredTimeoutMs();
      const limit = configuredLimit();
      sql = postgres(databaseUrl, { max: 1, prepare: false });

      if (verifyJobId) {
        const job = await fetchJob(sql, verifyJobId);
        if (!job) throw new Error(`Job not found: ${verifyJobId}`);
        pass("database_existing_job", "Existing standalone archive job was loaded from Postgres.", {
          jobId: job.id,
          status: job.status,
          provider: job.provider
        });
        await verifyArtifact(baseUrl, job, Math.min(45_000, timeoutMs));
      } else {
        await checkUnauthorizedWorker(baseUrl, Math.min(10_000, timeoutMs));
        const job = await createArchiveJob(sql, lectureToken);
        const completedJob = await waitForJobCompletion(sql, baseUrl, workerSecret, job.id, limit, timeoutMs);
        await verifyArtifact(baseUrl, completedJob, Math.min(45_000, timeoutMs));
      }
    }
  } catch (error) {
    fail("worker_smoke", error);
  } finally {
    await sql?.end({ timeout: 5 });
  }

  const warned = checks.filter((check) => check.status === "warn");
  if (warned.length > 0) {
    warn("worker_smoke_warnings", "Worker smoke completed with warnings.", {
      count: warned.length
    });
  }
  const summary = {
    total: checks.length,
    passed: checks.filter((check) => check.status === "pass").length,
    warnings: checks.filter((check) => check.status === "warn").length,
    failed: checks.filter((check) => check.status === "fail").length
  };
  const blockers = checks
    .filter((check) => check.status === "fail")
    .map((check) => ({
      id: check.id,
      status: check.status,
      message: check.message,
      details: check.details
    }));

  console.log(JSON.stringify({
    ok: summary.failed === 0,
    command: "worker-smoke",
    url: baseUrl,
    lectureToken,
    checks,
    blockers,
    summary
  }, null, 2));

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

main();
