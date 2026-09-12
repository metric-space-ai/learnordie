CREATE TABLE "live_sessions" (
  "lecture_id" uuid PRIMARY KEY REFERENCES "lectures"("id") ON DELETE CASCADE,
  "session_id" uuid NOT NULL,
  "revision" integer NOT NULL CHECK (revision > 0),
  "status" text NOT NULL CHECK (status IN ('active', 'ended')),
  "slide_index" integer NOT NULL DEFAULT 0 CHECK (slide_index >= 0),
  "show_intro" boolean NOT NULL DEFAULT true,
  "round" jsonb,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "live_answers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "lecture_id" uuid NOT NULL REFERENCES "lectures"("id") ON DELETE CASCADE,
  "session_id" uuid NOT NULL,
  "round_id" uuid NOT NULL,
  "student_profile_id" uuid NOT NULL REFERENCES "student_profiles"("id") ON DELETE CASCADE,
  "points" integer NOT NULL CHECK (points BETWEEN 0 AND 4),
  "correct" boolean NOT NULL,
  "receipt" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "live_answers_round_profile_idx" ON "live_answers" ("round_id", "student_profile_id");
--> statement-breakpoint
CREATE INDEX "live_answers_session_idx" ON "live_answers" ("session_id");
