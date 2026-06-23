ALTER TABLE "lecture_assets" ADD COLUMN "source" text DEFAULT 'upload' NOT NULL;--> statement-breakpoint
ALTER TABLE "lecture_assets" ADD COLUMN "size_bytes" integer;--> statement-breakpoint
ALTER TABLE "lecture_assets" ADD COLUMN "status" text DEFAULT 'uploaded' NOT NULL;