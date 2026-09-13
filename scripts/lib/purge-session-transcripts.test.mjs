import test from "node:test";
import assert from "node:assert/strict";
import { purgeSessionTranscripts } from "./purge-session-transcripts.mjs";

const options = { publicToken: "qa-audio", ownerEmail: "owner@example.test", sessionId: "session-one", title: "QA audio" };
function fixture(overrides = {}) {
  const state = {
    lecture: { id: "lecture-one", title: "QA audio" },
    session: { session_id: "session-one", status: "ended", started_at: "2026-09-13T19:00:00Z", updated_at: "2026-09-13T19:01:00Z", round: null },
    rows: [{ id: "segment-one", text: "Synthetic test words only.", provider: "minimax-asr-1.0", started_at: "2026-09-13T19:00:10Z", ended_at: "2026-09-13T19:00:16Z", created_at: "2026-09-13T19:00:20Z" }],
    drafts: [{ id: "draft-one", status: "draft", created_at: "2026-09-13T19:00:20Z", source_title: "Transkript: Synthetic test words only.", variants_json: [] }],
    ...overrides
  };
  const deletes = [];
  const tx = async (strings, ...values) => {
    if (!strings.raw) return { in: strings };
    const query = strings.join("?");
    if (query.startsWith("SET LOCAL")) return [];
    if (query.includes("SELECT l.id")) return state.lecture ? [state.lecture] : [];
    if (query.includes("SELECT session_id")) return [state.session];
    if (query.includes("SELECT id, text")) return state.rows;
    if (query.includes("SELECT id, status")) return state.drafts;
    if (query.startsWith("DELETE")) {
      assert.match(query, /WHERE lecture_id=\?/);
      assert.match(query, /id IN \?/);
      assert.equal(values[0], "lecture-one");
      deletes.push(query);
      return query.includes("question_review_items") ? state.drafts : state.rows;
    }
    if (query.includes("AS transcripts")) return [{ transcripts: 0, questions: 12, slides: 3 }];
    if (query.includes("AS questions")) return [{ questions: 12, slides: 3 }];
    throw new Error("Unexpected SQL in test");
  };
  return { sql: { begin: fn => fn(tx) }, deletes };
}
test("dry run reports no speech and cannot delete", async () => {
  const f = fixture();
  const plan = await purgeSessionTranscripts(f.sql, options);
  assert.equal(plan.segments, 1); assert.equal(plan.unpublishedDrafts, 1);
  assert.equal(JSON.stringify(plan).includes("Synthetic test"), false);
  assert.deepEqual(f.deletes, []);
});
test("exact inspected targets are deleted, slide and question counts preserved", async () => {
  const f = fixture();
  const plan = await purgeSessionTranscripts(f.sql, options);
  const result = await purgeSessionTranscripts(f.sql, { ...options, apply: true, expectedDigest: plan.targetDigest });
  assert.equal(result.status, "deleted"); assert.equal(result.remainingSegments, 0);
  assert.equal(f.deletes.length, 2);
});
test("changed targets, missing owner or a different/active session refuse deletion", async () => {
  for (const override of [
    { lecture: null }, { session: { session_id: "other", status: "ended" } },
    { session: { session_id: "session-one", status: "active" } }
  ]) {
    const f = fixture(override);
    await assert.rejects(purgeSessionTranscripts(f.sql, { ...options, apply: true, expectedDigest: "wrong" }));
    assert.deepEqual(f.deletes, []);
  }
  const f = fixture();
  await assert.rejects(purgeSessionTranscripts(f.sql, { ...options, apply: true, expectedDigest: "wrong" }), /Targets changed/);
  assert.deepEqual(f.deletes, []);
});
test("older speech and already reviewed drafts cannot be swept into cleanup", async () => {
  for (const override of [
    { rows: [{ id: "old", provider: "minimax-asr-1.0", started_at: "2025-01-01" }] },
    { drafts: [{ id: "published", status: "approved" }] }
  ]) {
    const f = fixture(override);
    await assert.rejects(purgeSessionTranscripts(f.sql, options));
    assert.deepEqual(f.deletes, []);
  }
});
