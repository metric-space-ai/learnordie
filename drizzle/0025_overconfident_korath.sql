CREATE TABLE "presentation_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lecture_id" uuid NOT NULL,
	"material_id" uuid,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"storage_key" text,
	"preview_key" text,
	"extracted_text" text,
	"structured_data" jsonb,
	"source_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tags_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"quality_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "presentation_assets" ADD CONSTRAINT "presentation_assets_lecture_id_lectures_id_fk" FOREIGN KEY ("lecture_id") REFERENCES "public"."lectures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presentation_assets" ADD CONSTRAINT "presentation_assets_material_id_lecture_assets_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."lecture_assets"("id") ON DELETE no action ON UPDATE no action;