import { createHash } from "node:crypto";
import { buildWordingPlan, wordingFingerprint } from "./question-wording-plan.mjs";

const insist = (condition, message) => { if (!condition) throw new Error(message); };
const variantKey = (value) => `${value.familyId}:${value.level}`;

export function validateWordingPlan(plan) {
  insist(plan?.schema === "learnordie.question-wording-plan.v1" && plan.fullyReviewed === true, "A complete reviewed plan is required");
  insist(Array.isArray(plan.changes) && plan.changes.length > 0, "Empty review plan");
  const families = new Map();
  for (const change of plan.changes) {
    const family = families.get(change.familyId) ?? { familyId: change.familyId, variants: [] };
    family.variants.push({ ...change.replacement, level: change.level, expectedFingerprint: change.expectedFingerprint, reason: change.reason });
    families.set(change.familyId, family);
  }
  const validated = buildWordingPlan({
    lectureId: plan.lectureId,
    questions: plan.changes.map((change) => ({ ...change.expected, familyId: change.familyId, level: change.level })),
  }, { lectureId: plan.lectureId, families: [...families.values()] });
  insist(plan.totalFamilies === validated.totalFamilies && plan.reviewedFamilies === validated.reviewedFamilies, "Review coverage metadata mismatch");
  return validated;
}

function storedWording(row) {
  insist(Array.isArray(row.answers_json), "Malformed stored answers");
  return {
    text: row.text, explanation: row.explanation,
    answers: row.answers_json.map((answer) => {
      const correct = answer.key === row.correct_answer_key;
      insist(answer.correct === undefined || answer.correct === correct, "Stored grading keys disagree");
      return { key: answer.key, text: answer.text, correct };
    }),
  };
}

/** Owner-scoped maintenance transaction. Dry-run is the default; application requires a durable backup sink. */
export async function applyQuestionWording(sql, input, options = {}) {
  const plan = validateWordingPlan(input);
  insist(typeof options.ownerEmail === "string" && options.ownerEmail.trim(), "Owner email required");
  insist(typeof options.publicToken === "string" && options.publicToken.trim(), "Exact public token required");
  insist(options.apply === undefined || typeof options.apply === "boolean", "Invalid apply option");
  if (options.apply) insist(typeof options.backup === "function", "Application requires a durable backup");
  const digest = createHash("sha256").update(JSON.stringify(plan)).digest("hex");
  const version = `standalone-review-v1:${digest.slice(0, 16)}`;
  return sql.begin(async (tx) => {
    await tx`SET LOCAL lock_timeout = '3s'`;
    await tx`SET LOCAL statement_timeout = '10s'`;
    await tx`SET LOCAL idle_in_transaction_session_timeout = '15s'`;
    // Same lecture -> session order as presenter commands. NO KEY UPDATE lets an
    // answer already holding the session finish its lecture FK checks first.
    const [lecture] = await tx`
      SELECT l.id, l.public_token, l.title FROM lectures l
      JOIN lecture_series s ON s.id = l.series_id JOIN users u ON u.id = s.owner_id
      WHERE l.id = ${plan.lectureId} AND l.public_token = ${options.publicToken}
        AND lower(u.email) = ${options.ownerEmail.trim().toLowerCase()}
      FOR NO KEY UPDATE OF l`;
    insist(lecture, "Lecture token or owner mismatch");
    const [session] = await tx`SELECT status, round FROM live_sessions WHERE lecture_id = ${plan.lectureId} FOR UPDATE`;
    insist(!session || session.status === "ended", "End the live session before changing its question bank");
    // Now no in-flight answer can hold the session while asking for a lecture FK
    // lock. Upgrade to also exclude new family inserts during the exact inventory check.
    await tx`SELECT id FROM lectures WHERE id = ${plan.lectureId} FOR UPDATE`;
    const currentFamilies = await tx`SELECT id FROM questions WHERE lecture_id = ${plan.lectureId} ORDER BY id FOR UPDATE`;
    const requestedFamilies = new Set(plan.changes.map((change) => change.familyId));
    insist(currentFamilies.length === requestedFamilies.size && currentFamilies.every((family) => requestedFamilies.has(family.id)), "Stored family inventory changed; review it again");
    const rows = await tx`
      SELECT v.* FROM question_variants v JOIN questions q ON q.id = v.question_id
      WHERE q.lecture_id = ${plan.lectureId} ORDER BY q.id, v.level, v.id FOR UPDATE OF v`;
    insist(rows.length === plan.changes.length, "Stored variant inventory changed; review it again");
    const indexed = new Map();
    for (const row of rows) {
      const key = variantKey({ familyId: row.question_id, level: row.level });
      insist(!indexed.has(key), "Duplicate stored family level");
      indexed.set(key, row);
    }
    const states = plan.changes.map((change) => {
      const row = indexed.get(variantKey(change));
      insist(row, "Stored reviewed variant missing");
      const fingerprint = wordingFingerprint(storedWording(row));
      if (fingerprint === wordingFingerprint(change.replacement) && row.prompt_version === version) return "applied";
      if (fingerprint === change.expectedFingerprint) return "original";
      throw new Error("Stored wording changed; refusing to overwrite a newer edit");
    });
    insist(new Set(states).size === 1, "Mixed original/applied state; inspect before proceeding");
    if (states[0] === "applied") return { status: "already-applied", lectureId: plan.lectureId, variants: rows.length, digest };
    if (!options.apply) return { status: "dry-run", lectureId: plan.lectureId, variants: rows.length, digest };
    await options.backup({ schema: "learnordie.question-wording-backup.v1", transactionCommitted: false, lecture, digest, rows });
    for (const change of plan.changes) {
      const row = indexed.get(variantKey(change));
      const replacements = new Map(change.replacement.answers.map((answer) => [answer.key, answer.text]));
      const answers = row.answers_json.map((answer) => ({ ...answer, text: replacements.get(answer.key) }));
      const updated = await tx`
        UPDATE question_variants SET text = ${change.replacement.text}, explanation = ${change.replacement.explanation},
          answers_json = ${tx.json(answers)}, prompt_version = ${version}
        WHERE id = ${row.id} RETURNING *`;
      insist(updated.length === 1, "Variant disappeared during update");
      const after = updated[0];
      const immutable = (value) => Object.fromEntries(Object.entries(value).filter(([key]) => !["text", "explanation", "answers_json", "prompt_version"].includes(key)));
      insist(JSON.stringify(immutable(after)) === JSON.stringify(immutable(row)), "Unexpected grading or identity change");
      insist(wordingFingerprint(storedWording(after)) === wordingFingerprint(change.replacement), "Stored replacement differs from review");
    }
    return { status: "applied", lectureId: plan.lectureId, variants: rows.length, digest };
  });
}
