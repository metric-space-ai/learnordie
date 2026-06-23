CREATE TABLE "standalone_export_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lecture_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"format" text DEFAULT 'archive_zip' NOT NULL,
	"requested_by" text,
	"standalone_export_id" uuid,
	"storage_url" text,
	"sha256" text,
	"message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "standalone_export_jobs" ADD CONSTRAINT "standalone_export_jobs_lecture_id_lectures_id_fk" FOREIGN KEY ("lecture_id") REFERENCES "public"."lectures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standalone_export_jobs" ADD CONSTRAINT "standalone_export_jobs_standalone_export_id_standalone_exports_id_fk" FOREIGN KEY ("standalone_export_id") REFERENCES "public"."standalone_exports"("id") ON DELETE no action ON UPDATE no action;