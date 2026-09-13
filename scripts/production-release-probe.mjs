#!/usr/bin/env node
// Run inside a staged Vercel production build: credentials never leave that environment.
// No database writes, mail, uploads, or user content sent to external providers.
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("Usage: node --experimental-strip-types --import ./scripts/alias-register.mjs scripts/production-release-probe.mjs --run\nRead-only production inventory and one synthetic embedding request. Requires VERCEL_ENV=production. Does not certify release readiness.");
  process.exit(0);
}

if (!process.argv.includes("--run") || process.env.VERCEL_ENV !== "production" || !process.env.DATABASE_URL) {
  console.error("Explicit --run in a configured Vercel production build is required.");
  process.exit(1);
}

const { default: postgres } = await import("postgres");
const { getEmbeddingProvider } = await import("@/server/providers/embeddings");
const report = { mode: "read-only-inventory-and-synthetic-embedding", database: null, embedding: null };
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

// Probe the already configured external adapter without changing the deployment selection.
const selected = process.env.LEARNBUDDY_EMBEDDING_PROVIDER;
try {
  if (!process.env.LEARNBUDDY_EMBEDDING_API_KEY || !process.env.LEARNBUDDY_EMBEDDING_BASE_URL || !process.env.LEARNBUDDY_EMBEDDING_MODEL) {
    throw new Error("missing-config");
  }
  process.env.LEARNBUDDY_EMBEDDING_PROVIDER = "openai-compatible";
  const provider = getEmbeddingProvider();
  const vector = await provider.embedText("Synthetic deployment check: a model describes a selected aspect of a system.");
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (vector.length !== provider.dimensions || !Number.isFinite(norm) || norm <= 0) throw new Error("invalid-vector");
  report.embedding = { status: "pass", adapter: provider.name, dimensions: vector.length, syntheticInputOnly: true };
} catch {
  report.embedding = { status: "fail", message: "Configured external embedding adapter failed its synthetic request; no provider response or credentials logged." };
  process.exitCode = 1;
} finally {
  if (selected === undefined) delete process.env.LEARNBUDDY_EMBEDDING_PROVIDER;
  else process.env.LEARNBUDDY_EMBEDDING_PROVIDER = selected;
}
console.log(JSON.stringify(report, null, 2));
