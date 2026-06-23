ALTER TABLE "lectures" ADD COLUMN "evaluation_config" jsonb;--> statement-breakpoint
UPDATE "lectures"
SET "evaluation_config" = '{
  "enabled": true,
  "version": 1,
  "updatedAt": "2026-06-17T00:00:00.000Z",
  "title": "Evaluation",
  "intro": "Kurze Rückmeldung zur Vorlesung.",
  "understandingLabel": "Verständnis",
  "paceLabel": "Tempo",
  "aiHelpfulLabel": "KI-Hilfe",
  "commentLabel": "Kommentar",
  "submitLabel": "Evaluation senden"
}'::jsonb
WHERE "evaluation_config" IS NULL;
