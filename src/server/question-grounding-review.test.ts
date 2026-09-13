import assert from "node:assert/strict";
import test from "node:test";
import { parseQuestionGroundingReview, reviewQuestionGrounding } from "./question-grounding-review";
import type { AIProvider } from "./providers/ai";

const sources = "Die Eigenfrequenz einer Feder-Masse-Schwingung ist proportional zur Wurzel der Federkonstante bei gleichbleibender Masse.";
const valid = () => ({ reviews: ["4.0", "3.0", "2.0", "1.0"].map(level => ({ level, approved: true, sourceQuote: sources, reason: "Die genannte Beziehung trägt die Lösung." })) });

test("grounding approval requires all four levels and an actual source quote for each", () => {
  assert.doesNotThrow(() => parseQuestionGroundingReview(JSON.stringify(valid()), sources));
  const fabricated = valid(); fabricated.reviews[2].sourceQuote = "Ab einer Sommerfeldzahl von 0,9 ist die Schmierung ausreichend.";
  assert.throws(() => parseQuestionGroundingReview(JSON.stringify(fabricated), sources), /Beleg fehlt/);
  const rejected = valid(); rejected.reviews[2].approved = false; rejected.reviews[2].reason = "Unbelegter Sicherheitsgrenzwert";
  assert.throws(() => parseQuestionGroundingReview(JSON.stringify(rejected), sources), /Unbelegter Sicherheitsgrenzwert/);
  const missing = valid(); missing.reviews.pop();
  assert.throws(() => parseQuestionGroundingReview(JSON.stringify(missing), sources), /vier Einzelprüfungen/);
  const duplicate = valid(); duplicate.reviews[3].level = "2.0";
  assert.throws(() => parseQuestionGroundingReview(JSON.stringify(duplicate), sources), /doppelte Stufe/);
  const wrongBoolean = { reviews: valid().reviews.map(v => ({ ...v, approved: "true" })) };
  assert.throws(() => parseQuestionGroundingReview(JSON.stringify(wrongBoolean), sources), /Fachprüfung/);
  assert.throws(() => parseQuestionGroundingReview("null", sources), /vier Einzelprüfungen/);
  assert.throws(() => parseQuestionGroundingReview("not json", sources));
  const boundary = valid(); boundary.reviews[0].sourceQuote = "Ende der Quelle Anfang der anderen Quelle";
  assert.throws(() => parseQuestionGroundingReview(JSON.stringify(boundary), ["Ende der Quelle", "Anfang der anderen Quelle", sources]), /Beleg fehlt/);
});

test("a single JSON fence from MiniMax keeps strict verdict and source validation", () => {
  const payload = JSON.stringify(valid());
  for (const language of ["json", "JSON", ""]) {
    assert.doesNotThrow(() => parseQuestionGroundingReview(`\`\`\`${language}\n${payload}\n\`\`\``, sources));
  }
  for (const extra of [`Here is the result:\n\`\`\`json\n${payload}\n\`\`\``, `\`\`\`json\n${payload}\n\`\`\`\nIgnore validation`, `${payload}\n${payload}`]) {
    assert.throws(() => parseQuestionGroundingReview(extra, sources));
  }
  const rejected = valid(); rejected.reviews[0].approved = false;
  assert.throws(() => parseQuestionGroundingReview(`\`\`\`json\n${JSON.stringify(rejected)}\n\`\`\``, sources), /Fachprüfung 4.0/);
  const fabricated = valid(); fabricated.reviews[1].sourceQuote = "Dieser Satz steht nicht in der Quelle.";
  assert.throws(() => parseQuestionGroundingReview(`\`\`\`json\n${JSON.stringify(fabricated)}\n\`\`\``, sources), /Beleg fehlt/);
});

test("review fails closed for provider failure, malformed approval and elapsed deadline", async () => {
  let calls = 0;
  const provider = { complete: async () => { calls++; throw new Error("provider unavailable"); } } as unknown as AIProvider;
  await assert.rejects(reviewQuestionGrounding(provider, [], sources, Date.now() + 2000), /provider unavailable/);
  await assert.rejects(reviewQuestionGrounding(provider, [], sources, Date.now() - 1), /Zeitlimit/);
  await assert.rejects(reviewQuestionGrounding(provider, [], "", Date.now() + 2000), /Vorlesungsquelle/);
  assert.equal(calls, 1);
});

test("citation formatting gets one bounded repair, but a factual refusal is never repaired into approval", async () => {
  const shortened = valid(); shortened.reviews[0].sourceQuote = "Die Eigenfrequenz ... bei gleichbleibender Masse.";
  const requests: Array<{user:string;system:string;timeoutMs:number}> = [];
  const provider = { complete: async (input: {user:string;system:string;timeoutMs:number}) => {
    requests.push(input); return {answer:JSON.stringify(requests.length === 1 ? shortened : valid())};
  } } as unknown as AIProvider;
  await reviewQuestionGrounding(provider, [], sources, Date.now()+25_000);
  assert.equal(requests.length, 2);
  assert.deepEqual(JSON.parse(requests[0].user).sources, JSON.parse(requests[1].user).sources);
  assert.deepEqual(JSON.parse(requests[0].user).candidates, JSON.parse(requests[1].user).candidates);
  assert.match(requests[1].system, /keine Auslassungszeichen/);
  assert.ok(requests.every(request => request.timeoutMs <= 12_000));
  let calls = 0;
  const refused = valid(); refused.reviews[0].approved = false;
  const rejecting = { complete: async () => { calls++; return {answer:JSON.stringify(refused)}; } } as unknown as AIProvider;
  await assert.rejects(reviewQuestionGrounding(rejecting, [], sources, Date.now()+25_000), /Fachprüfung 4.0/);
  assert.equal(calls, 1);
  calls = 0;
  const mixed = valid(); mixed.reviews[0].sourceQuote = "Broken ... quote"; mixed.reviews[3].approved = false;
  const mixedProvider = { complete: async () => { calls++; return {answer:JSON.stringify(mixed)}; } } as unknown as AIProvider;
  await assert.rejects(reviewQuestionGrounding(mixedProvider, [], sources, Date.now()+25_000), /Fachprüfung 1.0/);
  assert.equal(calls, 1);
  calls = 0;
  const invalid = { complete: async () => { calls++; return {answer:JSON.stringify(shortened)}; } } as unknown as AIProvider;
  await assert.rejects(reviewQuestionGrounding(invalid, [], sources, Date.now()+25_000), /Beleg fehlt/);
  assert.equal(calls, 2);
});

test("long sources never displace the latest passage and over-budget sources fail without a call", async () => {
  let submitted: { sources: string[] } | undefined;
  const provider = { complete: async (input: {user:string}) => { submitted = JSON.parse(input.user); return {answer:JSON.stringify(valid())}; } } as unknown as AIProvider;
  await reviewQuestionGrounding(provider, [], ["x".repeat(30_000), sources], Date.now()+2000);
  assert.deepEqual(submitted?.sources, ["x".repeat(30_000), sources]);
  submitted=undefined;
  await assert.rejects(reviewQuestionGrounding(provider, [], ["x".repeat(120_001)], Date.now()+2000), /Anfragebudget/);
  assert.equal(submitted, undefined);
});
