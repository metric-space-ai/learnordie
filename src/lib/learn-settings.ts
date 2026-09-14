import { groupQuestionFamilies, hasCompleteQuestionFamilies } from "./questions";
import type { QuestionVariant } from "./types";

export const MIN_LEARN_QUESTION_DENSITY = 1;
export const MAX_LEARN_QUESTION_DENSITY = 7;
export const DEFAULT_LEARN_QUESTION_DENSITY = 4;

export function normalizeLearnQuestionDensity(value: unknown, fallback = DEFAULT_LEARN_QUESTION_DENSITY) {
  const numeric = typeof value === "number" ? value : Number(value);
  const base = Number.isFinite(numeric) ? numeric : fallback;
  return Math.min(MAX_LEARN_QUESTION_DENSITY, Math.max(MIN_LEARN_QUESTION_DENSITY, Math.round(base)));
}

/** Each spot is a distinct, complete family for this slide, not a difficulty. */
export function learnQuestionFamilies(questions: QuestionVariant[], slideId?: string) {
  const assigned = questions.filter((question) => question.slideId === slideId && Boolean(slideId));
  const relevant = assigned.length ? assigned : questions.filter((question) => !question.slideId);
  return groupQuestionFamilies(relevant).filter((family) => hasCompleteQuestionFamilies(family));
}

export function visibleLearnQuestionFamilies(families: QuestionVariant[][], density: unknown) {
  return families.slice(0, normalizeLearnQuestionDensity(density));
}
