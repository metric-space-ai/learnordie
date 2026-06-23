WITH duplicate_sessions AS (
  SELECT
    "id",
    first_value("id") OVER (
      PARTITION BY "lecture_id", "anonymous_key"
      ORDER BY "created_at", "id"
    ) AS "keep_id"
  FROM "participant_sessions"
)
UPDATE "analytics_events"
SET "participant_session_id" = duplicate_sessions."keep_id"
FROM duplicate_sessions
WHERE "analytics_events"."participant_session_id" = duplicate_sessions."id"
  AND duplicate_sessions."id" <> duplicate_sessions."keep_id";--> statement-breakpoint
WITH duplicate_sessions AS (
  SELECT
    "id",
    first_value("id") OVER (
      PARTITION BY "lecture_id", "anonymous_key"
      ORDER BY "created_at", "id"
    ) AS "keep_id"
  FROM "participant_sessions"
)
UPDATE "answers"
SET "participant_session_id" = duplicate_sessions."keep_id"
FROM duplicate_sessions
WHERE "answers"."participant_session_id" = duplicate_sessions."id"
  AND duplicate_sessions."id" <> duplicate_sessions."keep_id";--> statement-breakpoint
WITH duplicate_sessions AS (
  SELECT
    "id",
    first_value("id") OVER (
      PARTITION BY "lecture_id", "anonymous_key"
      ORDER BY "created_at", "id"
    ) AS "keep_id"
  FROM "participant_sessions"
)
UPDATE "student_chat_questions"
SET "participant_session_id" = duplicate_sessions."keep_id"
FROM duplicate_sessions
WHERE "student_chat_questions"."participant_session_id" = duplicate_sessions."id"
  AND duplicate_sessions."id" <> duplicate_sessions."keep_id";--> statement-breakpoint
WITH duplicate_sessions AS (
  SELECT
    "id",
    first_value("id") OVER (
      PARTITION BY "lecture_id", "anonymous_key"
      ORDER BY "created_at", "id"
    ) AS "keep_id"
  FROM "participant_sessions"
)
DELETE FROM "participant_sessions"
USING duplicate_sessions
WHERE "participant_sessions"."id" = duplicate_sessions."id"
  AND duplicate_sessions."id" <> duplicate_sessions."keep_id";--> statement-breakpoint
CREATE UNIQUE INDEX "participant_sessions_lecture_anonymous_idx" ON "participant_sessions" USING btree ("lecture_id","anonymous_key");
