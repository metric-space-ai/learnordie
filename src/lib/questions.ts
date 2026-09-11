import type { QuestionVariant } from "./types";

// Fragen einer Folie: zuerst die ihr zugeordneten, sonst die folienunabhaengigen
// Fragen der Vorlesung. Alte Vorlesungen ohne Zuordnung verhalten sich wie bisher.
export function questionsForSlide(questions: QuestionVariant[], slideId?: string): QuestionVariant[] {
  const assigned = slideId ? questions.filter((question) => question.slideId === slideId) : [];
  if (assigned.length > 0) return assigned;
  const lectureWide = questions.filter((question) => !question.slideId);
  return lectureWide.length > 0 ? lectureWide : questions;
}

// Jede Gruppe (Folie oder folienunabhaengig) ist eine vollstaendige Fragenfamilie
// mit genau einer Variante je Niveau.
export function hasCompleteQuestionFamilies(questions: Array<Pick<QuestionVariant, "level" | "slideId">>): boolean {
  const groups = new Map<string, Set<string>>();
  for (const question of questions) {
    const key = question.slideId ?? "";
    const levels = groups.get(key) ?? new Set<string>();
    if (levels.has(question.level)) return false;
    levels.add(question.level);
    groups.set(key, levels);
  }
  return [...groups.values()].every((levels) => levels.size === 4);
}
