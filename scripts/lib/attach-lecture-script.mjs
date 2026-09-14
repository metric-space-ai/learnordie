import { createHash } from "node:crypto";

const canonical = value => value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = value => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
export class LectureScriptMaintenanceError extends Error {}
const insist = (condition, message) => { if (!condition) throw new LectureScriptMaintenanceError(message); };

export function appendLectureScript(document, asset) {
  insist(document?.schemaVersion === "learnordie.slide.v1" && Array.isArray(document.slides) && document.slides.length > 0, "Existing native slide document required");
  insist(Array.isArray(document.assets), "Existing asset inventory required");
  insist(asset?.kind === "sourceDocument" && typeof asset.id === "string" &&
    ["text/plain", "text/markdown"].includes(asset.structuredData?.format) &&
    typeof asset.structuredData.text === "string" && asset.structuredData.text.trim().length > 0,
  "Nonempty plain-text manuscript required");
  const existing = document.assets.filter(item => item.id === asset.id);
  insist(existing.length <= 1, "Duplicate manuscript ID; inspect before proceeding");
  if (existing.length) {
    insist(digest(existing[0]) === digest(asset), "Existing manuscript differs; refusing to overwrite it");
    return document;
  }
  return { ...document, assets: [...document.assets, asset] };
}

/** Add a source only; never recreate a lecture, replace a slide or touch grading. */
export async function attachLectureScript(sql, options) {
  insist(options.lectureId && options.publicToken && options.ownerEmail, "Exact lecture and owner required");
  insist(!options.apply || typeof options.backup === "function", "Application requires a durable backup");
  return sql.begin(async tx => {
    await tx`SET LOCAL lock_timeout = '3s'`;
    await tx`SET LOCAL statement_timeout = '10s'`;
    await tx`SET LOCAL idle_in_transaction_session_timeout = '15s'`;
    const [lecture] = await tx`SELECT l.* FROM lectures l
      JOIN lecture_series s ON s.id=l.series_id JOIN users u ON u.id=s.owner_id
      WHERE l.id=${options.lectureId} AND l.public_token=${options.publicToken}
        AND lower(u.email)=${options.ownerEmail.trim().toLowerCase()}
      FOR NO KEY UPDATE OF l`;
    insist(lecture, "Lecture token or owner mismatch");
    const [session] = await tx`SELECT status FROM live_sessions WHERE lecture_id=${options.lectureId} FOR UPDATE`;
    insist(!session || session.status === "ended", "End the live session before attaching the manuscript");
    const original = lecture.slide_document_json;
    const next = appendLectureScript(original, options.asset);
    const receipt = { lectureId: lecture.id, manuscriptChars: options.asset.structuredData.text.length,
      originalDigest: digest(original), documentDigest: digest(next), slides: next.slides.length };
    if (next === original) return { ...receipt, status: "already-applied" };
    if (!options.apply) return { ...receipt, status: "dry-run" };
    await options.backup({ schema: "learnordie.lecture-script-backup.v1", transactionCommitted: false, lecture, receipt });
    const [updated] = await tx`UPDATE lectures SET slide_document_json=${tx.json(next)} WHERE id=${lecture.id} RETURNING *`;
    insist(updated && digest(updated.slide_document_json) === receipt.documentDigest, "Manuscript read-back differs");
    const metadata = row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "slide_document_json"));
    insist(digest(metadata(updated)) === digest(metadata(lecture)), "Unexpected lecture metadata change");
    insist(digest(updated.slide_document_json.slides) === digest(original.slides), "Unexpected slide change");
    return { ...receipt, status: "applied" };
  });
}
