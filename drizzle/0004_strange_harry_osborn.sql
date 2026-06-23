CREATE TABLE "student_chat_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lecture_id" uuid NOT NULL,
	"participant_session_id" uuid,
	"pseudonym" text NOT NULL,
	"anonymous_key" text,
	"question_text" text NOT NULL,
	"status" text DEFAULT 'accepted' NOT NULL,
	"relevance_reason" text NOT NULL,
	"source_topic" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "student_chat_questions" ADD CONSTRAINT "student_chat_questions_lecture_id_lectures_id_fk" FOREIGN KEY ("lecture_id") REFERENCES "public"."lectures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_chat_questions" ADD CONSTRAINT "student_chat_questions_participant_session_id_participant_sessions_id_fk" FOREIGN KEY ("participant_session_id") REFERENCES "public"."participant_sessions"("id") ON DELETE no action ON UPDATE no action;