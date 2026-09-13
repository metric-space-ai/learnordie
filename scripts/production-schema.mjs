#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import postgres from "postgres";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("Usage: node scripts/production-schema.mjs --check | --apply-reviewed-live-migrations | --apply-reviewed-student-draft-migrations\nCheck production migration history, or explicitly apply the reviewed additive pair 0027/0028 (live sessions) or 0029/0030 (student question drafts). No reset, schema push or lecture-content writes.");
  process.exit(0);
}

// A deliberately bounded release repair, never a general schema push/reset.
const liveApply = process.argv.includes("--apply-reviewed-live-migrations");
const draftApply = process.argv.includes("--apply-reviewed-student-draft-migrations");
if (liveApply && draftApply) throw new Error("Choose exactly one reviewed migration pair.");
const apply = liveApply || draftApply;
const expectedPair = draftApply ? "0029_opposite_tattoo,0030_student_chat_question_attempts" : "0027_series_display_claims,0028_live_sessions";
if (!process.env.DATABASE_URL || process.env.VERCEL_ENV !== "production") {
  throw new Error("Run only in the configured production release environment.");
}
const journal = JSON.parse(readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8")).entries;
const migrations = journal.map(entry => {
  const source = readFileSync(new URL(`../drizzle/${entry.tag}.sql`, import.meta.url), "utf8");
  return { ...entry, source, hash: createHash("sha256").update(source).digest("hex") };
});
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, connect_timeout: 10,
  connection: { statement_timeout: 15000, lock_timeout: 5000, application_name: "learnordie-reviewed-live-schema" } });
try {
  const applied = await sql`select hash, created_at from drizzle.__drizzle_migrations order by created_at`;
  const latest = Number(applied.at(-1)?.created_at ?? 0);
  const pending = migrations.filter(item => item.when > latest);
  const columns = await sql`select table_name, column_name from information_schema.columns
    where table_schema = 'public' and table_name in ('live_sessions', 'live_answers', 'student_enrollments')
    order by table_name, ordinal_position`;
  console.log(JSON.stringify({ mode: apply ? "reviewed-additive-migrations" : "read-only-schema-check",
    latestMigration: latest, pending: pending.map(item => item.tag), columns }, null, 2));
  if (apply && pending.length) {
    if (pending.map(item => item.tag).join(",") !== expectedPair) {
      throw new Error("Repair refused: pending migrations differ from the two reviewed additive migrations.");
    }
    if (applied.some(row => !migrations.some(item => item.when === Number(row.created_at) && item.hash === row.hash))) {
      throw new Error("Repair refused: applied migration history does not match the reviewed source.");
    }
    await sql.begin(async tx => {
      await tx`select pg_advisory_xact_lock(192837465)`;
      const current = await tx`select hash, created_at from drizzle.__drizzle_migrations order by created_at`;
      if (JSON.stringify(current) !== JSON.stringify(applied)) throw new Error("Migration history changed; repair refused.");
      for (const migration of pending) {
        for (const statement of migration.source.split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean)) {
          await tx.unsafe(statement);
        }
        await tx`insert into drizzle.__drizzle_migrations (hash, created_at) values (${migration.hash}, ${migration.when})`;
      }
    });
    console.log(`Applied only reviewed migrations ${expectedPair}; existing lecture/slide/question content unchanged.`);
  } else if (pending.length) {
    process.exitCode = 1;
  }
  if (!pending.length || apply) {
    await sql`select display_name, display_name_normalized from student_enrollments limit 0`;
    await sql`select lecture_id, session_id, revision, status, slide_index, show_intro, round, updated_at from live_sessions limit 0`;
    await sql`select lecture_id, session_id, round_id, student_profile_id, points, correct, receipt, created_at from live_answers limit 0`;
    if (!pending.length || draftApply) {
      await sql`select started_at from live_sessions limit 0`;
      await sql`select source_student_question_id from question_review_items limit 0`;
      await sql`select exam_draft_status, exam_draft_attempt_id, exam_draft_attempt_at from student_chat_questions limit 0`;
      await sql`select lecture_id, chat_question_id, created_at from student_exam_draft_attempts limit 0`;
      await sql`select lecture_id, student_profile_id, created_at from student_chat_question_attempts limit 0`;
    }
    console.log("Live-session and enrollment schema queries passed.");
  }
} catch (error) {
  console.error(JSON.stringify({ schemaCheck: "failed", code: error?.code ?? null,
    reason: error?.code ? "Database rejected the schema operation; no SQL data or credentials logged." : error.message }));
  process.exitCode = 1;
} finally { await sql.end({ timeout: 5 }); }
