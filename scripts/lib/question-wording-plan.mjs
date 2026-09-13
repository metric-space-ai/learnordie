import { createHash } from "node:crypto";

const levels = ["4.0", "3.0", "2.0", "1.0"];
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const sourceDependency = /\b(?:abschn\.?|abschnitt|kapitel|folie|seite|aufgabe)\s*\d|\b(?:skript|manuskript)\b|\b(?:laut|nach|gemäß)\s+(?:(?:der|dem|dieser|diesem)\s+)?(?:folie|demo|vorlesung)\b/iu;

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function wording(value, field, limit, standalone) {
  requireValue(typeof value === "string" && value.trim().length > 0 && value.length <= limit, `Invalid ${field}`);
  requireValue(!standalone || !sourceDependency.test(value), `Source-dependent ${field}`);
  return value;
}

function snapshot(question, standalone = false) {
  requireValue(Array.isArray(question.answers) && question.answers.length === 4, "Four answers required");
  const answers = question.answers.map((answer) => {
    requireValue(["A", "B", "C", "D"].includes(answer.key) && typeof answer.correct === "boolean", "Invalid answer key or correctness");
    return { key: answer.key, text: wording(answer.text, "answer", 1000, standalone), correct: answer.correct };
  }).sort((a, b) => a.key.localeCompare(b.key));
  requireValue(new Set(answers.map((answer) => answer.key)).size === 4, "Duplicate answer key");
  requireValue(new Set(answers.map((answer) => answer.text.trim().toLocaleLowerCase("de"))).size === 4, "Duplicate answer text");
  requireValue(answers.filter((answer) => answer.correct).length === 1, "One correct answer required");
  return {
    text: wording(question.text, "question", 1200, standalone),
    answers,
    explanation: wording(question.explanation, "explanation", 3000, standalone),
  };
}

export function wordingFingerprint(value) {
  return createHash("sha256").update(JSON.stringify(snapshot(value))).digest("hex");
}

/** Compile a private, optimistic review plan; never connects to or mutates a database. */
export function buildWordingPlan(inventory, review) {
  requireValue(uuid.test(inventory?.lectureId ?? ""), "Lecture UUID required");
  requireValue(review?.lectureId === inventory.lectureId, "Lecture mismatch");
  requireValue(Array.isArray(inventory.questions) && inventory.questions.length > 0, "Inventory required");
  requireValue(Array.isArray(review.families) && review.families.length > 0, "Reviewed families required");
  const index = new Map();
  for (const question of inventory.questions) {
    requireValue(uuid.test(question.familyId ?? "") && levels.includes(question.level), "Invalid family or level");
    const key = `${question.familyId}:${question.level}`;
    requireValue(!index.has(key), "Duplicate inventory variant");
    index.set(key, question);
  }
  const reviewed = new Set();
  const changes = [];
  for (const family of review.families) {
    requireValue(uuid.test(family.familyId ?? "") && !reviewed.has(family.familyId), "Invalid or duplicate reviewed family");
    reviewed.add(family.familyId);
    requireValue(Array.isArray(family.variants) && family.variants.length === 4, "Review every level together");
    requireValue(new Set(family.variants.map((variant) => variant.level)).size === 4, "Duplicate reviewed level");
    for (const variant of family.variants) {
      const current = index.get(`${family.familyId}:${variant.level}`);
      requireValue(current, "Reviewed variant absent from inventory");
      requireValue(typeof variant.expectedFingerprint === "string" && variant.expectedFingerprint === wordingFingerprint(current), "Stale review fingerprint");
      const expected = snapshot(current);
      const replacement = snapshot({ ...current, ...variant }, true);
      requireValue(replacement.answers.every((answer, i) => answer.correct === expected.answers[i].correct), "Wording review must preserve answer keys and scoring");
      changes.push({
        familyId: family.familyId,
        level: variant.level,
        expectedFingerprint: variant.expectedFingerprint,
        expected,
        replacement,
        reason: wording(variant.reason, "review reason", 1000, false),
      });
    }
  }
  return {
    schema: "learnordie.question-wording-plan.v1",
    lectureId: inventory.lectureId,
    reviewedFamilies: reviewed.size,
    totalFamilies: new Set(inventory.questions.map((question) => question.familyId)).size,
    fullyReviewed: reviewed.size === new Set(inventory.questions.map((question) => question.familyId)).size,
    databaseApplied: false,
    changes,
  };
}
