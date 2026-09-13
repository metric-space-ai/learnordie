CREATE TABLE "student_chat_question_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lecture_id" uuid NOT NULL,
	"student_profile_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "student_chat_question_attempts" ADD CONSTRAINT "student_chat_question_attempts_lecture_id_lectures_id_fk" FOREIGN KEY ("lecture_id") REFERENCES "public"."lectures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_chat_question_attempts" ADD CONSTRAINT "student_chat_question_attempts_student_profile_id_student_profiles_id_fk" FOREIGN KEY ("student_profile_id") REFERENCES "public"."student_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "student_chat_question_attempts_profile_lecture_created_idx" ON "student_chat_question_attempts" USING btree ("student_profile_id","lecture_id","created_at");