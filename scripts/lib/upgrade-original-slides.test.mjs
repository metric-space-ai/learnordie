import test from "node:test";
import assert from "node:assert/strict";
import { upgradeOriginalSlides } from "./upgrade-original-slides.mjs";

function fixture(overrides = {}) {
  const slides = Array.from({ length: 8 }, (_, i) => ({ id: `slide-${i}`, canvas: { elements: [] } }));
  const document = { slides, createdBy: { promptVersion: "learnordie:model-original:clean-v1" } };
  const lecture = { id: "lecture", public_token: "original", series_id: "series", slide_document_json: document };
  const rows = slides.map((slide, i) => ({ id: slide.id, lecture_id: "lecture", position: i + 1, title: "Before", content_json: {} }));
  const writes = [], events = [];
  const tx = async (strings, ...values) => {
    const query = strings.join("?");
    if (query.startsWith("SET LOCAL")) return [];
    if (query.includes("SELECT l.*")) return overrides.missingOwner ? [] : [lecture];
    if (query.includes("SELECT status")) return [{ status: overrides.status ?? "ended", round: null }];
    if (query.includes("SELECT * FROM slides")) return rows;
    writes.push(query); events.push("write");
    if (query.startsWith("UPDATE lectures")) return [{ ...lecture, slide_document_json: values[0] }];
    if (query.startsWith("UPDATE slides")) return [{ ...rows.find(row => row.id === values[2]), title: values[0], content_json: values[1] }];
    throw new Error("Unexpected SQL");
  };
  tx.json = value => value;
  return { sql: { begin: fn => fn(tx) }, writes, events, options: {
    lectureId: "lecture", publicToken: "original", ownerEmail: "owner@example.test",
    plan: () => ({ status: "ready", conflicts: overrides.conflicts ?? [], document, coverage: Array(104).fill({}) }),
    project: next => next.slides.map(slide => ({ id: slide.id, title: "After", eyebrow: "", topic: "Topic", copy: ["Body"], diagram: "formula" })),
    backup: async () => { events.push("backup"); if (overrides.backupFails) throw new Error("Backup failed"); }
  } };
}
test("dry run computes the pinned plan without backup or writes", async () => {
  const f = fixture();
  assert.equal((await upgradeOriginalSlides(f.sql, f.options)).status, "dry-run");
  assert.deepEqual(f.events, []);
});
test("apply backs up first and updates exactly the document and eight slide projections", async () => {
  const f = fixture();
  const dry = await upgradeOriginalSlides(f.sql, f.options);
  const applied = await upgradeOriginalSlides(f.sql, { ...f.options, apply: true, expectedDigest: dry.originalDigest });
  assert.equal(applied.status, "applied");
  assert.equal(f.events[0], "backup");
  assert.equal(f.writes.length, 9);
  assert.ok(f.writes.every(query => /^UPDATE (lectures|slides) SET/.test(query)));
});
test("missing owner, active session, source conflicts and stale digest never write", async () => {
  for (const override of [{ missingOwner: true }, { status: "active" }, { conflicts: [{ code: "source_edit" }] }, {}]) {
    const f = fixture(override);
    await assert.rejects(upgradeOriginalSlides(f.sql, { ...f.options, apply: true, expectedDigest: "stale" }));
    assert.deepEqual(f.events, []);
  }
});
test("failed durable backup and changed identity prevent any write", async () => {
  const f = fixture({ backupFails: true });
  const dry = await upgradeOriginalSlides(f.sql, f.options);
  await assert.rejects(upgradeOriginalSlides(f.sql, { ...f.options, apply: true, expectedDigest: dry.originalDigest }), /Backup failed/);
  assert.deepEqual(f.writes, []);
  await assert.rejects(upgradeOriginalSlides(f.sql, { ...f.options, project: () => [] }), /Projection changed/);
});
