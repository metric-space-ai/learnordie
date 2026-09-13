/** Persist slide identity, not an index: reordered decks must resume the same slide. */
export function savedLearnSlideIndex(savedId: string | null, slides: readonly { id: string }[]) {
  if (!savedId) return 0;
  return Math.max(0, slides.findIndex(slide => slide.id === savedId));
}
