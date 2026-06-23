import crypto from "node:crypto";

import { and, asc, eq, isNull, lte, or } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import {
  lectures,
  materialProcessingRuns,
  standaloneExportJobs,
  standaloneExports
} from "@/server/db/schema";
import { PostgresLectureRepository } from "@/server/postgres-repository";
import { getStorageProvider } from "@/server/providers/storage";
import { configuredPublicAppUrl } from "@/server/runtime-config";
import { nextWorkerRetryAt, normalizeWorkerLimit } from "@/server/worker-policy";

type QueuedJobResult = {
  kind: "material_processing" | "standalone_archive";
  id: string;
  status: "succeeded" | "failed" | "skipped" | "retrying" | "dead_letter";
  message: string;
};

function sha256(input: Buffer) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function safeFileName(input: string) {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "learnbuddy-archive";
}

function queuedProviderName() {
  const selected = process.env.LEARNBUDDY_JOB_PROVIDER?.trim().toLowerCase();
  return selected ?? "";
}

export function isDatabaseJobQueueEnabled() {
  const selected = queuedProviderName();
  return selected === "database" || selected === "queue" || selected === "worker" || selected === "async";
}

function appUrl() {
  const configured = process.env.LEARNBUDDY_WORKER_APP_URL?.trim() || configuredPublicAppUrl();
  if (!configured) {
    throw new Error("LEARNBUDDY_WORKER_APP_URL, NEXT_PUBLIC_APP_URL or VERCEL_URL is required for queued archive jobs.");
  }
  return configured.replace(/\/+$/, "");
}

function safeWorkerMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (
    message.includes("LEARNBUDDY_") ||
    message.includes("Job provider") ||
    message.includes("Storage provider") ||
    message.includes("fetch failed") ||
    message.includes("Failed to parse URL") ||
    message.includes("Export route returned")
  ) {
    return "Archivjob konnte nicht gestartet werden.";
  }
  return message || "Archiv konnte nicht erzeugt werden.";
}

function retryMessage(kind: QueuedJobResult["kind"], attemptCount: number, maxAttempts: number, nextAttemptAt: Date) {
  const subject = kind === "material_processing" ? "Materialverarbeitung" : "Archivjob";
  return `${subject} fehlgeschlagen. Neuer Versuch ${attemptCount + 1}/${maxAttempts} ab ${nextAttemptAt.toISOString()}.`;
}

function deadLetterMessage(kind: QueuedJobResult["kind"], maxAttempts: number) {
  const subject = kind === "material_processing" ? "Materialverarbeitung" : "Archivjob";
  return `${subject} nach ${maxAttempts} Versuchen gestoppt. Manuelle Prüfung erforderlich.`;
}

async function scheduleMaterialRetryOrDeadLetter(id: string): Promise<QueuedJobResult> {
  const db = getDb();
  const [run] = await db.select().from(materialProcessingRuns).where(eq(materialProcessingRuns.id, id)).limit(1);
  if (!run) {
    return { kind: "material_processing", id, status: "failed", message: "Materialverarbeitung nicht gefunden." };
  }

  const attemptCount = Math.max(1, run.attemptCount);
  const maxAttempts = Math.max(1, run.maxAttempts);
  const now = new Date();
  if (attemptCount < maxAttempts) {
    const nextAttemptAt = nextWorkerRetryAt(attemptCount, now);
    const message = retryMessage("material_processing", attemptCount, maxAttempts, nextAttemptAt);
    await db.update(materialProcessingRuns).set({
      status: "queued",
      message,
      nextAttemptAt,
      completedAt: null,
      durationMs: null
    }).where(eq(materialProcessingRuns.id, id));
    return { kind: "material_processing", id, status: "retrying", message };
  }

  const message = deadLetterMessage("material_processing", maxAttempts);
  await db.update(materialProcessingRuns).set({
    status: "dead_letter",
    message,
    nextAttemptAt: null,
    deadLetterAt: now,
    completedAt: now,
    durationMs: now.getTime() - run.startedAt.getTime()
  }).where(eq(materialProcessingRuns.id, id));

  return { kind: "material_processing", id, status: "dead_letter", message };
}

