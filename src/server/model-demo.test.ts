import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { scene3dSceneIdValues, validateSlideDocument } from "@learnordie/slide-engine/schema";
import { canvasSceneForSlide } from "@learnordie/slide-engine/excalidraw/scene";
import { canvasSceneSchema } from "@learnordie/slide-engine/excalidraw/canvas-schema";
import { createModelDemoDocument, MODEL_DEMO_NOTICE } from "@/lib/model-demo-template";
import { ensureModelDemo } from "./model-demo";
import { handleModelDemoPost } from "./model-demo-handler";

test("all eight source scenes validate and convert to native editable scenes", () => {
  const document = createModelDemoDocument("example", scene3dSceneIdValues.map((_, i) => `slide-${i}`));
  assert.equal(validateSlideDocument(document).ok, true);
  assert.match(document.title, /Beispielsatz/);
  const ids = document.slides.flatMap((slide) => slide.blocks.filter((b) => b.type === "scene3d").map((b) => b.sceneId));
  assert.deepEqual(ids, [...scene3dSceneIdValues]);
  for (const slide of document.slides) {
    assert.ok(slide.speakerNotes?.some((note) => note.text === MODEL_DEMO_NOTICE));
    const scene = canvasSceneForSlide(slide, document.assets);
    assert.equal(canvasSceneSchema.safeParse(scene).success, true);
    assert.equal(scene.elements.filter((e) => e.type === "embeddable").length, 1);
    for (const block of slide.blocks.filter((b) => b.type === "paragraph")) {
      assert.ok(scene.elements.some((e) => e.type === "text" && e.originalText === block.text));
    }
  }
  assert.throws(() => createModelDemoDocument("bad", ["one"]));
  assert.throws(() => createModelDemoDocument("bad", Array(8).fill("one")));
});

function request(body?: string) {
  return new Request("https://example.test/api/lectures/model-demo", { method: "POST", body });
}

test("authentication, CSRF and body rejection happen before persistence", async () => {
  let writes = 0;
  const createDemo = async () => { writes++; return { lectureId: "owned", created: true }; };
  for (const [session, csrf, body, status] of [
    [null, true, undefined, 401],
    [{ email: "qa@example.test" }, false, undefined, 403],
    [{ email: "qa@example.test" }, true, '{"owner":"victim@example.test"}', 400]
  ] as const) {
    const response = await handleModelDemoPost(request(body), { getSession: async () => session, isValidCsrf: () => csrf, createDemo });
    assert.equal(response.status, status);
  }
  assert.equal(writes, 0);
});

test("handler uses session identity and exposes stable result without leaking DB errors", async () => {
  for (const created of [true, false]) {
    const response = await handleModelDemoPost(request(), {
      getSession: async () => ({ email: "qa@example.test" }), isValidCsrf: () => true,
      createDemo: async (email) => { assert.equal(email, "qa@example.test"); return { lectureId: "owned", created }; }
    });
    assert.equal(response.status, created ? 201 : 200);
    assert.deepEqual(await response.json(), { lectureId: "owned", created });
  }
  const response = await handleModelDemoPost(request(), {
    getSession: async () => ({ email: "qa@example.test" }), isValidCsrf: () => true,
    createDemo: async () => { throw new Error("postgres://secret-password@private-host/database"); }
  });
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /secret-password|private-host/);
});

