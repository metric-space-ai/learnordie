CREATE TYPE "public"."enrollment_source" AS ENUM('code', 'direct_live_link', 'direct_learn_link', 'lecturer_invite');--> statement-breakpoint
CREATE TYPE "public"."enrollment_status" AS ENUM('active', 'removed');--> statement-breakpoint
CREATE TYPE "public"."join_code_scope" AS ENUM('series', 'lecture');--> statement-breakpoint
CREATE TABLE "join_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"normalized_code" text NOT NULL,
	"scope" "join_code_scope" NOT NULL,
	"series_id" uuid,
	"lecture_id" uuid,
	"created_by_user_id" uuid,
	"enabled" boolean DEFAULT true NOT NULL,
	"starts_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_profile_id" uuid NOT NULL,
	"series_id" uuid,
	"lecture_id" uuid,
	"join_code_id" uuid,
	"source" "enrollment_source" DEFAULT 'code' NOT NULL,
	"status" "enrollment_status" DEFAULT 'active' NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_opened_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "student_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"anonymous_key" text NOT NULL,
	"pseudonym" text NOT NULL,
	"email_hash" text,
	"locale" text DEFAULT 'de' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_profiles_anonymous_key_unique" UNIQUE("anonymous_key")
);
--> statement-breakpoint
CREATE TABLE "student_readiness_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_profile_id" uuid NOT NULL,
	"series_id" uuid,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"readiness_score" integer DEFAULT 0 NOT NULL,
	"by_level_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"by_topic_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"next_actions_json" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lecture_series" ADD COLUMN "exam_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lecture_series" ADD COLUMN "default_join_code_id" uuid;--> statement-breakpoint
ALTER TABLE "participant_sessions" ADD COLUMN "student_profile_id" uuid;--> statement-breakpoint
ALTER TABLE "join_codes" ADD CONSTRAINT "join_codes_series_id_lecture_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."lecture_series"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "join_codes" ADD CONSTRAINT "join_codes_lecture_id_lectures_id_fk" FOREIGN KEY ("lecture_id") REFERENCES "public"."lectures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "join_codes" ADD CONSTRAINT "join_codes_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_student_profile_id_student_profiles_id_fk" FOREIGN KEY ("student_profile_id") REFERENCES "public"."student_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_series_id_lecture_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."lecture_series"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_lecture_id_lectures_id_fk" FOREIGN KEY ("lecture_id") REFERENCES "public"."lectures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_join_code_id_join_codes_id_fk" FOREIGN KEY ("join_code_id") REFERENCES "public"."join_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_readiness_snapshots" ADD CONSTRAINT "student_readiness_snapshots_student_profile_id_student_profiles_id_fk" FOREIGN KEY ("student_profile_id") REFERENCES "public"."student_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_readiness_snapshots" ADD CONSTRAINT "student_readiness_snapshots_series_id_lecture_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."lecture_series"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "join_codes_normalized_enabled_idx" ON "join_codes" USING btree ("normalized_code") WHERE "join_codes"."enabled" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "student_enrollments_active_series_idx" ON "student_enrollments" USING btree ("student_profile_id","series_id") WHERE "student_enrollments"."status" = 'active';--> statement-breakpoint
ALTER TABLE "participant_sessions" ADD CONSTRAINT "participant_sessions_student_profile_id_student_profiles_id_fk" FOREIGN KEY ("student_profile_id") REFERENCES "public"."student_profiles"("id") ON DELETE no action ON UPDATE no action;