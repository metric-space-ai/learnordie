type DraftStage = "provider" | "schema" | "grounding";

// Only fixed categories may reach runtime logs. Provider errors and model
// verdicts can contain credentials or private lecture/student content.
export class StudentDraftError extends Error {
  readonly diagnostic: { stage: DraftStage; attempt: number; code: string };

  constructor(stage: DraftStage, attempt: number, cause: unknown) {
    super(stage === "provider" ? "Student exam draft generation failed." : "Student exam draft was invalid after one retry.", { cause });
    this.name = "StudentDraftError";
    const message = cause instanceof Error ? cause.message : "";
    const code = /timed out|abort/i.test(message) ? "timeout"
      : stage === "provider" ? "provider-failure"
      : /Beleg fehlt/.test(message) ? "source-quote"
      : /^Fachprüfung/.test(message) ? "factual-review"
      : /JSON/i.test(message) ? "invalid-json"
      : /topic word count/.test(message) ? "topic-length"
      : /out-of-range/.test(message) ? "field-length"
      : /unavailable context|undefined reference/.test(message) ? "not-standalone"
      : /duplicate/.test(message) ? "duplicate"
      : /correct/.test(message) ? "answer-key"
      : "invalid-structure";
    this.diagnostic = { stage, attempt, code };
  }
}

export function studentDraftDiagnostic(error: unknown) {
  return error instanceof StudentDraftError ? error.diagnostic : { stage: "pipeline", code: "unexpected-failure" };
}
