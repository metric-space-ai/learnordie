#!/usr/bin/env node

import crypto from "node:crypto";

const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_LECTURE_TOKEN = "gleitlagerung-demo";
const DEFAULT_PARTICIPANTS = 30;
const DEFAULT_CONCURRENCY = 10;
const DEFAULT_ANCHOR_ROUNDS = 3;
const DEFAULT_MAX_P95_MS = 5_000;
const DEFAULT_ANSWERS = "4.0=B,3.0=A,2.0=B,1.0=A";

const HELP_TEXT = `
Usage: npm run smoke:live-load -- [options]

Simulates pseudonymous Student Live participation and verifies events, answers, latency and leaderboard consistency.

Options:
  --url <app-url>                   Public app URL. Required unless LEARNBUDDY_LIVE_LOAD_SMOKE_URL is set.
  --lecture-token <token>           Lecture token. Defaults to gleitlagerung-demo.
  --participants <n>                Number of pseudonymous participants. Defaults to 30.
  --concurrency <n>                 Concurrent requests. Defaults to 10.
  --anchor-rounds <n>               Repeated answer rounds for anchor participants. Defaults to 3.
  --max-p95-ms <ms>                 Maximum accepted p95 latency. Defaults to 5000.
  --answers <map>                   Correct answers per level, for example 4.0=B,3.0=A.
  --timeout-ms <ms>                 Overall timeout. Defaults to 90000.

Example:
  npm run smoke:live-load -- --url https://<preview-url> --lecture-token gleitlagerung-demo --participants 30
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
    .replace(/token=[A-Za-z0-9._~+/=-]+/g, "token=[secret]")
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

function numericArg(name, envName, fallback, min, max) {
  const raw = args.get(name) || envValue(envName);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function configuredTimeoutMs() {
  return numericArg("timeout-ms", "LEARNBUDDY_LIVE_LOAD_SMOKE_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, 5_000, 300_000);
}

function configuredParticipants() {
  return numericArg("participants", "LEARNBUDDY_LIVE_LOAD_SMOKE_PARTICIPANTS", DEFAULT_PARTICIPANTS, 1, 250);
}

function configuredConcurrency() {
  return numericArg("concurrency", "LEARNBUDDY_LIVE_LOAD_SMOKE_CONCURRENCY", DEFAULT_CONCURRENCY, 1, 50);
}

function configuredAnchorRounds() {
  return numericArg("anchor-rounds", "LEARNBUDDY_LIVE_LOAD_SMOKE_ANCHOR_ROUNDS", DEFAULT_ANCHOR_ROUNDS, 1, 20);
}

function configuredMaxP95Ms() {
  return numericArg("max-p95-ms", "LEARNBUDDY_LIVE_LOAD_SMOKE_MAX_P95_MS", DEFAULT_MAX_P95_MS, 100, 60_000);
}

function normalizeBaseUrl(value) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("--url or LEARNBUDDY_LIVE_LOAD_SMOKE_URL is required.");
  const parsed = new URL(trimmed);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Live load smoke URL must be HTTP(S).");
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

function targetProblem(baseUrl) {
  const parsed = new URL(baseUrl);
  if (parsed.protocol === "https:" || isLocalOrPrivateHost(parsed.hostname)) return null;
  return {
    message: "Public live load smoke requires a HTTPS app URL.",
    details: {
      origin: parsed.origin,
      protocol: parsed.protocol
    }
  };
}

function appUrl(baseUrl, path) {
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

function parseAnswers(raw) {
  const pairs = String(raw || DEFAULT_ANSWERS).split(",").map((item) => item.trim()).filter(Boolean);
  const answers = pairs.flatMap((pair) => {
    const [level, answerKey] = pair.split("=", 2).map((part) => part?.trim());
    if (!["4.0", "3.0", "2.0", "1.0"].includes(level) || !["A", "B", "C", "D"].includes((answerKey ?? "").toUpperCase())) {
      return [];
    }
    return [{ level, answerKey: answerKey.toUpperCase() }];
  });
  if (answers.length === 0) throw new Error("--answers must contain entries like 4.0=B,3.0=A,2.0=B,1.0=A.");
  return answers;
}

function expectedPointsForAnswers(answers) {
  const points = {
    "4.0": 1,
    "3.0": 2,
    "2.0": 3,
    "1.0": 4
  };
  return answers.reduce((sum, answer) => sum + (points[answer.level] ?? 0), 0);
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal
    });
    const elapsedMs = Math.round(performance.now() - started);
    return { response, elapsedMs };
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
    return { raw: text.slice(0, 500) };
  }
}

async function getJson(url, timeoutMs) {
  const { response, elapsedMs } = await fetchWithTimeout(url, {}, timeoutMs);
  const payload = await readJson(response);
  return { response, payload, elapsedMs };
}

async function postJson(url, body, timeoutMs) {
  const { response, elapsedMs } = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  }, timeoutMs);
  const payload = await readJson(response);
  return { response, payload, elapsedMs };
}

function percentile(values, percent) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil((percent / 100) * sorted.length) - 1);
  return sorted[index];
}

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

function participantBatch(count, lectureToken) {
  const batch = `load-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  return Array.from({ length: count }, (_, index) => ({
    batch,
    index: index + 1,
    anonymousKey: `${batch}-${String(index + 1).padStart(3, "0")}`,
    pseudonym: `LB Load ${String(index + 1).padStart(2, "0")}`
  })).map((participant) => ({
    ...participant,
    pseudonym: `${participant.pseudonym} ${participant.batch.slice(-4)}`,
    lectureToken
  }));
}

