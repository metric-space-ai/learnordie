export const MIN_LEARN_QUESTION_DENSITY = 1;
export const MAX_LEARN_QUESTION_DENSITY = 7;
export const DEFAULT_LEARN_QUESTION_DENSITY = 4;

export function normalizeLearnQuestionDensity(value: unknown, fallback = DEFAULT_LEARN_QUESTION_DENSITY) {
  const numeric = typeof value === "number" ? value : Number(value);
  const base = Number.isFinite(numeric) ? numeric : fallback;
  return Math.min(MAX_LEARN_QUESTION_DENSITY, Math.max(MIN_LEARN_QUESTION_DENSITY, Math.round(base)));
}

/** Density changes the spacing of practice prompts, never their difficulty. */
export function learnQuestionInterval(density: unknown) {
  return MAX_LEARN_QUESTION_DENSITY + 1 - normalizeLearnQuestionDensity(density);
}

export function learnQuestionCadenceLabel(density: unknown) {
  const interval = learnQuestionInterval(density);
  return interval === 1 ? "jede Folie" : `alle ${interval} Folien`;
}

export function shouldOfferLearnQuestion({ density, completedSlides, atEnd, hasQuestions }: {
  density: unknown;
  completedSlides: number;
  atEnd: boolean;
  hasQuestions: boolean;
}) {
  // A short deck still gets an end-of-deck check. Empty question sets never
  // open an invisible drawer or prevent the learner from moving on.
  return hasQuestions && completedSlides > 0 && (atEnd || completedSlides >= learnQuestionInterval(density));
}
