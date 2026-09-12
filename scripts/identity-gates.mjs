#!/usr/bin/env node
// Contract gates T01–T07, T14–T16 against a running local server.
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

function seriesIdFromTitle(title) {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 46);
  return slug || "vorlesung";
}

const BASE = process.env.IDENTITY_GATES_BASE ?? "http://127.0.0.1:8080";
const SERIES = { seriesId: "maschinenelemente-i", seriesTitle: "Maschinenelemente I", source: "direct_learn_link" };
const QA_TITLE = "Technische Mechanik – kombinierte Belastungen und mehrstufige Berechnungsaufgaben";
const QA = {
  seriesId: seriesIdFromTitle(QA_TITLE),
  seriesTitle: QA_TITLE,
  source: "direct_learn_link"
};

async function json(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function createStudent(name) {
  const jar = [];
  const key = `student_${randomUUID()}`;
  const profileRes = await fetch(`${BASE}/api/student/profile`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ anonymousKey: key, pseudonym: name })
  });
  const setCookie = profileRes.headers.getSetCookie?.() ?? [];
  const cookie = setCookie.map((item) => item.split(";")[0]).join("; ");
  jar.push(cookie);
  const profile = await json(profileRes);
  return { key, cookie, profile: profile.profile, status: profileRes.status };
}

async function enroll(student, displayName, series = SERIES) {
  return fetch(`${BASE}/api/student/enrollments`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: student.cookie },
    body: JSON.stringify({ ...series, displayName })
  });
}

async function claim(student, displayName, seriesId = SERIES.seriesId) {
  return fetch(`${BASE}/api/student/claim`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: student.cookie },
    body: JSON.stringify({ seriesId, displayName })
  });
}

