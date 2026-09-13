#!/usr/bin/env node
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";

const args = new Map();
for (let index = 2; index < process.argv.length; index++) {
  const [key, inline] = process.argv[index].replace(/^--?/, "").split("=", 2);
  args.set(key, inline ?? (process.argv[index + 1]?.startsWith("--") || !process.argv[index + 1] ? "1" : process.argv[++index]));
}
if (args.has("help") || args.has("h")) {
  console.log(`Usage: npm run smoke:live-load -- [options]
Exercises real authenticated live rounds, pseudonymous enrollment and session scores.
--url URL --lecture-token TOKEN --own-test-lecture are required.
--session-file PATH: private JSON {cookie, csrfToken}; alternatively LEARNBUDDY_LIVE_LOAD_SMOKE_SESSION_FILE.
The cookie must authenticate the OWNER of this disposable test lecture. A running session is never taken over.
--allow-public-write is additionally required for public HTTPS targets.
--participants 30 --concurrency 2 --anchor-rounds 3 --timeout-ms 90000 --max-p95-ms 5000
--answers 4.0=B,3.0=A,2.0=B,1.0=A (verified by server receipts, never client scores).
No default target, session credentials in argv, arbitrary classroom writes, or practice answers masquerading as live.`);
  process.exit(0);
}
const checks = [];
let secrets = [];
const clean = (value) => secrets.reduce((text, secret) => secret ? text.split(secret).join("[secret]") : text, String(value));
const record = (id, status, message, details = {}) => checks.push({ id, status, message: clean(message), details });
const number = (key, fallback, min, max) => Math.max(min, Math.min(max, Number(args.get(key)) || fallback));
const deadline = Date.now() + number("timeout-ms", 90000, 5000, 300000);
const DEFAULT_PARTICIPANTS = 30;
const participantsCount = Math.floor(number("participants", DEFAULT_PARTICIPANTS, 1, 250));
const concurrency = Math.floor(number("concurrency", 2, 1, 2));
const anchorRounds = Math.floor(number("anchor-rounds", 3, 1, 20));
const maxP95 = number("max-p95-ms", 5000, 100, 60000);
let baseUrl = "", token = "", teacher, lecture, state, ownedSessionId;
const percentile = (values) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * .95) - 1)] ?? 0;
async function request(path, body, cookie = "", csrf = "") {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("Overall live-load deadline exceeded.");
  const started = performance.now();
  const response = await fetch(`${baseUrl}${path}`, { method: body ? "POST" : "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(Math.min(remaining, 10000)),
    headers: { ...(body ? { "content-type": "application/json", origin: baseUrl } : {}), ...(cookie ? { cookie } : {}), ...(csrf ? { "x-learnbuddy-csrf": csrf } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${path.split("?")[0]}: ${payload.error ?? "request failed"}`);
  return { payload, elapsed: Math.round(performance.now() - started) };
}
async function pool(items, worker) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => { while (cursor < items.length) await worker(items[cursor++]); }));
}
async function command(body) {
  state = (await request(`/api/lectures/${lecture.id}/live-session`, { ...body, revision: state.revision }, teacher.cookie, teacher.csrfToken)).payload;
}
async function fireAndAnswer(items, answer, latencies) {
  if (state.round) await command({ action: "close" });
  await command({ action: "fire", familyIndex: 0, durationSeconds: 180 });
  if (!state.round) throw new Error("Presenter command did not open a round.");
  await pool(items, async (participant) => {
    const result = await request(`/api/lecture/${token}/live`, { sessionId: state.sessionId, roundId: state.round.id, level: answer.level, selected: answer.key }, participant.cookie);
    if (!result.payload.receipt?.correct) throw new Error("Configured answer does not match the server's question family.");
    participant.points += result.payload.receipt.points;
    participant.answers++;
    latencies.push(result.elapsed);
  });
}
try {
  const url = new URL(args.get("url") || process.env.LEARNBUDDY_LIVE_LOAD_SMOKE_URL || "");
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/") throw new Error("A bare HTTP(S) app origin is required.");
  baseUrl = url.origin;
  token = args.get("lecture-token") || process.env.LEARNBUDDY_LIVE_LOAD_SMOKE_LECTURE_TOKEN || "";
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (!local && url.protocol !== "https:") record("live_load_target", "fail", "Public live load smoke requires a HTTPS app URL.");
  else if (!local && !args.has("allow-public-write")) record("live_load_target", "fail", "Public targets require --allow-public-write and an owned disposable test lecture.");
  else if (!token || !args.has("own-test-lecture")) record("live_load_target", "fail", "Explicit --lecture-token and --own-test-lecture required; no existing classroom is changed by default.");
  else record("live_load_target", "pass", "Explicit test target and write scope acknowledged.", { participants: participantsCount, concurrency });
  if (checks.some((check) => check.status === "fail")) throw new Error("Target safety gate rejected; no network writes made.");
  const sessionPath = args.get("session-file") || process.env.LEARNBUDDY_LIVE_LOAD_SMOKE_SESSION_FILE;
  if (!sessionPath) throw new Error("Private --session-file with authenticated owner cookie and CSRF token is required.");
  teacher = JSON.parse(await readFile(sessionPath, "utf8"));
  if (!teacher.cookie || !teacher.csrfToken || /[\r\n]/.test(teacher.cookie)) throw new Error("Invalid owner session file.");
  secrets = [teacher.cookie, teacher.csrfToken, ...Object.entries(process.env).filter(([key]) => /TOKEN|SECRET|PASSWORD|COOKIE/.test(key)).map(([, value]) => value)];
  const owned = (await request("/api/lectures", undefined, teacher.cookie)).payload.lectures;
  lecture = owned?.find((item) => item.publicToken === token);
  if (!lecture) throw new Error("The authenticated lecturer does not own the target lecture.");
  state = (await request(`/api/lecture/${token}/live`)).payload;
  if (state.status === "active") throw new Error("Target already has an active live session. Refusing to take over a classroom.");
  const health = await request("/api/health");
  if (!health.payload.ok) throw new Error("Health check failed.");
  record("health", "pass", "Health endpoint is ready.");
  const response = await fetch(`${baseUrl}/l/${token}`, { signal: AbortSignal.timeout(Math.min(10000, Math.max(1, deadline - Date.now()))) });
  await response.arrayBuffer();
  if (!response.ok) throw new Error("Student page unavailable.");
  record("student_live_page", "pass", "Student page reachable (HTTP evidence, not a browser proof).");
  await command({ action: "start" }); ownedSessionId = state.sessionId;
  await command({ action: "slide", slideIndex: 0, showIntro: false });
  const batch = crypto.randomUUID().slice(0, 8);
  const participants = Array.from({ length: participantsCount }, (_, index) => ({ key: `load-${batch}-${index}`, name: `Load ${batch} ${index}`, cookie: "", points: 0, answers: 0 }));
  const seriesId = lecture.seriesId || lecture.seriesTitle.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 46) || "vorlesung";
  await pool(participants, async (participant) => {
    await request("/api/student/profile", { anonymousKey: participant.key, pseudonym: participant.name });
    participant.cookie = `lb_student_key=${participant.key}`;
    await request("/api/student/enrollments", { seriesId, seriesTitle: lecture.seriesTitle, lectureId: lecture.id, displayName: participant.name, source: "direct_live_link" }, participant.cookie);
  });
  record("student_join_load", "pass", "All participants have genuine cookie-bound series enrollments.", { participants: participantsCount, concurrency });
  const answers = (args.get("answers") || "4.0=B,3.0=A,2.0=B,1.0=A").split(",").map((part) => { const [level, key] = part.split("="); if (!["4.0", "3.0", "2.0", "1.0"].includes(level) || !/^[ABCD]$/.test(key)) throw new Error("Invalid answers map."); return { level, key }; });
  const [anchor, ...rest] = participants;
  const latencies = [];
  for (const answer of answers) await fireAndAnswer(rest, answer, latencies);
  record("answer_load", "pass", "Concurrent students answered distinct server-issued rounds exactly once each.", { participants: rest.length, totalAnswers: rest.length * answers.length, concurrency });
  record("answer_latency", percentile(latencies) <= maxP95 ? "pass" : "fail", "Answer p95 latency budget.", { p95Ms: percentile(latencies), maxP95Ms: maxP95 });
  for (let round = 0; round < anchorRounds; round++) for (const answer of answers) await fireAndAnswer([anchor], answer, []);
  record("leaderboard_anchor_load", "pass", "Anchor scores come from separate authorized rounds, not replayed answers.", { totalRounds: anchorRounds, answers: anchor.answers });
  const board = (await request(`/api/lecture/${token}/live?leaderboard=1`, undefined, anchor.cookie)).payload.leaderboard;
  const self = board?.find((entry) => entry.self);
  if (!self || self.rank !== 1 || self.points !== anchor.points || self.answers !== anchor.answers || self.correct !== anchor.answers) throw new Error("Session scoreboard did not exactly match valid answers.");
  record("leaderboard_consistency", "pass", "Session scoreboard exactly matches the authenticated participant's valid receipts.", { self });
} catch (error) {
  if (!checks.some((check) => check.status === "fail")) record("live_load_smoke", "fail", error.message);
} finally {
  if (ownedSessionId) {
    try {
      const current = (await request(`/api/lecture/${token}/live`)).payload;
      if (current.sessionId === ownedSessionId && current.revision === state.revision) await command({ action: "end" });
      else record("cleanup", "fail", "Session changed externally; did not end another controller's state.");
    } catch { record("cleanup", "fail", "Owned test session could not be ended; inspect this test lecture manually."); }
  }
}
const blockers = checks.filter((check) => check.status === "fail");
console.log(JSON.stringify({ ok: blockers.length === 0, command: "live-load-smoke", url: baseUrl, lectureToken: token, checks, blockers, summary: { total: checks.length, passed: checks.length - blockers.length, failed: blockers.length } }, null, 2));
if (blockers.length) process.exitCode = 1;
