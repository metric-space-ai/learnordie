import { createHash } from "node:crypto";

const canonical = value => value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const originalUpgradeDigest = value => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const insist = (condition, message) => { if (!condition) throw new Error(message); };
const same = (a, b) => originalUpgradeDigest(a) === originalUpgradeDigest(b);
const metadata = (row, excluded) => Object.fromEntries(Object.entries(row).filter(([key]) => !excluded.includes(key)));

/** The caller supplies the reviewed source planner and canonical legacy projection.
 * No question, answer, identity, session, or grading rows are ever written here.
 */
export async function upgradeOriginalSlides(sql, options) {
  insist(options.lectureId && options.publicToken && options.ownerEmail, "Exact lecture and owner required");
  insist(typeof options.plan === "function" && typeof options.project === "function", "Reviewed planner and projection required");
  insist(!options.apply || (typeof options.backup === "function" && options.expectedDigest), "Application requires backup and inspected digest");
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
    const [session] = await tx`SELECT status, round FROM live_sessions WHERE lecture_id=${lecture.id} FOR UPDATE`;
    insist(!session || (session.status === "ended" && !session.round), "End the live session before upgrading slides");
    const rows = await tx`SELECT * FROM slides WHERE lecture_id=${lecture.id} ORDER BY position FOR UPDATE`;
    const original = lecture.slide_document_json;
    insist(original?.slides?.length === 8 && rows.length === 8, "Expected eight existing original slides");
    insist(same(rows.map(row => row.id), original.slides.map(slide => slide.id)), "Persisted slide identity/order mismatch");
    const plan = options.plan(original);
    insist(["ready", "noop"].includes(plan.status) && plan.conflicts?.length === 0, "Resolve source conflicts before migration");
    const next = plan.document;
    insist(next?.createdBy?.promptVersion === "learnordie:model-original:clean-v1", "Expected complete original source document");
    insist(same(next.slides.map(slide => slide.id), rows.map(row => row.id)), "Upgrade changed slide IDs or order");
    insist(next.slides.every(slide => slide.canvas), "All eight slides require a native canvas");
    const projected = options.project(next, rows);
    insist(same(projected.map(slide => slide.id), rows.map(row => row.id)), "Projection changed slide IDs or order");
    const originalDigest = originalUpgradeDigest({ document: original, slides: rows });
    const receipt = { lectureId: lecture.id, originalDigest, documentDigest: originalUpgradeDigest(next), slides: 8,
      coverage: plan.coverage.length, projectionDigest: originalUpgradeDigest(projected) };
    if (options.expectedDigest) insist(options.expectedDigest === originalDigest, "Source changed since inspection");
    if (!options.apply) return { ...receipt, status: "dry-run" };
    await options.backup({ schema: "learnordie.original-slide-backup.v1", transactionCommitted: false, lecture, slides: rows, receipt });
    const [updated] = await tx`UPDATE lectures SET slide_document_json=${tx.json(next)} WHERE id=${lecture.id} RETURNING *`;
    insist(updated && same(updated.slide_document_json, next), "Native document read-back differs");
    insist(same(metadata(updated, ["slide_document_json"]), metadata(lecture, ["slide_document_json"])), "Unexpected lecture metadata change");
    for (const [index, slide] of projected.entries()) {
      const title = slide.title.trim();
      const content = { eyebrow: slide.eyebrow.trim(), topic: slide.topic.trim(), copy: slide.copy.map(line => line.trim()).filter(Boolean).slice(0, 4),
        diagram: ["formula", "ramp"].includes(slide.diagram) ? slide.diagram : "bearing" };
      const [written] = await tx`UPDATE slides SET title=${title}, content_json=${tx.json(content)}
        WHERE id=${slide.id} AND lecture_id=${lecture.id} RETURNING *`;
      insist(written && written.title === title && same(written.content_json, content), "Legacy slide read-back differs");
      insist(same(metadata(written, ["title", "content_json"]), metadata(rows[index], ["title", "content_json"])), "Unexpected slide identity or metadata change");
    }
    return { ...receipt, status: "applied" };
  });
}
