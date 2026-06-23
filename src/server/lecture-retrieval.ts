import { and, eq, isNotNull, sql } from "drizzle-orm";

import type { Lecture } from "@/lib/types";
import { getEmbeddingProvider } from "@/server/providers/embeddings";
import { getDb } from "./db/client";
import { assetChunks } from "./db/schema";

export type RetrievedLectureSource = {
  id: string;
  sourceRef: string;
  content: string;
  score: number;
  retrievalMethod: "vector" | "text";
};

const STOPWORDS = new Set([
  "aber",
  "also",
  "auf",
  "aus",
  "bei",
  "das",
  "den",
  "der",
  "die",
  "ein",
  "eine",
  "einem",
  "einen",
  "einer",
  "erkläre",
  "fuer",
  "für",
  "ich",
  "ist",
  "mit",
  "mir",
  "und",
  "was",
  "wie",
  "zur"
]);

const MAX_SOURCE_CHARS = 320;

function terms(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9äöüß]+/i)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3 && !STOPWORDS.has(term));
}

function scoreSource(queryTerms: string[], source: Pick<RetrievedLectureSource, "sourceRef" | "content">) {
  const haystack = `${source.sourceRef} ${source.content}`
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
  return queryTerms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

function compactSourceContent(value: string) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > MAX_SOURCE_CHARS ? `${compact.slice(0, MAX_SOURCE_CHARS - 3)}...` : compact;
}

async function postgresSources(lectureId: string, query: string, limit: number) {
  const embedding = await getEmbeddingProvider().embedText(query);
  const vectorLiteral = `[${embedding.join(",")}]`;
  const distanceSql = sql<number>`${assetChunks.embedding} <=> ${vectorLiteral}::vector`;
  const rows = await getDb()
    .select({
      id: assetChunks.id,
      sourceRef: assetChunks.sourceRef,
      content: assetChunks.content,
      distance: distanceSql
    })
    .from(assetChunks)
    .where(and(eq(assetChunks.lectureId, lectureId), isNotNull(assetChunks.embedding)))
    .orderBy(distanceSql)
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    sourceRef: row.sourceRef,
    content: compactSourceContent(row.content),
    score: Number((1 - Number(row.distance ?? 1)).toFixed(4)),
    retrievalMethod: "vector" as const
  }));
}

function localSources(lecture: Lecture) {
  return (lecture.materials ?? [])
    .filter((material) => material.extractedTextPreview || material.sourceRefs?.length)
    .map((material, index) => ({
      id: material.id,
      sourceRef: material.sourceRefs?.[0] ?? material.originalName,
      content: compactSourceContent(material.extractedTextPreview ?? material.originalName),
      score: 0 - index / 100,
      retrievalMethod: "text" as const
    }));
}

export async function retrieveLectureSources(input: {
  lecture: Lecture;
  query: string;
  limit?: number;
}): Promise<RetrievedLectureSource[]> {
  const queryTerms = terms(input.query);
  const limit = input.limit ?? 3;
  const vectorCandidates =
    process.env.LEARNBUDDY_REPOSITORY !== "local" && process.env.DATABASE_URL
      ? await postgresSources(input.lecture.id, input.query, limit)
      : [];
  if (vectorCandidates.length > 0) return vectorCandidates;

  const candidates = localSources(input.lecture);

  return candidates
    .map((source, index) => ({
      ...source,
      score: scoreSource(queryTerms, source) || source.score || 0 - index / 100
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}
