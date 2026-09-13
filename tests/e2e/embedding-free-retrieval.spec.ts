import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";

const execFileAsync = promisify(execFile);

test("Material ingestion and owner-scoped database search work without embeddings or external calls", async () => {
  const script = `
    import assert from 'node:assert/strict';
    import crypto from 'node:crypto';
    import postgres from 'postgres';
    import { getEmbeddingProvider } from '@/server/providers/embeddings';
    import { processMaterialContent } from '@/server/material-pipeline';
    import { retrieveLectureSources } from '@/server/lecture-retrieval';
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error('External requests forbidden'); };
    const sql = postgres(process.env.DATABASE_URL, {max: 1, connect_timeout: 5});
    const ids = [crypto.randomUUID(), crypto.randomUUID()];
    let succeeded = false;
    try {
      assert.equal(getEmbeddingProvider(), null);
      await sql.unsafe('insert into lectures (id, public_token, title) values ($1, $2, $3), ($4, $5, $6)',
        [ids[0], 'no-embedding-' + ids[0], 'Scoped search fixture', ids[1], 'no-embedding-' + ids[1], 'Other lecture fixture']);
      const lecture = {id: ids[0], title: 'Scoped search fixture', materials: []};
      const processed = await processMaterialContent({
        lecture,
        material: {id: crypto.randomUUID(), originalName: 'Feder.txt', source: 'upload', kind: 'document'},
        storedText: 'Eine Feder speichert elastische Energie. Die Federkraft steigt proportional zur Auslenkung.'
      });
      assert.ok(processed.chunks.length > 0);
      assert.ok(processed.chunks.every(chunk => chunk.embedding === null));
      for (const chunk of processed.chunks) {
        await sql.unsafe('insert into asset_chunks (lecture_id, source_ref, content, embedding) values ($1, $2, $3, null)', [ids[0], chunk.sourceRef, chunk.content]);
      }
      await sql.unsafe('insert into asset_chunks (lecture_id, source_ref, content, embedding) values ($1, $2, $3, null)', [ids[1], 'private-other-lecture', 'Eine Feder speichert elastische Energie. Vertraulicher fremder Inhalt.']);
      const sources = await retrieveLectureSources({lecture, query: 'Feder Energie', limit: 1});
      assert.equal(sources.length, 1);
      assert.equal(sources[0].retrievalMethod, 'text');
      assert.equal(sources[0].sourceRef, 'Feder.txt#chunk-1');
      assert.ok(sources[0].content.includes('elastische Energie'));
      assert.ok(sources[0].score > 0);
      assert.equal((await retrieveLectureSources({lecture, query: 'Vertraulicher fremder Inhalt'})).length, 0);
      assert.equal((await retrieveLectureSources({lecture, query: "' OR 1=1 --"})).length, 0);
      assert.equal((await retrieveLectureSources({lecture, query: ''})).length, 0);
      assert.equal(calls, 0);
      succeeded = true;
    } finally {
      await sql.unsafe('delete from asset_chunks where lecture_id in ($1, $2)', ids);
      await sql.unsafe('delete from lectures where id in ($1, $2)', ids);
      await sql.end({timeout: 3});
      // Application getDb has its own pool; this bounded child owns that pool.
      if (succeeded) { console.log('embedding-free-database-search: pass'); process.exit(0); }
    }
  `;
  const { stdout } = await execFileAsync(process.execPath, [
    "--experimental-strip-types", "--import", "./scripts/alias-register.mjs", "--input-type=module", "-e", script
  ], {
    timeout: 20_000,
    env: {
      ...process.env,
      DATABASE_URL: process.env.E2E_DATABASE_URL ?? "postgres://michaelwelsch@127.0.0.1:55432/learnbuddy_e2e_smoke",
      LEARNBUDDY_REPOSITORY: "postgres",
      LEARNBUDDY_EMBEDDING_PROVIDER: "disabled",
      LEARNBUDDY_EMBEDDING_BASE_URL: "",
      LEARNBUDDY_EMBEDDING_API_KEY: ""
    }
  });
  expect(stdout).toContain("embedding-free-database-search: pass");
});
