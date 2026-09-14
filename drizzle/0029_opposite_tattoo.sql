ALTER TABLE "live_sessions" ADD COLUMN "started_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "question_review_items" ADD COLUMN "source_student_question_id" text;--> statement-breakpoint
ALTER TABLE "student_chat_questions" ADD COLUMN "exam_draft_status" text DEFAULT 'not_applicable' NOT NULL;--> statement-breakpoint
ALTER TABLE "student_chat_questions" ADD COLUMN "exam_draft_error" text;--> statement-breakpoint
ALTER TABLE "student_chat_questions" ADD COLUMN "exam_draft_round_id" text;--> statement-breakpoint
ALTER TABLE "student_chat_questions" ADD COLUMN "exam_draft_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "student_chat_questions" ADD COLUMN "exam_draft_attempt_id" text;--> statement-breakpoint
CREATE TABLE "student_exam_draft_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lecture_id" uuid NOT NULL,
	"chat_question_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);--> statement-breakpoint
ALTER TABLE "student_exam_draft_attempts" ADD CONSTRAINT "student_exam_draft_attempts_lecture_id_lectures_id_fk" FOREIGN KEY ("lecture_id") REFERENCES "public"."lectures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_exam_draft_attempts" ADD CONSTRAINT "student_exam_draft_attempts_chat_question_id_student_chat_questions_id_fk" FOREIGN KEY ("chat_question_id") REFERENCES "public"."student_chat_questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "student_exam_draft_attempts_lecture_created_idx" ON "student_exam_draft_attempts" USING btree ("lecture_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "question_review_items_student_question_idx" ON "question_review_items" USING btree ("lecture_id","source_student_question_id");