async function checkHealth(baseUrl, timeoutMs) {
  const { response, payload, elapsedMs } = await getJson(appUrl(baseUrl, "/api/health"), timeoutMs);
  if (response.ok && payload?.ok === true) {
    pass("health", "Health endpoint is reachable before live load.", { status: response.status, elapsedMs });
    return;
  }
  fail("health", "Health endpoint did not return ok=true before live load.", {
    status: response.status,
    elapsedMs,
    payload
  });
}

async function checkStudentPage(baseUrl, lectureToken, timeoutMs) {
  const { response, elapsedMs } = await fetchWithTimeout(appUrl(baseUrl, `/l/${encodeURIComponent(lectureToken)}`), {}, timeoutMs);
  if (response.ok) {
    pass("student_live_page", "Student live page is reachable.", { status: response.status, elapsedMs });
    await response.arrayBuffer();
    return;
  }
  fail("student_live_page", "Student live page is not reachable.", { status: response.status, elapsedMs });
}

async function joinParticipant(baseUrl, participant, timeoutMs) {
  return postJson(appUrl(baseUrl, "/api/events"), {
    lectureToken: participant.lectureToken,
    eventType: "student_joined",
    anonymousKey: participant.anonymousKey,
    pseudonym: participant.pseudonym,
    payload: {
      mode: "live"
    }
  }, timeoutMs);
}

async function answerParticipant(baseUrl, participant, answers, timeoutMs) {
  const latencies = [];
  for (const answer of answers) {
    const result = await postJson(appUrl(baseUrl, "/api/events"), {
      lectureToken: participant.lectureToken,
      eventType: "answer_selected",
      anonymousKey: participant.anonymousKey,
      pseudonym: participant.pseudonym,
      payload: {
        mode: "live",
        level: answer.level,
        selectedAnswerKey: answer.answerKey
      }
    }, timeoutMs);
    latencies.push(result.elapsedMs);
    if (!result.response.ok || result.payload?.ok !== true) {
      return {
        ok: false,
        failedAnswer: answer,
        status: result.response.status,
        payload: result.payload,
        latencies
      };
    }
  }
  return { ok: true, latencies };
}

