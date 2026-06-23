CREATE TYPE "public"."question_review_status" AS ENUM('draft', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "question_review_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lecture_id" uuid NOT NULL,
	"source_material_id" uuid,
	"source_title" text NOT NULL,
	"status" "question_review_status" DEFAULT 'draft' NOT NULL,
	"variants_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "question_review_items" ADD CONSTRAINT "question_review_items_lecture_id_lectures_id_fk" FOREIGN KEY ("lecture_id") REFERENCES "public"."lectures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_review_items" ADD CONSTRAINT "question_review_items_source_material_id_lecture_assets_id_fk" FOREIGN KEY ("source_material_id") REFERENCES "public"."lecture_assets"("id") ON DELETE no action ON UPDATE no action;