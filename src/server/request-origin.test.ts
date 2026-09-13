import test from "node:test";
import assert from "node:assert/strict";
import { sameOrigin } from "./request-origin.ts";

const request = (headers: Record<string, string> = {}, url = "http://localhost:3070/api/test") => new Request(url, { headers });
test("same-origin public Host works when Next uses an internal listen hostname", () => {
  assert.equal(sameOrigin(request({ host: "127.0.0.1:3070", origin: "http://127.0.0.1:3070", "sec-fetch-site": "same-origin" })), true);
  assert.equal(sameOrigin(request({ origin: "http://localhost:3070" })), true);
  assert.equal(sameOrigin(request()), true);
});
test("foreign origins, ports, schemes, opaque origins and malformed authorities fail closed", () => {
  for (const origin of ["https://evil.test", "http://localhost:3071", "https://localhost:3070", "http://localhost:3070.evil.test", "null", "http://localhost:3070/", "http://x@localhost:3070", "http://localhost:3070, https://evil.test"]) {
    assert.equal(sameOrigin(request({ origin })), false, origin);
  }
  assert.equal(sameOrigin(request({ origin: "http://localhost:3070", "sec-fetch-site": "cross-site" })), false);
  for (const host of ["", "evil.test/path", "localhost:3070,evil.test", "evil.test@localhost:3070"]) {
    assert.equal(sameOrigin(request({ host, origin: "http://localhost:3070" })), false, host);
  }
});
test("forwarded headers do not authorize an attacker origin or the internal hostname", () => {
  assert.equal(sameOrigin(request({ host: "app.test", origin: "https://evil.test", "x-forwarded-host": "evil.test", "x-forwarded-proto": "https" })), false);
  assert.equal(sameOrigin(request({ host: "app.test", origin: "http://localhost:3070" })), false);
  assert.equal(sameOrigin(request({ host: "app.test", origin: "https://app.test" }, "https://internal.test/api/test")), true);
});