async function checkParticipants(baseUrl, participants, answers, timeoutMs, concurrency, maxP95Ms, anchorRounds) {
  const [anchor, ...loadParticipants] = participants;
  const anchorJoinResult = await joinParticipant(baseUrl, anchor, timeoutMs);
  const joinedRest = await runPool(loadParticipants, concurrency, async (participant) => {
    const result = await joinParticipant(baseUrl, participant, timeoutMs);
    return {
      participant,
      ok: result.response.ok && result.payload?.ok === true,
      status: result.response.status,
      payload: result.payload,
      elapsedMs: result.elapsedMs
    };
  });
  const joined = [
    {
      participant: anchor,
      ok: anchorJoinResult.response.ok && anchorJoinResult.payload?.ok === true,
      status: anchorJoinResult.response.status,
      payload: anchorJoinResult.payload,
      elapsedMs: anchorJoinResult.elapsedMs
    },
    ...joinedRest
  ];

  const failedJoins = joined.filter((item) => !item.ok);
  if (failedJoins.length === 0) {
    pass("student_join_load", "All pseudonymous participants joined through public events.", {
      participants: participants.length,
      concurrency,
      p95Ms: percentile(joined.map((item) => item.elapsedMs), 95)
    });
  } else {
    fail("student_join_load", "Some pseudonymous participants could not join.", {
      participants: participants.length,
      failed: failedJoins.slice(0, 5).map((item) => ({
        pseudonym: item.participant.pseudonym,
        status: item.status,
        payload: item.payload
      }))
    });
  }

  const answered = await runPool(loadParticipants, concurrency, async (participant) => {
    const result = await answerParticipant(baseUrl, participant, answers, timeoutMs);
    return {
      participant,
      ...result
    };
  });
  const answerLatencies = answered.flatMap((item) => item.latencies ?? []);
  const failedAnswers = answered.filter((item) => !item.ok);
  const p95Ms = percentile(answerLatencies, 95);
  if (failedAnswers.length === 0) {
    pass("answer_load", "Concurrent participants submitted the configured live answers.", {
      participants: loadParticipants.length,
      answersPerParticipant: answers.length,
      totalAnswers: loadParticipants.length * answers.length,
      concurrency,
      p95Ms
    });
  } else {
    fail("answer_load", "Some participants could not submit answers.", {
      participants: participants.length,
      failed: failedAnswers.slice(0, 5).map((item) => ({
        pseudonym: item.participant.pseudonym,
        failedAnswer: item.failedAnswer,
        status: item.status,
        payload: item.payload
      }))
    });
  }

  if (failedJoins.length === 0 && failedAnswers.length === 0) {
    if (p95Ms <= maxP95Ms) {
      pass("answer_latency", "Answer write latency stayed within the configured p95 budget.", {
        p95Ms,
        maxP95Ms
      });
    } else {
      fail("answer_latency", "Answer write latency exceeded the configured p95 budget.", {
        p95Ms,
        maxP95Ms
      });
    }
  }

  if (failedJoins.length === 0 && failedAnswers.length === 0) {
    const anchorLatencies = [];
    const failures = [];
    for (let round = 0; round < anchorRounds; round += 1) {
      const result = await answerParticipant(baseUrl, anchor, answers, timeoutMs);
      anchorLatencies.push(...(result.latencies ?? []));
      if (!result.ok) failures.push(result);
    }

    if (failures.length === 0) {
      pass("leaderboard_anchor_load", "Anchor participant received deterministic sequential answers for top-10 leaderboard verification.", {
        pseudonym: anchor.pseudonym,
        totalRounds: anchorRounds,
        answers: anchorRounds * answers.length,
        p95Ms: percentile(anchorLatencies, 95)
      });
    } else {
      fail("leaderboard_anchor_load", "Anchor participant could not receive extra leaderboard answers.", {
        failed: failures.slice(0, 3).map((item) => ({
          failedAnswer: item.failedAnswer,
          status: item.status,
          payload: item.payload
        }))
      });
    }
  }
}

