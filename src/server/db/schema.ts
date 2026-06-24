import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector
} from "drizzle-orm/pg-core";

export const lectureStatus = pgEnum("lecture_status", [
  "draft",
  "material_processing",
  "question_review",
  "ready_for_live",
  "live",
  "learn_active",
  "archived"
]);

export const questionLevel = pgEnum("question_level", ["4.0", "3.0", "2.0", "1.0"]);
export const questionReviewStatus = pgEnum("question_review_status", ["draft", "approved", "rejected"]);
export const joinCodeScope = pgEnum("join_code_scope", ["series", "lecture"]);
export const enrollmentSource = pgEnum("enrollment_source", [
  "code",
  "direct_live_link",
  "direct_learn_link",
  "lecturer_invite"
]);
export const enrollmentStatus = pgEnum("enrollment_status", ["active", "removed"]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  role: text("role").notNull().default("lecturer"),
  aiDailyLimit: integer("ai_daily_limit").notNull().default(20),
  aiDailyTokenLimit: integer("ai_daily_token_limit").notNull().default(12000),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const magicLoginTokens = pgTable("magic_login_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const magicLoginRateLimits = pgTable("magic_login_rate_limits", {
  id: uuid("id").defaultRandom().primaryKey(),
  bucketHash: text("bucket_hash").notNull().unique(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
  attemptCount: integer("attempt_count").notNull().default(0),
  blockedUntil: timestamp("blocked_until", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
});

export const lectureSeries = pgTable("lecture_series", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  language: text("language").notNull().default("de"),
  examDate: timestamp("exam_date", { withTimezone: true }),
  defaultJoinCodeId: uuid("default_join_code_id"),
  aiDailyLimit: integer("ai_daily_limit").notNull().default(20),
  aiDailyTokenLimit: integer("ai_daily_token_limit").notNull().default(12000),
  evaluationConfig: jsonb("evaluation_config"),
  ownerId: uuid("owner_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const lectures = pgTable("lectures", {
  id: uuid("id").defaultRandom().primaryKey(),
  seriesId: uuid("series_id").references(() => lectureSeries.id),
  publicToken: text("public_token").notNull().unique(),
  title: text("title").notNull(),
  status: lectureStatus("status").notNull().default("draft"),
  liveAt: timestamp("live_at", { withTimezone: true }),
  examDate: timestamp("exam_date", { withTimezone: true }),
  aiAccessUntil: timestamp("ai_access_until", { withTimezone: true }),
  aiDailyLimit: integer("ai_daily_limit").notNull().default(20),
  aiDailyTokenLimit: integer("ai_daily_token_limit").notNull().default(12000),
  leaderboardEnabled: boolean("leaderboard_enabled").notNull().default(true),
  learnQuestionDensity: integer("learn_question_density").notNull().default(4),
  evaluationConfig: jsonb("evaluation_config"),
  slideDocumentJson: jsonb("slide_document_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const lectureAssets = pgTable("lecture_assets", {
  id: uuid("id").defaultRandom().primaryKey(),
  lectureId: uuid("lecture_id").references(() => lectures.id).notNull(),
  kind: text("kind").notNull(),
  source: text("source").notNull().default("upload"),
  originalName: text("original_name").notNull(),
  storageKey: text("storage_key").notNull(),
  sizeBytes: integer("size_bytes"),
  status: text("status").notNull().default("uploaded"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const materialProcessingRuns = pgTable("material_processing_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  lectureId: uuid("lecture_id").references(() => lectures.id).notNull(),
  status: text("status").notNull().default("queued"),
  materialCount: integer("material_count").notNull().default(0),
  chunkCount: integer("chunk_count").notNull().default(0),
  reviewCount: integer("review_count").notNull().default(0),
  attemptCount: integer("attempt_count").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  provider: text("provider"),
  providerJobId: text("provider_job_id"),
  message: text("message"),
  stepsJson: jsonb("steps_json").notNull().default([]),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
  deadLetterAt: timestamp("dead_letter_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  durationMs: integer("duration_ms")
});

export const assetChunks = pgTable("asset_chunks", {
  id: uuid("id").defaultRandom().primaryKey(),
  assetId: uuid("asset_id").references(() => lectureAssets.id),
  lectureId: uuid("lecture_id").references(() => lectures.id).notNull(),
  sourceRef: text("source_ref").notNull(),
  content: text("content").notNull(),
  embedding: vector("embedding", { dimensions: 1536 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const slides = pgTable("slides", {
  id: uuid("id").defaultRandom().primaryKey(),
  lectureId: uuid("lecture_id").references(() => lectures.id).notNull(),
  position: integer("position").notNull(),
  title: text("title").notNull(),
  contentJson: jsonb("content_json").notNull()
});

export const questions = pgTable("questions", {
  id: uuid("id").defaultRandom().primaryKey(),
  lectureId: uuid("lecture_id").references(() => lectures.id).notNull(),
  slideId: uuid("slide_id").references(() => slides.id),
  source: text("source").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const questionVariants = pgTable("question_variants", {
  id: uuid("id").defaultRandom().primaryKey(),
  questionId: uuid("question_id").references(() => questions.id).notNull(),
  level: questionLevel("level").notNull(),
  points: integer("points").notNull(),
  text: text("text").notNull(),
  answersJson: jsonb("answers_json").notNull(),
  correctAnswerKey: text("correct_answer_key").notNull(),
  explanation: text("explanation").notNull(),
  promptVersion: text("prompt_version").notNull().default("v1")
});

export const questionReviewItems = pgTable("question_review_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  lectureId: uuid("lecture_id").references(() => lectures.id).notNull(),
  sourceMaterialId: uuid("source_material_id").references(() => lectureAssets.id),
  sourceTitle: text("source_title").notNull(),
  status: questionReviewStatus("status").notNull().default("draft"),
  variantsJson: jsonb("variants_json").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true })
});

export const participantSessions = pgTable(
  "participant_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    lectureId: uuid("lecture_id").references(() => lectures.id).notNull(),
    studentProfileId: uuid("student_profile_id").references(() => studentProfiles.id),
    pseudonym: text("pseudonym").notNull(),
    anonymousKey: text("anonymous_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    uniqueIndex("participant_sessions_lecture_anonymous_idx").on(table.lectureId, table.anonymousKey)
  ]
);

export const studentChatQuestions = pgTable("student_chat_questions", {
  id: uuid("id").defaultRandom().primaryKey(),
  lectureId: uuid("lecture_id").references(() => lectures.id).notNull(),
  participantSessionId: uuid("participant_session_id").references(() => participantSessions.id),
  pseudonym: text("pseudonym").notNull(),
  anonymousKey: text("anonymous_key"),
  questionText: text("question_text").notNull(),
  status: text("status").notNull().default("accepted"),
  relevanceReason: text("relevance_reason").notNull(),
  sourceTopic: text("source_topic"),
  moderationProvider: text("moderation_provider"),
  moderationModel: text("moderation_model"),
  moderationConfidence: integer("moderation_confidence"),
  moderationSignals: jsonb("moderation_signals"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const transcriptSegments = pgTable("transcript_segments", {
  id: uuid("id").defaultRandom().primaryKey(),
  lectureId: uuid("lecture_id").references(() => lectures.id).notNull(),
  text: text("text").notNull(),
  provider: text("provider").notNull().default("voxtral-realtime"),
  status: text("status").notNull().default("accepted"),
  relevanceReason: text("relevance_reason").notNull(),
  sourceTopic: text("source_topic"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const lecturerAssistantMessages = pgTable("lecturer_assistant_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  lectureId: uuid("lecture_id").references(() => lectures.id).notNull(),
  slideId: uuid("slide_id").references(() => slides.id),
  role: text("role").notNull(),
  content: text("content").notNull(),
  sourceRefs: jsonb("source_refs").notNull().default([]),
  metadataJson: jsonb("metadata_json").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const answers = pgTable("answers", {
  id: uuid("id").defaultRandom().primaryKey(),
  participantSessionId: uuid("participant_session_id").references(() => participantSessions.id),
  lectureId: uuid("lecture_id").references(() => lectures.id).notNull(),
  level: questionLevel("level").notNull(),
  selectedKey: text("selected_key").notNull(),
  correct: boolean("correct").notNull(),
  responseMs: integer("response_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const analyticsEvents = pgTable("analytics_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  lectureId: uuid("lecture_id").references(() => lectures.id),
  participantSessionId: uuid("participant_session_id").references(() => participantSessions.id),
  eventType: text("event_type").notNull(),
  eventPayload: jsonb("event_payload").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull()
});

export const standaloneExports = pgTable("standalone_exports", {
  id: uuid("id").defaultRandom().primaryKey(),
  lectureId: uuid("lecture_id").references(() => lectures.id).notNull(),
  version: text("version").notNull(),
  storageUrl: text("storage_url"),
  sha256: text("sha256"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

// ── Student / Enrollment / Join-Code product layer ──────────────────────────

export const studentProfiles = pgTable("student_profiles", {
  id: uuid("id").defaultRandom().primaryKey(),
  anonymousKey: text("anonymous_key").notNull().unique(),
  pseudonym: text("pseudonym").notNull(),
  emailHash: text("email_hash"),
  locale: text("locale").notNull().default("de"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull()
});

export const joinCodes = pgTable(
  "join_codes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull(),
    normalizedCode: text("normalized_code").notNull(),
    scope: joinCodeScope("scope").notNull(),
    seriesId: uuid("series_id").references(() => lectureSeries.id),
    lectureId: uuid("lecture_id").references(() => lectures.id),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    enabled: boolean("enabled").notNull().default(true),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    // normalized_code unique while enabled (partial unique enforced in migration SQL).
    uniqueIndex("join_codes_normalized_enabled_idx")
      .on(table.normalizedCode)
      .where(sql`${table.enabled} = true`)
  ]
);

export const studentEnrollments = pgTable(
  "student_enrollments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    studentProfileId: uuid("student_profile_id").references(() => studentProfiles.id).notNull(),
    seriesId: uuid("series_id").references(() => lectureSeries.id),
    lectureId: uuid("lecture_id").references(() => lectures.id),
    joinCodeId: uuid("join_code_id").references(() => joinCodes.id),
    source: enrollmentSource("source").notNull().default("code"),
    status: enrollmentStatus("status").notNull().default("active"),
    addedAt: timestamp("added_at", { withTimezone: true }).defaultNow().notNull(),
    lastOpenedAt: timestamp("last_opened_at", { withTimezone: true })
  },
  (table) => [
    // One active enrollment per (student, series).
    uniqueIndex("student_enrollments_active_series_idx")
      .on(table.studentProfileId, table.seriesId)
      .where(sql`${table.status} = 'active'`)
  ]
);

export const studentReadinessSnapshots = pgTable("student_readiness_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  studentProfileId: uuid("student_profile_id").references(() => studentProfiles.id).notNull(),
  seriesId: uuid("series_id").references(() => lectureSeries.id),
  computedAt: timestamp("computed_at", { withTimezone: true }).defaultNow().notNull(),
  readinessScore: integer("readiness_score").notNull().default(0),
  byLevelJson: jsonb("by_level_json").notNull().default([]),
  byTopicJson: jsonb("by_topic_json").notNull().default([]),
  nextActionsJson: jsonb("next_actions_json").notNull().default([])
});

export const standaloneExportJobs = pgTable("standalone_export_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  lectureId: uuid("lecture_id").references(() => lectures.id).notNull(),
  status: text("status").notNull().default("queued"),
  format: text("format").notNull().default("archive_zip"),
  requestedBy: text("requested_by"),
  attemptCount: integer("attempt_count").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  provider: text("provider"),
  providerJobId: text("provider_job_id"),
  standaloneExportId: uuid("standalone_export_id").references(() => standaloneExports.id),
  storageUrl: text("storage_url"),
  sha256: text("sha256"),
  message: text("message"),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
  deadLetterAt: timestamp("dead_letter_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});
