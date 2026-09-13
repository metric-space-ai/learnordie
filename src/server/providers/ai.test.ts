import assert from "node:assert/strict";
import test from "node:test";
import { getAIProvider } from "@/server/providers/ai";

test("bounded M3 generation separates reasoning and rejects truncated answers", async (t) => {
  const keys = ["LEARNBUDDY_AI_PROVIDER", "LEARNBUDDY_AI_BASE_URL", "LEARNBUDDY_AI_MODEL"] as const;
  const previous = keys.map((key) => process.env[key]);
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  });
  process.env.LEARNBUDDY_AI_PROVIDER = "openai-compatible";
  process.env.LEARNBUDDY_AI_BASE_URL = "https://api.minimax.io";
  let body: Record<string, unknown> = {};
  let finishReason = "stop";
  let streaming = false;
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(String(init?.body));
    if (streaming) {
      return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: "Answer" } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finishReason }] })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
    }
    return Response.json({ choices: [{ finish_reason: finishReason, message: { content: '{"variants":[]}', reasoning_details: [{ text: "not answer content" }] } }] });
  };
  process.env.LEARNBUDDY_AI_MODEL = "MiniMax-M3";
  const input = { system: "QA", user: "Synthetic", maxOutputTokens: 2600, responseFormat: "json_object" as const };
  assert.equal((await getAIProvider().complete(input)).answer, '{"variants":[]}');
  assert.deepEqual(body.thinking, { type: "disabled" });
  assert.equal(body.reasoning_split, true);
  assert.equal(body.max_tokens, 2600);
  finishReason = "length";
  await assert.rejects(getAIProvider().complete(input), /output limit/);
  finishReason = "stop";
  process.env.LEARNBUDDY_AI_MODEL = "another-provider-model";
  await getAIProvider().complete(input);
  assert.equal(body.thinking, undefined);
  assert.equal(body.reasoning_split, undefined);

  process.env.LEARNBUDDY_AI_MODEL = "MiniMax-M3";
  streaming = true;
  const stream = await getAIProvider().streamComplete!(input);
  let text = "";
  for await (const chunk of stream.chunks) text += chunk;
  assert.equal(text, "Answer");
  assert.equal((await stream.completed).answer, "Answer");
  assert.deepEqual(body.thinking, { type: "disabled" });
  assert.equal(body.reasoning_split, true);
  finishReason = "length";
  const truncated = await getAIProvider().streamComplete!(input);
  const completionRejected = assert.rejects(truncated.completed, /output limit/);
  await assert.rejects(async () => { for await (const chunk of truncated.chunks) void chunk; }, /output limit/);
  await completionRejected;
});
