import { createHash } from "node:crypto";

export class TranscriptPurgeError extends Error {}
const requireThat = (condition, message) => { if (!condition) throw new TranscriptPurgeError(message); };
const digest = rows => createHash("sha256").update(JSON.stringify(rows)).digest("hex");

/** Explicit, bounded privacy deletion after an ended session. Never logs or backs up speech. */
export async function purgeSessionTranscripts(sql, options) {
  requireThat(options.publicToken && options.ownerEmail && options.sessionId && options.title, "Exact lecture, owner, title and session required");
  requireThat(!options.apply || options.expectedDigest, "Apply requires an inspected target digest");
  return sql.begin(async tx => {
    await tx`SET LOCAL lock_timeout = '3s'`;
    await tx`SET LOCAL statement_timeout = '10s'`;
    await tx`SET LOCAL idle_in_transaction_session_timeout = '15s'`;
    const [lecture] = await tx`SELECT l.id, l.title FROM lectures l
      JOIN lecture_series s ON s.id=l.series_id JOIN users u ON u.id=s.owner_id
      WHERE l.public_token=${options.publicToken} AND lower(u.email)=${options.ownerEmail.trim().toLowerCase()}
      FOR NO KEY UPDATE OF l`;
    requireThat(lecture?.title === options.title, "Lecture or owner mismatch");
    const [session] = await tx`SELECT session_id, status, started_at, updated_at, round FROM live_sessions WHERE lecture_id=${lecture.id} FOR UPDATE`;
    requireThat(session?.session_id === options.sessionId && session.status === "ended" && !session.round, "Exact ended session required");
    const rows = await tx`SELECT id, text, provider, started_at, ended_at, created_at FROM transcript_segments
      WHERE lecture_id=${lecture.id} ORDER BY id FOR UPDATE`;
    // This operation is deliberately only for a single-session QA lecture.
    // Refuse mixed/older data instead of treating all lecture speech as the target.
    requireThat(rows.length <= 30, "Too many segments; inspect scope before deletion");
    const start = +new Date(session.started_at), end = +new Date(session.updated_at);
    requireThat(Number.isFinite(start) && Number.isFinite(end) && end >= start, "Invalid session window");
    requireThat(rows.every(row => row.provider === "minimax-asr-1.0" &&
      +new Date(row.started_at) >= start && +new Date(row.ended_at) >= +new Date(row.started_at) &&
      +new Date(row.ended_at) <= end && +new Date(row.created_at) >= start && +new Date(row.created_at) <= end + 30_000),
    "Segments outside the confirmed capture window");
    const sourceTitles = rows.map(row => `Transkript: ${row.text.slice(0, 64)}${row.text.length > 64 ? "..." : ""}`);
    const drafts = sourceTitles.length ? await tx`SELECT id, status, created_at, source_title, variants_json FROM question_review_items
      WHERE lecture_id=${lecture.id} AND source_title IN ${tx(sourceTitles)} ORDER BY id FOR UPDATE` : [];
    requireThat(drafts.every(row => row.status === "draft" && +new Date(row.created_at) >= start && +new Date(row.created_at) <= end + 30_000),
      "A derived review has been edited or published; refusing deletion");
    const [before] = await tx`SELECT (SELECT count(*)::int FROM questions WHERE lecture_id=${lecture.id}) AS questions,
      (SELECT count(*)::int FROM slides WHERE lecture_id=${lecture.id}) AS slides`;
    const targetDigest = digest({ lectureId: lecture.id, sessionId: session.session_id, rows, drafts });
    const receipt = { lectureId: lecture.id, sessionId: session.session_id, targetDigest, segments: rows.length,
      unpublishedDrafts: drafts.length, speechBackedUp: false, questions: before.questions, slides: before.slides };
    if (!options.apply) return { ...receipt, status: "dry-run" };
    requireThat(targetDigest === options.expectedDigest, "Targets changed after inspection");
    if (drafts.length) {
      const deleted = await tx`DELETE FROM question_review_items WHERE lecture_id=${lecture.id} AND status='draft' AND id IN ${tx(drafts.map(row => row.id))} RETURNING id`;
      requireThat(deleted.length === drafts.length, "Draft deletion count mismatch");
    }
    if (rows.length) {
      const deleted = await tx`DELETE FROM transcript_segments WHERE lecture_id=${lecture.id} AND id IN ${tx(rows.map(row => row.id))} RETURNING id`;
      requireThat(deleted.length === rows.length, "Transcript deletion count mismatch");
    }
    const [after] = await tx`SELECT (SELECT count(*)::int FROM transcript_segments WHERE lecture_id=${lecture.id}) AS transcripts,
      (SELECT count(*)::int FROM questions WHERE lecture_id=${lecture.id}) AS questions,
      (SELECT count(*)::int FROM slides WHERE lecture_id=${lecture.id}) AS slides`;
    requireThat(after.transcripts === 0 && after.questions === before.questions && after.slides === before.slides,
      "Read-back differs from intended transcript-only cleanup");
    return { ...receipt, status: "deleted", remainingSegments: after.transcripts };
  });
}
