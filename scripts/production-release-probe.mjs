#!/usr/bin/env node
// Run inside a staged Vercel production build: credentials never leave that environment.
// No database writes, mail, uploads, or user content sent to external providers.
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("Usage: node --experimental-strip-types --import ./scripts/alias-register.mjs scripts/production-release-probe.mjs --run\nRead-only production inventory and synthetic MiniMax M3 generation/streaming. No embeddings or OpenAI API calls. Requires VERCEL_ENV=production. Does not certify release readiness.");
  process.exit(0);
}

if (!process.argv.includes("--run") || process.env.VERCEL_ENV !== "production" || !process.env.DATABASE_URL) {
  console.error("Explicit --run in a configured Vercel production build is required.");
  process.exit(1);
}

const { default: postgres } = await import("postgres");
const report = { mode: "read-only-inventory-and-synthetic-minimax", database: null, ai: null };
const sql = postgres(process.env.DATABASE_URL, {
  max: 1, prepare: false, connect_timeout: 10,
  connection: { statement_timeout: 15000, application_name: "learnordie-release-readonly" }
});
try {
  report.database = await sql.begin(async tx => {
    await tx`set transaction read only`;
    const [counts] = await tx`select
      (select count(*)::int from lectures) as lectures,
      (select count(*)::int from slides) as slides,
      (select count(*)::int from question_variants) as question_variants,
      (select count(*)::int from asset_chunks) as asset_chunks,
      (select count(*)::int from asset_chunks where embedding is not null) as embedded_chunks`;
    const modelDecks = await tx`select l.id, l.leaderboard_enabled,
      (select count(*)::int from slides s where s.lecture_id=l.id) as slides,
      (select count(*)::int from question_variants v join questions q on q.id=v.question_id where q.lecture_id=l.id) as variants
      from lectures l where l.title ilike '%Modellbegriff%' order by l.id`;
    return { counts, modelDecks };
  });
} catch {
  report.database = { status: "fail", message: "Read-only inventory failed; no database error or credentials logged." };
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}

// Use the configured app adapter, never an alternate key/provider or an OpenAI endpoint.
const originalFetch = globalThis.fetch;
let responseStatus = null;
let endpointOrigin = null;
let phase = "provider-selection";
globalThis.fetch = async (...args) => {
  const url = new URL(args[0] instanceof Request ? args[0].url : String(args[0]));
  if (url.hostname === "openai.com" || url.hostname.endsWith(".openai.com")) throw new Error("openai-forbidden");
  endpointOrigin = url.origin;
  const response = await originalFetch(...args);
  responseStatus = response.status;
  return response;
};
const started = Date.now();
try {
  const { getAIProvider } = await import("@/server/providers/ai");
  const provider = getAIProvider();
  if (provider.info.model.toLowerCase() !== "minimax-m3") throw new Error("unexpected-model");
  phase = "four-question-levels";
  const result = await provider.complete({
    system: "Return valid JSON only, with no Markdown fences.",
    user: "Synthetic learning context: A spring stores elastic energy. Its force is proportional to displacement. Create four distinct short German multiple-choice questions for levels 4.0, 3.0, 2.0, 1.0. Return {\"variants\":[{\"level\":\"4.0\",\"text\":\"...\",\"explanation\":\"...\",\"answers\":[{\"text\":\"...\",\"correct\":true}]}]}. Each variant needs four answers, exactly one correct. Keep each question and answer concise.",
    maxOutputTokens: 2600, responseFormat: "json_object", timeoutMs: 30000
  });
  const variants = JSON.parse(result.answer).variants;
  if (!Array.isArray(variants) || variants.length !== 4) throw new Error("invalid-variants");
  for (const level of ["4.0", "3.0", "2.0", "1.0"]) {
    const variant = variants.find(item => item.level === level);
    if (!variant?.text?.trim() || !variant.explanation?.trim() || variant.answers?.length !== 4 || variant.answers.some(answer => !answer.text?.trim()) || variant.answers.filter(answer => answer.correct === true).length !== 1) throw new Error("invalid-question");
  }
  phase = "stream";
  const stream = await provider.streamComplete({ system: "Reply exactly: ok", user: "Return ok.", maxOutputTokens: 32, timeoutMs: 15000 });
  let streamedText = "";
  const completion = stream.completed.catch(() => null);
  for await (const chunk of stream.chunks) streamedText += chunk;
  if (!streamedText.trim() || !(await completion)?.answer?.trim()) throw new Error("invalid-stream");
  report.ai = { status: "pass", provider: provider.info, httpStatus: responseStatus, endpointOrigin, elapsedMs: Date.now() - started, levels: variants.map(item => item.level), stream: true, syntheticInputOnly: true };
} catch {
  report.ai = { status: "fail", phase, httpStatus: responseStatus, endpointOrigin, elapsedMs: Date.now() - started, message: "Configured MiniMax adapter failed its synthetic check; no provider response or credentials logged." };
  process.exitCode = 1;
} finally {
  globalThis.fetch = originalFetch;
}
console.log(JSON.stringify(report, null, 2));
