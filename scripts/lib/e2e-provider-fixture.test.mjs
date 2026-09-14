import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { providerFixturePrompt, fixtureGroundingReview, fixtureTransportUrl } from "./e2e-provider-fixture.mjs";

test("provider mock reads Responses messages, legacy string input and Chat Completions", () => {
  assert.equal(providerFixturePrompt({ instructions: "system", input: "question" }), "system\nquestion");
  assert.equal(providerFixturePrompt({ input: [
    { role: "system", content: [{ type: "input_text", text: "system" }] },
    { role: "user", content: [{ type: "input_text", text: "question" }] }
  ] }), "system\nquestion");
  assert.equal(providerFixturePrompt({ messages: [{ role: "system", content: "system" }, { role: "user", content: "question" }] }), "system\nquestion");
  assert.equal(providerFixturePrompt({ input: [{ content: [{ type: "input_image", image_url: "private" }] }] }), "");
});

const family = { variants: ["4.0", "3.0", "2.0", "1.0"].map(level => ({ level, text: `Known ${level}`, explanation: "Known explanation",
  answers: ["yes", "no", "other", "never"].map((text, index) => ({ text, correct: index === 0 })) })) };
const candidates = () => family.variants.map(variant => ({ ...variant,
  answers: [...variant.answers].reverse().map((answer, index) => ({ key: String.fromCharCode(65 + index), text: answer.text })) }));
const request = values => `REVIEW\n${JSON.stringify({ sources: [{ id: "S1.1", text: "Synthetic source for transport testing." }], candidates: values })}`;

test("synthetic review handles shuffled keys without author answer flags", () => {
  const result = JSON.parse(fixtureGroundingReview(request(candidates()), [family]));
  assert.equal(result.reviews.length, 4);
  for (const review of result.reviews) {
    assert.equal(review.approved, true);
    assert.deepEqual(review.answerChecks.filter(answer => answer.verdict === "correct").map(answer => answer.key), ["D"]);
    assert.deepEqual(review.distractors.map(answer => answer.key), ["A", "B", "C"]);
    assert.deepEqual(review.sourceIds, ["S1.1"]);
  }
});

test("synthetic review refuses unknown or modified candidates rather than rubber-stamping", () => {
  for (const mutate of [
    variant => { variant.text = "Unrecognized question"; },
    variant => { variant.answers[0].text = "Invented answer"; },
    variant => { variant.answers[0].text = variant.answers[1].text; },
    variant => { variant.explanation = "Wrong explanation"; }
  ]) {
    const values = candidates(); mutate(values[0]);
    assert.equal(JSON.parse(fixtureGroundingReview(request(values), [family])).reviews[0].approved, false);
  }
});

test("transport rewrites only the two canonical providers to loopback", () => {
  assert.equal(fixtureTransportUrl("https://llm.learnordie.app/v1/responses", "http://127.0.0.1:4070"), "http://127.0.0.1:4070/v1/responses");
  assert.equal(fixtureTransportUrl("https://api.minimax.io/v1/chat/completions", "http://localhost:4070"), "http://localhost:4070/v1/chat/completions");
  assert.equal(fixtureTransportUrl("https://learnordie.app/api/lectures", "http://localhost:4070"), null);
  assert.throws(() => fixtureTransportUrl("https://llm.learnordie.app/v1/responses", "https://external.example"));
  assert.throws(() => fixtureTransportUrl("https://llm.learnordie.app/v1/responses", "http://127.0.0.1:4070/path"));
});

test("transport preloader refuses production environments and non-isolated databases", () => {
  const entry = new URL("./e2e-provider-transport.mjs", import.meta.url).pathname;
  for (const overrides of [{ LEARNBUDDY_DEPLOYMENT_ENV: "production" }, { DATABASE_URL: "postgres://localhost/live" }, { DATABASE_URL: "postgres://external.example/e2e" }]) {
    const result = spawnSync(process.execPath, ["--import", entry, "--eval", ""], {
      env: { ...process.env, NODE_OPTIONS: "", E2E_PROVIDER_TRANSPORT_ORIGIN: "http://127.0.0.1:4070",
        LEARNBUDDY_DEPLOYMENT_ENV: "local", DATABASE_URL: "postgres://localhost/learnordie_e2e", ...overrides }, encoding: "utf8"
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /isolated local E2E database/);
  }
});

test("preloader preserves structured POST bodies and leaves unrelated fetches untouched", () => {
  const entry = new URL("./e2e-provider-transport.mjs", import.meta.url).href;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", `
    const calls = [];
    globalThis.fetch = async (input, init) => {
      const req = new Request(input, init);
      calls.push({url:req.url,method:req.method,body:await req.text(),header:req.headers.get('x-test')});
      return new Response('ok');
    };
    await import(${JSON.stringify(entry)});
    await fetch(new Request('https://llm.learnordie.app/v1/responses', {method:'POST',headers:{'x-test':'preserved'},body:'{"input":[]}'}));
    await fetch('https://api.minimax.io/v1/chat/completions', {method:'POST',body:'{"messages":[]}'});
    await fetch('https://learnordie.app/api/health');
    console.log(JSON.stringify(calls));
  `], { encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "", E2E_PROVIDER_TRANSPORT_ORIGIN: "http://127.0.0.1:4070",
    LEARNBUDDY_DEPLOYMENT_ENV: "local", DATABASE_URL: "postgres://localhost/learnordie_e2e" } });
  assert.equal(result.status, 0, result.stderr);
  const calls = JSON.parse(result.stdout);
  assert.deepEqual(calls[0], { url: "http://127.0.0.1:4070/v1/responses", method: "POST", body: '{"input":[]}', header: "preserved" });
  assert.equal(calls[1].url, "http://127.0.0.1:4070/v1/chat/completions");
  assert.equal(calls[1].body, '{"messages":[]}');
  assert.equal(calls[2].url, "https://learnordie.app/api/health");
});