// Recording transaction double: checks the real parameterized SQL and atomic
// service orchestration without connecting to any database. PostgreSQL locking
// and live authorization remain integration checks for the parent QA run.
function recordingDb(options: { failSlide?: number; wrongOwner?: boolean } = {}) {
  const dialect = new PgDialect();
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const committed = new Map<string, { owner: string; document: string; slides: unknown[][] }>();
  let tail = Promise.resolve();
  const database = {
    transaction: async (run: (tx: { execute(query: SQL): Promise<unknown[]> }) => Promise<unknown>) => {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      let owner = "";
      let pending: { id: string; document: string; slides: unknown[][] } | undefined;
      try {
        const result = await run({ execute: async (query) => {
          const statement = dialect.sqlToQuery(query);
          const sql = statement.sql.replace(/\s+/g, " ").trim();
          const params = statement.params;
          statements.push({ sql, params });
          if (sql.startsWith("select l.id")) {
            assert.match(sql, /join users u on u.id = s.owner_id/);
            assert.match(sql, /where l.id = \$1::uuid and u.email = \$2/);
            owner = String(params[1]);
            return committed.get(String(params[0]))?.owner === owner ? [{ id: params[0] }] : [];
          }
          if (sql.startsWith("select s.id")) {
            assert.match(sql, /u.email = \$2/);
            assert.equal(params[1], owner);
            return options.wrongOwner ? [] : [{ id: params[0] }];
          }
          if (sql.startsWith("insert into lectures")) {
            assert.match(sql, /'draft', false/);
            pending = { id: String(params[0]), document: String(params[4]), slides: [] };
          }
          if (sql.startsWith("insert into slides")) {
            assert.ok(pending);
            if (options.failSlide === params[2]) throw new Error("simulated insert failure");
            pending.slides.push(params);
          }
          return [];
        } });
        if (pending) committed.set(pending.id, { owner, document: pending.document, slides: pending.slides });
        return result;
      } finally { release(); }
    }
  } as unknown as NonNullable<Parameters<typeof ensureModelDemo>[1]>;
  return { database, statements, committed };
}

test("scoped creation is atomic, repeatable, concurrent-safe in the transaction contract and preserves edits", async () => {
  const db = recordingDb();
  const [first, repeat] = await Promise.all([
    ensureModelDemo(" QA@example.test ", db.database), ensureModelDemo("qa@example.test", db.database)
  ]);
  assert.equal(first.created, true);
  assert.deepEqual(repeat, { lectureId: first.lectureId, created: false });
  assert.match(db.statements[0].sql, /pg_advisory_xact_lock\(hashtextextended/);
  const own = db.committed.get(first.lectureId)!;
  assert.equal(own.slides.length, 8);
  const document = JSON.parse(own.document);
  assert.equal(validateSlideDocument(document).ok, true);
  assert.deepEqual(document.slides.map((slide: { id: string }) => slide.id), own.slides.map((row) => row[0]));
  assert.deepEqual(own.slides.map((row) => row[2]), [1, 2, 3, 4, 5, 6, 7, 8]);
  own.document = "user-edited document";
  const statementCount = db.statements.length;
  await ensureModelDemo("qa@example.test", db.database);
  assert.equal(own.document, "user-edited document");
  assert.ok(db.statements.slice(statementCount).every((s) => s.sql.startsWith("select")));
  const other = await ensureModelDemo("other@example.test", db.database);
  assert.notEqual(other.lectureId, first.lectureId);
  assert.equal(db.committed.size, 2);
  assert.ok(!db.statements.some((s) => /delete|update|insert into questions/i.test(s.sql)));
});

test("failed slide creation rolls back and permits a clean retry; foreign series is never adopted", async () => {
  const options = { failSlide: 4 };
  const db = recordingDb(options);
  await assert.rejects(ensureModelDemo("qa@example.test", db.database), /simulated insert failure/);
  assert.equal(db.committed.size, 0);
  options.failSlide = 0;
  assert.equal((await ensureModelDemo("qa@example.test", db.database)).created, true);
  const foreign = recordingDb({ wrongOwner: true });
  await assert.rejects(ensureModelDemo("qa@example.test", foreign.database), /ownership mismatch/);
  assert.equal(foreign.committed.size, 0);
  assert.ok(!foreign.statements.some((s) => s.sql.startsWith("insert into lectures")));
  await assert.rejects(ensureModelDemo(" ", db.database), /authenticated owner/);
});