async function scheduleArchiveRetryOrDeadLetter(id: string): Promise<QueuedJobResult> {
  const db = getDb();
  const [job] = await db.select().from(standaloneExportJobs).where(eq(standaloneExportJobs.id, id)).limit(1);
  if (!job) return { kind: "standalone_archive", id, status: "failed", message: "Archivjob nicht gefunden." };

  const attemptCount = Math.max(1, job.attemptCount);
  const maxAttempts = Math.max(1, job.maxAttempts);
  const now = new Date();
  if (attemptCount < maxAttempts) {
    const nextAttemptAt = nextWorkerRetryAt(attemptCount, now);
    const message = retryMessage("standalone_archive", attemptCount, maxAttempts, nextAttemptAt);
    await db.update(standaloneExportJobs).set({
      status: "queued",
      message,
      nextAttemptAt,
      completedAt: null,
      durationMs: null
    }).where(eq(standaloneExportJobs.id, id));
    return { kind: "standalone_archive", id, status: "retrying", message };
  }

  const message = deadLetterMessage("standalone_archive", maxAttempts);
  await db.update(standaloneExportJobs).set({
    status: "dead_letter",
    message,
    nextAttemptAt: null,
    deadLetterAt: now,
    completedAt: now,
    durationMs: job.startedAt ? now.getTime() - job.startedAt.getTime() : null
  }).where(eq(standaloneExportJobs.id, id));
  return { kind: "standalone_archive", id, status: "dead_letter", message };
}

async function runQueuedMaterialJob(id: string): Promise<QueuedJobResult> {
  try {
    await new PostgresLectureRepository().executeMaterialProcessingRun(id);
    return {
      kind: "material_processing",
      id,
      status: "succeeded",
      message: "Materialverarbeitung abgeschlossen."
    };
  } catch {
    return scheduleMaterialRetryOrDeadLetter(id);
  }
}

