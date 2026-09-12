import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { slideDocumentToLegacySlides } from "@learnordie/slide-engine/legacy";
import { createModelDemoDocument, MODEL_DEMO_KEY, MODEL_DEMO_SERIES_TITLE, MODEL_DEMO_TITLE } from "@/lib/model-demo-template";
import { getDb } from "./db/client";

export type ModelDemoResult = { lectureId: string; created: boolean };

function scopedId(ownerEmail: string, resource: string) {
  const bytes = createHash("sha256").update(JSON.stringify([MODEL_DEMO_KEY, ownerEmail, resource])).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// This service is called only by the explicit authenticated POST. It deliberately
// bypasses repository initialization/createLecture, which can seed unrelated data.
// Stable IDs survive title/content edits. The transaction lock serializes requests
// across server instances; primary keys are a second duplicate/collision guard.
export async function ensureModelDemo(ownerEmail: string, database = getDb()): Promise<ModelDemoResult> {
  const owner = ownerEmail.trim().toLowerCase();
  if (!owner) throw new Error("Model demo requires an authenticated owner.");
  const lectureId = scopedId(owner, "lecture");
  const seriesId = scopedId(owner, "series");
  const document = createModelDemoDocument(lectureId, Array.from({ length: 8 }, (_, i) => scopedId(owner, `slide:${i}`)));
  const legacySlides = slideDocumentToLegacySlides(document);

  return database.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lectureId}, 0))`);
    const existing = await tx.execute(sql`
      select l.id from lectures l
      join lecture_series s on s.id = l.series_id
      join users u on u.id = s.owner_id
      where l.id = ${lectureId}::uuid and u.email = ${owner}
      limit 1
    `);
    if (existing.length) return { lectureId, created: false };

    await tx.execute(sql`insert into users (email, role) values (${owner}, 'lecturer') on conflict (email) do nothing`);
    // Never adopt another owner's or an unowned series with a matching title.
    // Reuse only our stable series after deletion of its demo lecture.
    await tx.execute(sql`
      insert into lecture_series (id, title, language, owner_id)
      select ${seriesId}::uuid, ${MODEL_DEMO_SERIES_TITLE}, 'de', id from users where email = ${owner}
      on conflict (id) do nothing
    `);
    const ownedSeries = await tx.execute(sql`
      select s.id from lecture_series s join users u on u.id = s.owner_id
      where s.id = ${seriesId}::uuid and u.email = ${owner} limit 1
    `);
    if (!ownedSeries.length) throw new Error("Model demo series ownership mismatch.");
    await tx.execute(sql`
      insert into lectures (id, series_id, public_token, title, status, leaderboard_enabled, slide_document_json)
      values (${lectureId}::uuid, ${seriesId}::uuid, ${randomUUID()}, ${MODEL_DEMO_TITLE}, 'draft', false, ${JSON.stringify(document)}::jsonb)
    `);
    for (const [index, slide] of legacySlides.entries()) {
      const { eyebrow, topic, copy, diagram } = slide;
      await tx.execute(sql`
        insert into slides (id, lecture_id, position, title, content_json)
        values (${slide.id}::uuid, ${lectureId}::uuid, ${index + 1}, ${slide.title}, ${JSON.stringify({ eyebrow, topic, copy, diagram })}::jsonb)
      `);
    }
    return { lectureId, created: true };
  });
}
