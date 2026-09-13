import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import postgres from "postgres";
import { buildWordingPlan, wordingFingerprint } from "../../scripts/lib/question-wording-plan.mjs";
import { applyQuestionWording } from "../../scripts/lib/apply-question-wording.mjs";

const url = process.env.QUESTION_REVIEW_TEST_DATABASE_URL;
if (!url) throw new Error("QUESTION_REVIEW_TEST_DATABASE_URL is required; tests do not silently skip");
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(new URL(url).hostname)) throw new Error("Use a local disposable PostgreSQL instance");
const schema = `wording_test_${randomUUID().replaceAll("-", "")}`;
const admin = postgres(url, { max: 1, prepare: false });
const sql = postgres(url, { max: 2, prepare: false, connection: { search_path: schema, application_name: schema } });
let fixture;
const owner = "owner@example.test";
const token = "wording-test";
const options = { ownerEmail: owner, publicToken: token };

before(async () => {
  await admin`CREATE SCHEMA ${admin(schema)}`;
  await sql.unsafe(`
    CREATE TABLE users (id uuid PRIMARY KEY, email text NOT NULL);
    CREATE TABLE lecture_series (id uuid PRIMARY KEY, owner_id uuid REFERENCES users(id));
    CREATE TABLE lectures (id uuid PRIMARY KEY, series_id uuid REFERENCES lecture_series(id), public_token text UNIQUE, title text);
    CREATE TABLE questions (id uuid PRIMARY KEY, lecture_id uuid REFERENCES lectures(id), slide_id uuid, source text);
    CREATE TABLE question_variants (id uuid PRIMARY KEY, question_id uuid REFERENCES questions(id), level text,
      points integer, text text, answers_json jsonb, correct_answer_key text, explanation text, prompt_version text);
    CREATE TABLE live_sessions (lecture_id uuid PRIMARY KEY REFERENCES lectures(id), status text, round jsonb);
    CREATE TABLE answer_receipts (id uuid PRIMARY KEY, variant_id uuid REFERENCES question_variants(id), points integer, receipt jsonb);
    CREATE TABLE live_answer_probe (id uuid PRIMARY KEY, lecture_id uuid REFERENCES lectures(id));
  `);
});
after(async () => {
  await sql.end({ timeout: 3 });
  await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`;
  await admin.end({ timeout: 3 });
});
beforeEach(async () => {
  await sql.unsafe("TRUNCATE users, lecture_series, lectures, questions, question_variants, live_sessions, answer_receipts, live_answer_probe CASCADE");
  const lectureId = randomUUID(), seriesId = randomUUID(), userId = randomUUID(), familyId = randomUUID();
  await sql`INSERT INTO users VALUES (${userId}, ${owner})`;
  await sql`INSERT INTO lecture_series VALUES (${seriesId}, ${userId})`;
  await sql`INSERT INTO lectures VALUES (${lectureId}, ${seriesId}, ${token}, 'Review fixture')`;
  await sql`INSERT INTO questions VALUES (${familyId}, ${lectureId}, ${randomUUID()}, 'original-source')`;
  const questions = ["4.0", "3.0", "2.0", "1.0"].map((level) => ({ familyId, level, text: `Frage ${level} aus Abschn. 1.1?`,
    answers: ["D", "B", "A", "C"].map((key) => ({ key, text: `Antwort ${key}`, correct: key === "B" })), explanation: "Das Skript begründet B." }));
  for (const question of questions) {
    await sql`INSERT INTO question_variants VALUES (${randomUUID()}, ${familyId}, ${question.level}, ${5 - Number(question.level)},
      ${question.text}, ${sql.json(question.answers)}, 'B', ${question.explanation}, 'original-version')`;
  }
  const [variant] = await sql`SELECT id FROM question_variants LIMIT 1`;
  await sql`INSERT INTO answer_receipts VALUES (${randomUUID()}, ${variant.id}, 3, ${sql.json({ correct: true, explanation: "Historical wording" })})`;
  const plan = buildWordingPlan({ lectureId, questions }, { lectureId, families: [{ familyId, variants: questions.map((question) => ({
    level: question.level, expectedFingerprint: wordingFingerprint(question), text: `Welche Beziehung beschreibt Modell ${question.level}?`,
    explanation: "Es beschreibt ausgewählte Beziehungen für eine Aufgabe.", reason: "Remove source dependency.",
    answers: question.answers.map((answer) => ({ ...answer, text: `Eigenständige Antwort ${answer.key}` })),
  })) }] });
  fixture = { lectureId, familyId, seriesId, plan };
});

const stored = () => sql`SELECT * FROM question_variants ORDER BY id`;

async function waitForLock(queryFragment) {
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    const rows = await admin`SELECT pid FROM pg_stat_activity WHERE application_name = ${schema}
      AND wait_event_type = 'Lock' AND query LIKE ${`%${queryFragment}%`} AND cardinality(pg_blocking_pids(pid)) > 0`;
    if (rows.length) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`Expected PostgreSQL lock wait: ${queryFragment}`);
}

test("dry-run is non-mutating; apply preserves IDs, points, answer order, ownership and receipts; retry is idempotent", async () => {
  const original = await stored();
  const receipts = await sql`SELECT * FROM answer_receipts`;
  assert.equal((await applyQuestionWording(sql, fixture.plan, options)).status, "dry-run");
  assert.deepEqual(await stored(), original);
  let backup;
  const result = await applyQuestionWording(sql, fixture.plan, { ...options, apply: true, backup: async (value) => { backup = structuredClone(value); } });
  assert.equal(result.status, "applied");
  assert.equal(backup.transactionCommitted, false);
  assert.equal(backup.rows.length, 4);
  const afterRows = await stored();
  for (let i = 0; i < original.length; i++) {
    const before = original[i], after = afterRows[i];
    for (const key of ["id", "question_id", "level", "points", "correct_answer_key"]) assert.equal(after[key], before[key]);
    assert.deepEqual(after.answers_json.map((answer) => answer.key), before.answers_json.map((answer) => answer.key));
    assert.notEqual(after.text, before.text);
    assert.ok(after.prompt_version.startsWith("standalone-review-v1:"));
  }
  assert.deepEqual(await sql`SELECT * FROM answer_receipts`, receipts);
  assert.equal((await applyQuestionWording(sql, fixture.plan, { ...options, apply: true, backup: async () => assert.fail("retry must not rewrite backup") })).status, "already-applied");
  assert.deepEqual(await stored(), afterRows);
});

test("wrong owner/token, newer wording, grading mismatch and partial inventory all refuse before backup", async () => {
  const backup = async () => assert.fail("refusal must precede backup");
  await assert.rejects(applyQuestionWording(sql, fixture.plan, { ...options, ownerEmail: "other@example.test", apply: true, backup }), /owner mismatch/);
  await assert.rejects(applyQuestionWording(sql, fixture.plan, { ...options, publicToken: "other", apply: true, backup }), /owner mismatch/);
  await sql`UPDATE question_variants SET text = 'A newer teacher edit' WHERE level = '4.0'`;
  const changed = await stored();
  await assert.rejects(applyQuestionWording(sql, fixture.plan, { ...options, apply: true, backup }), /newer edit/);
  assert.deepEqual(await stored(), changed);
  await sql`UPDATE question_variants SET text = ${fixture.plan.changes[0].expected.text} WHERE level = '4.0'`;
  await sql`UPDATE question_variants SET correct_answer_key = 'C' WHERE level = '4.0'`;
  await assert.rejects(applyQuestionWording(sql, fixture.plan, options), /grading keys disagree/);
  await sql`UPDATE question_variants SET correct_answer_key = 'B' WHERE level = '4.0'`;
  await sql`INSERT INTO questions VALUES (${randomUUID()}, ${fixture.lectureId}, null, 'new-family')`;
  await assert.rejects(applyQuestionWording(sql, fixture.plan, options), /family inventory changed/);
});

test("any active class refuses, even without an unexpired round; an ended class permits maintenance", async () => {
  for (const round of [null, { expiresAt: Date.now() + 60_000 }, { expiresAt: 0 }]) {
    await sql`INSERT INTO live_sessions VALUES (${fixture.lectureId}, 'active', ${sql.json(round)}) ON CONFLICT (lecture_id) DO UPDATE SET round = excluded.round`;
    await assert.rejects(applyQuestionWording(sql, fixture.plan, options), /End the live session/);
  }
  await sql`UPDATE live_sessions SET status = 'ended'`;
  assert.equal((await applyQuestionWording(sql, fixture.plan, options)).status, "dry-run");
});

test("backup failure and a late SQL failure roll back the entire edit", async () => {
  const original = await stored();
  await assert.rejects(applyQuestionWording(sql, fixture.plan, { ...options, apply: true, backup: async () => { throw new Error("Backup failed"); } }), /Backup failed/);
  assert.deepEqual(await stored(), original);
  await sql.unsafe(`CREATE FUNCTION refuse_last() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.level = '1.0' THEN RAISE EXCEPTION 'forced last update failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fail_last BEFORE UPDATE ON question_variants FOR EACH ROW EXECUTE FUNCTION refuse_last();`);
  try {
    await assert.rejects(applyQuestionWording(sql, fixture.plan, { ...options, apply: true, backup: async () => {} }), /forced last update failure/);
    assert.deepEqual(await stored(), original);
  } finally { await sql.unsafe("DROP TRIGGER fail_last ON question_variants; DROP FUNCTION refuse_last()"); }
});