async function answer(key, name) {
  return fetch(`${BASE}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      lectureToken: "gleitlagerung-demo",
      eventType: "answer_selected",
      anonymousKey: key,
      pseudonym: name,
      payload: { mode: "learn", level: "4.0", selectedAnswerKey: "B" }
    })
  });
}

const failures = [];
function check(name, ok, detail) {
  if (ok) console.log(`ok ${name}`);
  else {
    failures.push(`${name}: ${detail}`);
    console.error(`not ok ${name} — ${detail}`);
  }
}

const stamp = Date.now().toString().slice(-6);
const sharedName = `Gate-${stamp}`;

const [a, b] = await Promise.all([createStudent("Alpha-Gate"), createStudent("Beta-Gate")]);
check("profiles created", a.status === 200 && b.status === 200, `${a.status}/${b.status}`);

const [first, second] = await Promise.all([enroll(a, sharedName), enroll(b, sharedName)]);
const firstBody = await json(first);
const secondBody = await json(second);
const statuses = [first.status, second.status].sort();
check("T01 one 200 and one 409", statuses[0] === 200 && statuses[1] === 409, `${first.status}/${second.status}`);
const taken = first.status === 409 ? firstBody : secondBody;
check("T01 suggestions", Array.isArray(taken.suggestions) && taken.suggestions.length === 3, JSON.stringify(taken));
check(
  "T01 suggestions exclude rejected",
  Array.isArray(taken.suggestions) && !taken.suggestions.some((name) => String(name).toLowerCase() === sharedName.toLowerCase()),
  JSON.stringify(taken.suggestions)
);

const winner = first.status === 200 ? a : b;
const loser = first.status === 409 ? a : b;
const winnerBody = first.status === 200 ? firstBody : secondBody;

const retry = await enroll(winner, sharedName);
const retryBody = await json(retry);
check("T02 retry same claim", retry.status === 200, `status ${retry.status}`);
check("T02 same enrollment id", retryBody.enrollment?.id === winnerBody.enrollment?.id, JSON.stringify(retryBody));
const loserName = `Frei-${stamp}`;
const loserEnroll = await enroll(loser, loserName);
check("loser can claim other name", loserEnroll.status === 200, `status ${loserEnroll.status}`);

const qa = await enroll(winner, `QA-${stamp}`, QA);
check("T05 second series claim", qa.status === 200, `status ${qa.status}`);

const eventBare = await answer(`student_${randomUUID()}`, "Nobody");
const eventBareBody = await json(eventBare);
check("T16 event without claim", eventBare.status === 409 && eventBareBody.code === "claim_required", `${eventBare.status} ${JSON.stringify(eventBareBody)}`);

const winnerAnswer = await answer(winner.key, sharedName);
check("winner can answer", winnerAnswer.status === 200, `status ${winnerAnswer.status}`);

const renameTaken = await claim(loser, sharedName);
const renameTakenBody = await json(renameTaken);
check("T16 rename to taken", renameTaken.status === 409 && renameTakenBody.code === "pseudonym_taken", `${renameTaken.status}`);
const still = await fetch(`${BASE}/api/student/claim?seriesId=${SERIES.seriesId}`, { headers: { cookie: loser.cookie } });
const stillBody = await json(still);
check("T16 previous name kept", stillBody.claim?.displayName === loserName, JSON.stringify(stillBody));

const beforeBoard = await fetch(`${BASE}/api/lecture/gleitlagerung-demo/leaderboard?anonymousKey=${encodeURIComponent(winner.key)}`);
const beforeEntries = (await json(beforeBoard)).entries ?? [];
const beforeSelf = beforeEntries.find((entry) => entry.self);
const beforePoints = beforeSelf?.points ?? 0;

const renamed = `Neu-${stamp}`;
const renameOk = await claim(winner, renamed);
check("T07 rename free name", renameOk.status === 200, `status ${renameOk.status}`);
const afterAnswer = await answer(winner.key, renamed);
check("T07 still can answer", afterAnswer.status === 200, `status ${afterAnswer.status}`);
const afterBoard = await fetch(`${BASE}/api/lecture/gleitlagerung-demo/leaderboard?anonymousKey=${encodeURIComponent(winner.key)}`);
const afterEntries = (await json(afterBoard)).entries ?? [];
const afterSelf = afterEntries.find((entry) => entry.self);
check("T07 label is current claim", afterSelf?.name === renamed || afterSelf?.name?.startsWith(renamed), JSON.stringify(afterSelf));
check("T07 points not reset", (afterSelf?.points ?? 0) >= beforePoints, `${beforePoints} -> ${afterSelf?.points}`);
check("T06 top 10 bound", afterEntries.length <= 11, String(afterEntries.length));
check("T06 Du visible via self", Boolean(afterSelf?.self), JSON.stringify(afterSelf));

const parA = `ParA-${stamp}`;
const parB = `ParB-${stamp}`;
const [parallel1, parallel2] = await Promise.all([claim(winner, parA), claim(winner, parB)]);
const parallelClaim = await json(
  await fetch(`${BASE}/api/student/claim?seriesId=${SERIES.seriesId}`, { headers: { cookie: winner.cookie } })
);
const parallelName = parallelClaim.claim?.displayName;
check("T15 at least one parallel claim writes", parallel1.status === 200 || parallel2.status === 200, `${parallel1.status}/${parallel2.status}`);
check(
  "T15 one active name",
  parallelName === parA || parallelName === parB || parallelName === renamed,
  JSON.stringify(parallelClaim)
);

const t04student = await createStudent("Limit-40");
const t04 = await enroll(t04student, "W".repeat(41));
check("T04 over 40 rejected", t04.status === 400, `status ${t04.status}`);

const t03student = await createStudent("Norm-Case");
const t03base = `Norm-${stamp}`;
const spaced = await enroll(t03student, `  ${t03base}  `);
const spacedOk = spaced.status === 200;
const secondCase = await enroll(await createStudent("Norm-Case-2"), t03base.toUpperCase());
check("T03 spaced enroll", spacedOk, `status ${spaced.status}`);
check(
  "T03 case collision",
  secondCase.status === 409,
  `status ${secondCase.status} body ${JSON.stringify(await json(secondCase))}`
);

const crowd = [];
for (let index = 0; index < 30; index += 1) {
  const person = await createStudent(`Crowd-${stamp}-${index}`);
  const name = `C${stamp}${String(index).padStart(2, "0")}`;
  const enrolled = await enroll(person, name);
  if (enrolled.status !== 200) {
    failures.push(`T06 enroll ${index} ${enrolled.status}`);
    continue;
  }
  await answer(person.key, name);
  crowd.push(person);
}
check("T06 thirty isolated students", crowd.length === 30, `got ${crowd.length}`);

const liveStudent = await createStudent("Live-Direct");
const liveEnroll = await enroll(liveStudent, `Live-${stamp}`, { ...SERIES, source: "direct_live_link" });
check("T05 direct live enroll", liveEnroll.status === 200, `status ${liveEnroll.status}`);
const livePage = await fetch(`${BASE}/l/gleitlagerung-demo`);
check("T05 live page reachable", livePage.status === 200, `status ${livePage.status}`);

const storePath = path.join(process.cwd(), ".data/learnbuddy-students.json");
const t14Series = `t14-${stamp}`;
const raw = JSON.parse(await fs.readFile(storePath, "utf8"));
const now = new Date().toISOString();
function t14Profile(id) {
  return {
    id,
    anonymousKey: `key-${id}`,
    pseudonym: "Altname",
    locale: "de",
    createdAt: now,
    lastSeenAt: now
  };
}
function t14Enroll(partial) {
  return {
    seriesTitle: "T14 Fixture",
    source: "code",
    status: "active",
    addedAt: now,
    ...partial
  };
}
raw.profiles.push(t14Profile("t14p1"), t14Profile("t14p2"), t14Profile("t14p3"), t14Profile("t14p4"), t14Profile("t14p5"));
raw.enrollments.push(
  t14Enroll({ id: "t14e1", studentProfileId: "t14p1", seriesId: t14Series, displayName: "Doppelt", displayNameNormalized: "doppelt" }),
  t14Enroll({ id: "t14e2", studentProfileId: "t14p2", seriesId: t14Series, displayName: "Doppelt", displayNameNormalized: "doppelt" }),
  t14Enroll({ id: "t14e3", studentProfileId: "t14p3", seriesId: t14Series, displayName: `X${"y".repeat(50)}`, displayNameNormalized: `x${"y".repeat(50)}` }),
  t14Enroll({ id: "t14e4", studentProfileId: "t14p4", seriesId: t14Series, displayName: "anonym", displayNameNormalized: "anonym" }),
  t14Enroll({
    id: "t14e5",
    studentProfileId: "t14p5",
    seriesId: t14Series,
    status: "anonymized",
    displayName: "Zahnrad-Joe",
    displayNameNormalized: "zahnrad-joe"
  })
);
await fs.writeFile(storePath, `${JSON.stringify(raw, null, 2)}\n`);
await fetch(`${BASE}/api/student/pseudonyms?seriesId=${encodeURIComponent(t14Series)}`);
const afterFirst = JSON.parse(await fs.readFile(storePath, "utf8"));
const t14rows = afterFirst.enrollments.filter((item) => item.seriesId === t14Series);
const t14active = t14rows.filter((item) => item.status === "active");
const t14names = t14active.map((item) => item.displayName);
const t14keys = t14active.map((item) => item.displayNameNormalized);
const t14anon = t14rows.find((item) => item.status === "anonymized");
check("T14 all rows migrated", t14rows.length === 5, String(t14rows.length));
check("T14 names unique", new Set(t14keys).size === t14keys.length, JSON.stringify(t14names));
check(
  "T14 length and reserved",
  t14active.every((item) => (item.displayName ?? "").length <= 40 && !["anonym", "anonymisiert", "pseudonym"].includes(item.displayNameNormalized)),
  JSON.stringify(t14names)
);
check(
  "T14 anonymized not historical",
  Boolean(t14anon?.displayName) && !/zahnrad-joe/i.test(t14anon.displayName) && /^Anonym/i.test(t14anon.displayName),
  JSON.stringify(t14anon)
);
const snapshot = t14rows.map((item) => `${item.id}:${item.displayName}:${item.status}`);
await fetch(`${BASE}/api/student/pseudonyms?seriesId=${encodeURIComponent(t14Series)}`);
const afterSecond = JSON.parse(await fs.readFile(storePath, "utf8"));
const t14again = afterSecond.enrollments.filter((item) => item.seriesId === t14Series);
check(
  "T14 second run idempotent",
  JSON.stringify(t14again.map((item) => `${item.id}:${item.displayName}:${item.status}`)) === JSON.stringify(snapshot),
  JSON.stringify(t14again.map((item) => item.displayName))
);

const sql = await fs.readFile(path.join(process.cwd(), "drizzle/0027_series_display_claims.sql"), "utf8");
check("0027 unique index", sql.includes("student_enrollments_active_name_idx"), "index missing");
check("0027 anonymized status", /ADD VALUE IF NOT EXISTS 'anonymized'/.test(sql), "enum missing");
check("0027 display_name columns", sql.includes("display_name_normalized"), "columns missing");
if (!process.env.DATABASE_URL) {
  console.log("skip T13/postgres live migrate — DATABASE_URL unset, no untested production deploy");
}

if (failures.length) {
  console.error(`\n${failures.length} failed:\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("all identity gates passed");
