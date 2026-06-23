ALTER TABLE "student_chat_questions" ADD COLUMN "moderation_provider" text;--> statement-breakpoint
ALTER TABLE "student_chat_questions" ADD COLUMN "moderation_model" text;--> statement-breakpoint
ALTER TABLE "student_chat_questions" ADD COLUMN "moderation_confidence" integer;--> statement-breakpoint
ALTER TABLE "student_chat_questions" ADD COLUMN "moderation_signals" jsonb;