test("a concurrently starting class waits for the full maintenance commit", async () => {
  let backupReady, resumeBackup;
  const ready = new Promise((resolve) => { backupReady = resolve; });
  const hold = new Promise((resolve) => { resumeBackup = resolve; });
  const maintenance = applyQuestionWording(sql, fixture.plan, { ...options, apply: true, backup: async () => { backupReady(); await hold; } });
  await ready;
  const started = sql.begin(async (tx) => {
    await tx`SELECT id FROM lectures WHERE id = ${fixture.lectureId} FOR NO KEY UPDATE`;
    await tx`INSERT INTO live_sessions VALUES (${fixture.lectureId}, 'active', null)`;
    return tx`SELECT text FROM question_variants ORDER BY level`;
  });
  try { await waitForLock("FROM lectures"); }
  finally { resumeBackup(); }
  assert.equal((await maintenance).status, "applied");
  assert.ok((await started).every((row) => row.text.startsWith("Welche Beziehung")));
});

test("an answer holding the session can finish its lecture FK check without a lock-order deadlock", async () => {
  await sql`INSERT INTO live_sessions VALUES (${fixture.lectureId}, 'ended', null)`;
  let locked, proceed;
  const ready = new Promise((resolve) => { locked = resolve; });
  const hold = new Promise((resolve) => { proceed = resolve; });
  const answer = sql.begin(async (tx) => {
    await tx`SELECT lecture_id FROM live_sessions WHERE lecture_id = ${fixture.lectureId} FOR UPDATE`;
    locked(); await hold;
    await tx`INSERT INTO live_answer_probe VALUES (${randomUUID()}, ${fixture.lectureId})`;
  });
  await ready;
  const maintenance = applyQuestionWording(sql, fixture.plan, options);
  // Observe the actual server wait, rather than assuming a delay creates overlap.
  try { await waitForLock("FROM live_sessions"); }
  finally { proceed(); }
  await answer;
  assert.equal((await maintenance).status, "dry-run");
});