async function checkLeaderboard(baseUrl, lectureToken, participant, expectedPoints, expectedAnswers, timeoutMs) {
  const { response, payload, elapsedMs } = await getJson(
    appUrl(baseUrl, `/api/lecture/${encodeURIComponent(lectureToken)}/leaderboard?anonymousKey=${encodeURIComponent(participant.anonymousKey)}`),
    timeoutMs
  );
  const entries = Array.isArray(payload?.entries) ? payload.entries : [];
  const self = entries.find((entry) => entry?.self === true);
  if (response.ok && payload?.enabled === true && self && self.points >= expectedPoints && self.answers >= expectedAnswers) {
    pass("leaderboard_consistency", "Leaderboard contains the current load-smoke participant with expected score.", {
      elapsedMs,
      entries: entries.length,
      self: {
        rank: self.rank,
        points: self.points,
        correct: self.correct,
        answers: self.answers
      },
      expected: {
        points: expectedPoints,
        answers: expectedAnswers
      }
    });
    return;
  }

  fail("leaderboard_consistency", "Leaderboard did not reflect the current load-smoke participant.", {
    status: response.status,
    elapsedMs,
    enabled: payload?.enabled,
    entries: entries.slice(0, 5),
    expected: {
      points: expectedPoints,
      answers: expectedAnswers
    }
  });
}

async function main() {
  let baseUrl = "";
  let lectureToken = "";
  let participants = [];
  let answers = [];
  const timeoutMs = configuredTimeoutMs();
  const participantCount = configuredParticipants();
  const concurrency = configuredConcurrency();
  const anchorRounds = configuredAnchorRounds();
  const maxP95Ms = configuredMaxP95Ms();

  try {
    baseUrl = normalizeBaseUrl(args.get("url") || envValue("LEARNBUDDY_LIVE_LOAD_SMOKE_URL"));
    lectureToken = args.get("lecture-token") || envValue("LEARNBUDDY_LIVE_LOAD_SMOKE_LECTURE_TOKEN") || DEFAULT_LECTURE_TOKEN;
    answers = parseAnswers(args.get("answers") || envValue("LEARNBUDDY_LIVE_LOAD_SMOKE_ANSWERS") || DEFAULT_ANSWERS);
    participants = participantBatch(participantCount, lectureToken);
    const problem = targetProblem(baseUrl);
    if (problem) fail("live_load_target", problem.message, problem.details);
    else pass("live_load_target", "Live load target is valid for this smoke.", {
      origin: new URL(baseUrl).origin,
      participants: participantCount,
      concurrency,
      anchorRounds
    });
  } catch (error) {
    fail("configuration", error);
  }

  if (baseUrl && lectureToken && participants.length > 0 && answers.length > 0 && !checks.some((check) => check.status === "fail")) {
    await checkHealth(baseUrl, timeoutMs);
    await checkStudentPage(baseUrl, lectureToken, timeoutMs);
    if (!checks.some((check) => check.status === "fail")) {
      await checkParticipants(baseUrl, participants, answers, timeoutMs, concurrency, maxP95Ms, anchorRounds);
      const expectedPoints = expectedPointsForAnswers(answers) * anchorRounds;
      await checkLeaderboard(baseUrl, lectureToken, participants[0], expectedPoints, answers.length * anchorRounds, timeoutMs);
    }
  }

  const failed = checks.filter((check) => check.status === "fail");
  const warnings = checks.filter((check) => check.status === "warn");
  console.log(JSON.stringify({
    ok: failed.length === 0,
    command: "live-load-smoke",
    url: baseUrl || null,
    lectureToken: lectureToken || null,
    checks,
    blockers: smokeBlockers(),
    summary: {
      total: checks.length,
      passed: checks.filter((check) => check.status === "pass").length,
      warnings: warnings.length,
      failed: failed.length
    }
  }, null, 2));

  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  fail("live_load_smoke", error);
  console.log(JSON.stringify({
    ok: false,
    command: "live-load-smoke",
    checks,
    blockers: smokeBlockers(),
    summary: {
      total: checks.length,
      passed: checks.filter((check) => check.status === "pass").length,
      warnings: checks.filter((check) => check.status === "warn").length,
      failed: checks.filter((check) => check.status === "fail").length
    }
  }, null, 2));
  process.exitCode = 1;
});
