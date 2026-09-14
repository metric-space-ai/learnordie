import assert from "node:assert/strict";
import test from "node:test";
import { readJsonBody } from "./request-json";

test("bounded JSON counts UTF-8 bytes, not characters", async () => {
  const body = JSON.stringify({ value: "äöü" });
  assert.deepEqual(await readJsonBody(new Request("https://example.test", { method: "POST", body }), new TextEncoder().encode(body).length), { ok: true, body: { value: "äöü" } });
  assert.deepEqual(await readJsonBody(new Request("https://example.test", { method: "POST", body }), body.length), { ok: false, status: 413 });
});

test("chunked JSON is canceled when the size bound is exceeded", async () => {
  let canceled = false;
  const body = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(32)); }, cancel() { canceled = true; } });
  const request = new Request("https://example.test", { method: "POST", body, duplex: "half" } as RequestInit);
  assert.deepEqual(await readJsonBody(request, 40), { ok: false, status: 413 });
  assert.equal(canceled, true);
});

test("oversized declared body is refused before reading and malformed JSON returns 400", async () => {
  assert.deepEqual(await readJsonBody(new Request("https://example.test", { method: "POST", body: "{}", headers: { "content-length": "500" } }), 40), { ok: false, status: 413 });
  assert.deepEqual(await readJsonBody(new Request("https://example.test", { method: "POST", body: "{" })), { ok: false, status: 400 });
});
