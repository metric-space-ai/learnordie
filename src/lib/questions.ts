import type { QuestionLevel, QuestionVariant } from "./types";

export const questionLevels: QuestionLevel[] = ["4.0", "3.0", "2.0", "1.0"];

// Fragen einer Folie: zuerst die ihr zugeordneten, sonst die folienunabhaengigen
// Fragen der Vorlesung. Alte Vorlesungen ohne Zuordnung verhalten sich wie bisher.
export function questionsForSlide(questions: QuestionVariant[], slideId?: string): QuestionVariant[] {
  const assigned = slideId ? questions.filter((question) => question.slideId === slideId) : [];
  if (assigned.length > 0) return assigned;
  const lectureWide = questions.filter((question) => !question.slideId);
  return lectureWide.length > 0 ? lectureWide : questions;
}

function familyKey(question: Pick<QuestionVariant, "slideId" | "familyId">) {
  return `${question.slideId ?? ""}|${question.familyId ?? ""}`;
}

// Eine Frage ist eine Familie aus je einer Variante pro Niveau. Varianten ohne
// familyId bilden (je Folie) eine gemeinsame Familie, wie bei alten Vorlesungen.
export function groupQuestionFamilies(questions: QuestionVariant[]): QuestionVariant[][] {
  const families = new Map<string, QuestionVariant[]>();
  for (const question of questions) {
    const key = familyKey(question);
    families.set(key, [...(families.get(key) ?? []), question]);
  }
  return [...families.values()].map((family) =>
    [...family].sort((left, right) => questionLevels.indexOf(left.level) - questionLevels.indexOf(right.level))
  );
}

// Jede Familie enthaelt genau eine Variante je Niveau (4.0, 3.0, 2.0, 1.0).
export function hasCompleteQuestionFamilies(questions: Array<Pick<QuestionVariant, "level" | "slideId" | "familyId">>): boolean {
  const groups = new Map<string, Set<string>>();
  for (const question of questions) {
    const key = familyKey(question);
    const levels = groups.get(key) ?? new Set<string>();
    if (levels.has(question.level)) return false;
    levels.add(question.level);
    groups.set(key, levels);
  }
  return [...groups.values()].every((levels) => levels.size === questionLevels.length);
}
