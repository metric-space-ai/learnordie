import test from "node:test";
import assert from "node:assert/strict";
import { savePrivateWordingBackup } from "../../scripts/lib/private-wording-backup.mjs";

const pathname = "maintenance/question-wording/test-only.json";
function fixture({ anonymousStatus = 403, corrupt = false, publicResult = false, duplicate = false } = {}) {
  let bytes;
  return {
    sdk: {
      async put(name, content, options) {
        assert.equal(name, pathname);
        assert.equal(options.access, "private");
        assert.equal(options.allowOverwrite, false);
        assert.equal(options.addRandomSuffix, false);
        assert.ok(options.abortSignal instanceof AbortSignal);
        if (duplicate) throw new Error("SECRET provider token");
        bytes = content;
        return { pathname, url: `https://test.${publicResult ? "public" : "private"}.blob.vercel-storage.com/${pathname}` };
      },
      async get(name, options) {
        assert.equal(name, pathname);
        assert.equal(options.access, "private");
        assert.equal(options.useCache, false);
        return { statusCode: 200, stream: new Response(corrupt ? "corrupt" : bytes).body };
      }
    },
    fetch: async (_url, options) => {
      assert.equal(options.redirect, "manual");
      assert.equal(options.headers, undefined);
      return new Response(null, { status: anonymousStatus });
    }
  };
}
test("private backup is durable only after exact authenticated readback and denied anonymous access", async () => {
  const result = await savePrivateWordingBackup(pathname, { rows: [{ id: "fixture" }] }, fixture());
  assert.equal(result.access, "private");
  assert.equal(result.readBackVerified, true);
  assert.match(result.sha256, /^[0-9a-f]{64}$/);
});
for (const [name, options] of Object.entries({ corrupt: { corrupt: true }, public: { publicResult: true }, exposed: { anonymousStatus: 200 }, redirected: { anonymousStatus: 302 }, duplicate: { duplicate: true } })) {
  test(`backup refuses ${name} storage evidence without leaking provider errors`, async () => {
    await assert.rejects(savePrivateWordingBackup(pathname, { rows: [] }, fixture(options)), error => error.message === "Private backup failed; question bank was not changed");
  });
}
test("backup refuses an out-of-scope pathname before invoking storage", async () => {
  await assert.rejects(savePrivateWordingBackup("public/answers.json", {}, {}), /Invalid private backup path/);
});
