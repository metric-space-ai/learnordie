import assert from "node:assert/strict";
import test from "node:test";
import { appendLectureScript, attachLectureScript } from "./attach-lecture-script.mjs";

const doc = { schemaVersion: "learnordie.slide.v1", slides: [{ id: "edited", canvas: { elements: [{ text: "User edit" }] } }], assets: [{ id: "original-image", kind: "image" }], title: "Original" };
const asset = { id: "script", kind: "sourceDocument", structuredData: { format: "text/markdown", text: "# Original manuscript" } };

test("append preserves every original slide, asset and metadata field; repeated application is a no-op", () => {
  const result = appendLectureScript(doc, asset);
  assert.deepEqual(result, { ...doc, assets: [...doc.assets, asset] });
  assert.equal(result.slides, doc.slides);
  assert.equal(doc.assets.length, 1);
  assert.equal(appendLectureScript(result, asset), result);
});
test("conflicting source, missing native deck and HTML reject without mutation", () => {
  assert.throws(() => appendLectureScript({ ...doc, assets: [asset] }, { ...asset, title: "changed" }), /refusing/);
  assert.throws(() => appendLectureScript(null, asset), /native/);
  assert.throws(() => appendLectureScript(doc, { ...asset, structuredData: { format: "text/html", text: "<p>x</p>" } }), /plain-text/);
});
test("owner mismatch and active session refuse before backup or writes", async () => {
  for (const state of ["missing-owner", "active"]) {
    let backup = false;
    const tx = async chunks => {
      const query = chunks.join("?");
      if (query.includes("SELECT l.*")) return state === "missing-owner" ? [] : [{ id: "lecture", slide_document_json: doc }];
      if (query.includes("SELECT status")) return [{ status: "active" }];
      assert.ok(query.startsWith("SET LOCAL"), "No data writes allowed");
      return [];
    };
    await assert.rejects(attachLectureScript({ begin: fn => fn(tx) }, { lectureId: "lecture", publicToken: "token", ownerEmail: "owner@example.test", asset, apply: true, backup: () => { backup = true; } }), /owner mismatch|End the live/);
    assert.equal(backup, false);
  }
});
test("failed backup prevents the update; successful attachment writes only slide_document_json", async () => {
  for (const failBackup of [true, false]) {
    let wrote = false;
    let backedUp = false;
    const lecture = { id: "lecture", title: "Title", public_token: "token", slide_document_json: doc };
    const tx = async (chunks, ...values) => {
      const query = chunks.join("?");
      if (query.includes("SELECT l.*")) return [lecture];
      if (query.includes("SELECT status")) return [{ status: "ended" }];
      if (query.startsWith("UPDATE")) {
        assert.equal(backedUp, true);
        assert.match(query, /^UPDATE lectures SET slide_document_json=\? WHERE id=\? RETURNING \*$/);
        wrote = true;
        // PostgreSQL JSONB canonicalizes object key order at every nesting level.
        const jsonb = value => Array.isArray(value) ? value.map(jsonb) : value && typeof value === "object"
          ? Object.fromEntries(Object.keys(value).sort().map(key => [key, jsonb(value[key])])) : value;
        return [{ ...lecture, slide_document_json: jsonb(values[0]) }];
      }
      assert.ok(query.startsWith("SET LOCAL"));
      return [];
    };
    tx.json = value => value;
    const run = attachLectureScript({ begin: fn => fn(tx) }, { lectureId: "lecture", publicToken: "token", ownerEmail: "owner@example.test", asset, apply: true, backup: async backup => {
      assert.deepEqual(backup.lecture, lecture);
      if (failBackup) throw new Error("backup failed");
      backedUp = true;
    } });
    if (failBackup) { await assert.rejects(run, /backup failed/); assert.equal(wrote, false); }
    else { assert.equal((await run).status, "applied"); assert.equal(wrote, true); }
  }
});