async function runQueuedArchiveJob(id: string): Promise<QueuedJobResult> {
  const db = getDb();
  const [job] = await db.select().from(standaloneExportJobs).where(eq(standaloneExportJobs.id, id)).limit(1);
  if (!job || (job.status !== "queued" && job.status !== "running")) {
    return { kind: "standalone_archive", id, status: "skipped", message: "Kein wartender Archivjob gefunden." };
  }

  const [lecture] = await db.select().from(lectures).where(eq(lectures.id, job.lectureId)).limit(1);
  if (!lecture) {
    return { kind: "standalone_archive", id, status: "skipped", message: "Vorlesung nicht gefunden." };
  }

  const startedAt = job.startedAt ?? new Date();
  await db.update(standaloneExportJobs).set({
    status: "running",
    provider: "database",
    providerJobId: job.providerJobId ?? `database:standalone_archive:${job.id}`,
    startedAt,
    message: "Archiv wird durch Worker erzeugt."
  }).where(eq(standaloneExportJobs.id, job.id));

  try {
    const exportUrl = new URL(`/api/lecture/${lecture.publicToken}/export`, appUrl());
    exportUrl.searchParams.set("format", "zip");
    exportUrl.searchParams.set("record", "0");
    const response = await fetch(exportUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Export route returned ${response.status}`);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    const version = response.headers.get("x-learnbuddy-export-version") ?? `standalone-archive-v1-${Date.now()}`;
    const checksum = response.headers.get("x-learnbuddy-sha256") ?? sha256(bytes);
    const storage = await getStorageProvider().putBytes(
      `lectures/${lecture.id}/exports/${safeFileName(`${lecture.publicToken}-${version}.zip`)}`,
      bytes,
      "application/zip"
    );
    const [exportRecord] = await db.insert(standaloneExports).values({
      lectureId: lecture.id,
      version,
      storageUrl: storage.url,
      sha256: checksum
    }).returning();
    const completedAt = new Date();
    await db.update(standaloneExportJobs).set({
      status: "succeeded",
      standaloneExportId: exportRecord.id,
      storageUrl: storage.url,
      sha256: checksum,
      completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      message: "Archiv gespeichert."
    }).where(eq(standaloneExportJobs.id, job.id));

    return {
      kind: "standalone_archive",
      id,
      status: "succeeded",
      message: "Archiv gespeichert."
    };
  } catch (error) {
    const completedAt = new Date();
    const message = safeWorkerMessage(error);
    await db.update(standaloneExportJobs).set({
      status: "failed",
      completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      message
    }).where(eq(standaloneExportJobs.id, job.id));
    return scheduleArchiveRetryOrDeadLetter(id);
  }
}

async function claimNextQueuedMaterialRun() {
  const db = getDb();
  const [run] = await db
    .select()
    .from(materialProcessingRuns)
    .where(and(
      eq(materialProcessingRuns.status, "queued"),
      or(isNull(materialProcessingRuns.nextAttemptAt), lte(materialProcessingRuns.nextAttemptAt, new Date()))
    ))
    .orderBy(asc(materialProcessingRuns.nextAttemptAt), asc(materialProcessingRuns.startedAt))
    .limit(1);
  if (!run) return null;

  const nextAttemptCount = run.attemptCount + 1;
  const [claimed] = await db.update(materialProcessingRuns).set({
    status: "running",
    attemptCount: nextAttemptCount,
    provider: run.provider ?? "database",
    providerJobId: run.providerJobId ?? `database:material_processing:${run.id}`,
    nextAttemptAt: null,
    message: "Materialverarbeitung läuft."
  }).where(and(
    eq(materialProcessingRuns.id, run.id),
    eq(materialProcessingRuns.status, "queued")
  )).returning();

  return claimed ?? null;
}

async function claimNextQueuedArchiveJob() {
  const db = getDb();
  const [job] = await db
    .select()
    .from(standaloneExportJobs)
    .where(and(
      eq(standaloneExportJobs.status, "queued"),
      or(isNull(standaloneExportJobs.nextAttemptAt), lte(standaloneExportJobs.nextAttemptAt, new Date()))
    ))
    .orderBy(asc(standaloneExportJobs.nextAttemptAt), asc(standaloneExportJobs.createdAt))
    .limit(1);
  if (!job) return null;

  const nextAttemptCount = job.attemptCount + 1;
  const [claimed] = await db.update(standaloneExportJobs).set({
    status: "running",
    attemptCount: nextAttemptCount,
    provider: job.provider ?? "database",
    providerJobId: job.providerJobId ?? `database:standalone_archive:${job.id}`,
    nextAttemptAt: null,
    startedAt: job.startedAt ?? new Date(),
    message: "Archiv wird durch Worker erzeugt."
  }).where(and(
    eq(standaloneExportJobs.id, job.id),
    eq(standaloneExportJobs.status, "queued")
  )).returning();

  return claimed ?? null;
}

export async function runNextQueuedJob(): Promise<QueuedJobResult | null> {
  const materialRun = await claimNextQueuedMaterialRun();
  if (materialRun) return runQueuedMaterialJob(materialRun.id);

  const archiveJob = await claimNextQueuedArchiveJob();
  if (archiveJob) return runQueuedArchiveJob(archiveJob.id);

  return null;
}

export async function runQueuedJobs(limit = 1) {
  const results: QueuedJobResult[] = [];
  const cappedLimit = normalizeWorkerLimit(limit);
  for (let index = 0; index < cappedLimit; index += 1) {
    const result = await runNextQueuedJob();
    if (!result) break;
    results.push(result);
  }
  return {
    processed: results.length,
    results
  };
}
