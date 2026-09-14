ALTER TYPE "public"."enrollment_status" ADD VALUE IF NOT EXISTS 'anonymized';
--> statement-breakpoint
ALTER TABLE "student_enrollments" ADD COLUMN IF NOT EXISTS "display_name" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "student_enrollments" ADD COLUMN IF NOT EXISTS "display_name_normalized" text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "student_enrollments_active_name_idx"
  ON "student_enrollments" ("series_id", "display_name_normalized")
  WHERE "status" = 'active' AND "display_name_normalized" <> '';
